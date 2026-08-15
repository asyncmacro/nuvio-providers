# Yenime Provider Plan

Based on `kitsu/kitsune/providers/sites/yenime/provider.py`

## Summary

Yenime (https://yenime.net) is an anime site that fronts a Vidbolt /
`hianime.filmu.in` streaming backend. There is no yenime.net API to scrape:
all metadata comes from the **AniList GraphQL API**, and all stream URLs come
from the **Vidbolt megaplay endpoint**, keyed by MyAnimeList id.

## Source of Truth

### Metadata: AniList GraphQL
- Endpoint: `POST https://graphql.anilist.co`
- Three queries:
  1. **Search** — `Page.media(search, type: ANIME)` with `idMal`, title, format,
     episodes.
  2. **Id from MAL** — `Media(idMal, type: ANIME)` → `id` (bootstrap of season chain).
  3. **Media detail** — `Media(id, type: ANIME)` → id, idMal, title (romaji/english),
     format, status, episodes, `nextAiringEpisode`, `streamingEpisodes`,
     `relations.edges` (SEQUEL chain).
- Rate limiting: aggressive 429s. Kitsune uses MAX_RETRIES=3 with backoff
  `1s * (attempt+1)`, honoring the `Retry-After` header when present, and
  treats GraphQL `errors` in a 200 response as failure.
- Streaming episode titles in `streamingEpisodes` are matched with regex
  `^\s*(?:episode|ep)\.?\s*(\d+)` and used only to enrich episode titles —
  **never** to decide availability.

### Streaming: Vidbolt / hianime.filmu.in
- **Token**: `POST https://hianime.filmu.in/token`
  - Headers: `Accept: application/json`, `Referer: https://hianime.filmu.in/`,
    `Origin: https://hianime.filmu.in`
  - Response: `{ token: "..." }` (or `{ data: { token } }`)
  - Token TTL ~2.4–2.5h, cached per provider instance with expiry.
  - On 401/403 from megaplay, invalidate the cached token and retry once.
- **Megaplay**: `GET https://hianime.filmu.in/hianime/megaplay`
  - Params: `malId`, `ep`, `type=sub|dub`
  - Headers: `Accept: application/json`, `x-api-key: <token>`,
    `Referer: https://hianime.filmu.in/hianime/megaplay`,
    `Origin: https://hianime.filmu.in`
  - Stream entries may use `url` / `proxyUrl` / `file` / `src`; source object
    may carry `referer`, `quality`/`resolution`, `server`/`name`, and
    `subtitles`/`captions`/`tracks`.
  - Relative/`//` URLs are resolved against the API origin.
- **Stream referer default**: `https://megaplay.buzz/`
- **HLS**: master playlists (`#EXT-X-STREAM-INF`) are expanded to per-quality
  variants (resolution from `RESOLUTION=WxH` → `Hp`); a media playlist is
  returned as a single `auto` stream. Kitsune uses the `m3u8` package with a
  small regex fallback. Streams are deduped by (url, resolution, referer) and
  sorted by resolution descending.
- **Subtitles**: parsed from `subtitles`/`captions`/`tracks`; formats detected
  by extension `.vtt`/`.ass`/`.ssa` (else `srt`); language normalized to the
  primary subtag (lowercased, `_`→`-`, split on `-`); URLs deduped.

### Audio selection
- Precedence:
  1. Env `KITSUNE_YENIME_AUDIO` = `sub` | `dub`
  2. Requested languages containing `dub`/`dubbed`/`en-dub`/`english-dub`/`english dub`
  3. Default: `sub`
- Dub fallback: if `dub` was requested but returned no streams, retry with `sub`.

## Key Findings from kitsune

- Yenime URLs: `https://yenime.net/anime/{mal_id}` (also `/watch/{id}/{ep}` for parsing).
- Provider stores `tmdb_id = str(mal_id)` — Nuvio treats tmdbId as the MAL id.
- Season handling via AniList **SEQUEL relations** chain: each season is a
  separate AniList entry with its own `idMal`. Kitsune walks the chain
  (cap `MAX_SEASON_CHAIN = 20`, cycle-guarded) and assigns season numbers
  1, 2, 3… in order.
- Season id caches: root MAL id → `{season_number: anilist_id}` and
  `{season_number: mal_id}`, guarded by per-show `asyncio.Lock` so concurrent
  calls on a cold cache build the chain once.
- If the chain has no entries (no AniList mapping / all requests failed),
  kitsune falls back to a minimal single-season item "Season 1".
- Stream fetching uses **MAL id** + episode number + audio type. For season > 1
  the season-specific MAL id is resolved (falling back to the root MAL id).
- Movie streams: anime movies are exposed as episode 1 on the backend.
- Episodes aired logic (`_episode_has_aired`):
  - `NOT_YET_RELEASED` / `CANCELLED` → not available.
  - `nextAiringEpisode` present → only episodes `< next` are available.
  - Otherwise (FINISHED / RELEASING / HIATUS) → assume all listed aired.
- If `episodes` is 0 (ongoing shows), infer from `streamingEpisodes` titles and
  `nextAiringEpisode - 1`.
- Media type: `format == "MOVIE"` → movie, else TV.
- Title preference: English → romaji → "Unknown".

## Nuvio Integration

Nuvio calls: `getStreams(tmdbId, mediaType, season, episode)`
In kitsune mapping, tmdbId == MAL id for anime.

### Plan v1 (implemented in `extractor.js`)
1. Treat incoming `tmdbId` as MAL id directly (kitsune convention).
2. Fetch AniList entry by MAL id (`Media(idMal)`).
3. Build season chain from AniList `SEQUEL` relations.
4. Resolve season MAL id:
   - `season == 1` → use root tmdbId/MAL id.
   - else → find season N in the chain and use its `mal_id`
     (fall back to root MAL id if absent).
5. Get Vidbolt token (cache ~2.5h).
6. Call megaplay endpoint with `malId`, `ep`, `type`, `x-api-key`.
7. Parse stream list; expand HLS masters to variants.
8. Return Nuvio stream objects with headers `Referer` / `Origin` / `User-Agent`.

### Plan v2 enhancements (future)
- TMDB → MAL mapping via TMDB `external_ids` API if tmdbId is a real TMDB id.
- Audio selection via env/heuristics (already handled in kitsune: `KITSUNE_YENIME_AUDIO`).
- Full subtitle extraction with language metadata.
- Expose movie support properly (currently mapped to episode 1).
- Per-instance token + season-chain caching (kitsune already does this;
  mirror in JS module scope).

## Implementation Tasks

`src/yenime/`

- **http.js** (done): `fetchText`, `fetchJson`, `postJson`, shared `HEADERS`,
  constants `ANILIST_API`, `VIDBOLT_API`, `VIDBOLT_MEGAPLAY_REFERER`,
  `DEFAULT_STREAM_REFERER`.
- **extractor.js** (done):
  - `extractStreams(tmdbId, mediaType, season, episode)` — main entry
  - `searchAnime(query)` — AniList search
  - `getAnimeInfoByMal(malId)` — `Media(idMal)`
  - `getAnimeDetail(anilistId)` — media detail with relations
  - `buildSeasonChain(rootAnilistId)` — walk SEQUEL edges (cap 20, cycle-guarded)
  - `_resolveSeasonMalId(rootMalId, season)` — via season chain
  - `_getVidboltToken()` — cached token, ~2.5h TTL
  - `_fetchVidboltStreams(malId, episode, audio)` — megaplay GET
  - `_parseVidboltResponse(...)` — normalize stream shapes, expand HLS
  - `_expandHls(url, headers)` — regex-based master playlist expansion
  - `anilistWithRetry(query, variables)` — retry/backoff on AniList failures
- **index.js** (done): scaffolds `getStreams` → `extractStreams`.
- **provider.json** (done): id `yenime`, supported types tv + movie.

### Not yet implemented (gaps vs kitsune)
- ~~Auto-retry with fresh token on 401/403~~ **done**
- ~~`Retry-After` header honoring on 429~~ (JS uses fixed exponential backoff; optional)
- ~~Dub → sub fallback when dub returns no streams~~ **done**
- ~~Subtitle parsing from Vidbolt response~~ **done** (attached as `subtitles` on stream objects)
- ~~Media-type check / movie → episode 1 mapping~~ **done**
- ~~Env var audio override (`KITSUNE_YENIME_AUDIO`)~~ **done**

Other fixes vs kitsune:
- Megaplay auth header is now `x-api-key` (was `X-Token`)
- Token POST sends `Referer`/`Origin` (was missing)
- Parse the live API's `{ streams: [...] }` payload shape (was looking for `sources`)
- Per-source referer/origin for HLS + subtitle fetches (was hardcoded megaplay.buzz)
- Quality normalized to `1080p` form; streams deduped + sorted by resolution desc
- `postJson`/`fetchText` no longer let caller `...options` clobber the merged
  headers (was dropping `Content-Type: application/json` and UA on POSTs)
- Subtitle format detects `.vtt`/`.ass`/`.ssa` inside proxy query strings, not
  just the URL tail (proxy URLs end with `&referer=...`)
- TMDB→MAL resolver is keyless and TMDB-first (fixed the in-app "No streams"
  on search→play):
  * TMDB page `<title>` (keyless) or TMDB API (only if `TMDB_API_KEY` set) →
    title+year; Vidbolt `/search?q=` returns AniList-id + `malId` per result,
    scored by exact-title > contains > format preference (movie/TV) > year
    proximity, side content (SPECIAL/ONA/OVA) demoted, min score required
  * Ladder order: TMDB-first (Nuvio passes TMDB ids; TMDB ids collide with
    MAL ids, e.g. TMDB 37854 is One Piece while MAL 37854 is unrelated) →
    MAL passthrough → AniList passthrough
  * If a valid TMDB page exists but no anime matches (`NOT_ANIME` sentinel),
    return `[]` instead of guessing a MAL id (TMDB 456 = The Simpsons must
    not serve MAL 456's content)
  * If the TMDB page 404s, fall through to MAL/AniList ids (kitsune-style
    traffic, e.g. MAL 52991 Frieren) — movies and season-1 episodes also
    work via MAL-direct when AniList is unreachable
- TV-only hardening ("movies work, anime shows don't" in-app):
  * `buildSeasonChain` no longer throws when AniList is unreachable/rate-
    limited — it catches, returns the partial/empty chain and falls back to
    the root MAL id (correct for season 1); retry budget inside chains is
    2 attempts so a dead AniList costs ~2-3s, not minutes
  * `season`/`episode` are coerced to ints (Nuvio may pass strings, which
    broke the strict chain-season `===` lookup)
  * Apostrophe variants (U+2019 vs U+0027) are normalized in title matching:
    TMDB 209867 (Frieren) previously matched the "Sousou no Frieren: ●● no
    Mahou" ONA spinoff because the backend stores curly apostrophes;
    now it resolves to the main series (MAL 52991)

Verified against the live backend (token → megaplay → HLS master → variants):
- TMDB 37854 (One Piece) → 1 stream @1080p; TMDB 372058 (Your Name) → 1 stream
- TMDB 456 (Simpsons) / TMDB 28851 (Video Violence) → `[]` (not anime)
- MAL 52991 (Frieren) → 1 stream @1080p with season chain (S1/S2/S3)
- Dub → sub fallback exercised; missing-content titles return `[]` cleanly
AniList is Cloudflare-blocked from this network (egress via 104.22.x.x) and got
IP rate-limited after repeated probes, so AniList steps are exercised when the
block lifts; the scraper degrades to MAL-direct / Vidbolt search paths when
AniList is unreachable, so streams work even then.

## Build & Register

- `node build.js yenime`
- Add manifest entry for yenime (see `provider.json`).

## Risks

- AniList rate limiting (429) — handled with retry/backoff; consider honoring `Retry-After`.
- Vidbolt token may change or be revoked — refresh on 401/403, cache ~2.5h.
- TMDB id vs MAL id mismatch for real Nuvio users — resolver is TMDB-first and
  keyless (TMDB page `<title>` → Vidbolt `/search?q=` → malId); TMDB ids that
  collide with MAL ids resolve correctly (TMDB 37854 → One Piece, not MAL
  37854); non-anime TMDB ids return `[]` via the `NOT_ANIME` sentinel instead
  of guessing; kitsune-style MAL ids with no TMDB page fall through.
- HLS parsing without `m3u8` npm package — use fetch + regex fallback (implemented).
- Season chains are a heuristic (side stories / alternate versions may not chain cleanly).
- API host/endpoints (`hianime.filmu.in`) may change — keep constants centralized in `http.js`.

## Status

- [x] http.js helpers + constants
- [x] extractor.js: token fetch, season chain, megaplay fetch, HLS expansion, search
- [x] index.js entry point
- [x] provider.json manifest
- [ ] v2 enhancements (Retry-After honoring, TMDB_API_KEY configurable per install)
- [x] `node build.js yenime` (output in `providers/yenime.js`)
- [x] Manifest entry in `manifest.json` (id `yenime`, filename `providers/yenime.js`)
- [x] End-to-end test of built `providers/yenime.js`: TMDB ids (37854, 372058,
      209867) resolve keyless via Vidbolt search; non-anime TMDB ids return
      `[]`; MAL ids without TMDB pages fall through to MAL/AniList passthrough;
      season chains build from AniList SEQUEL edges and degrade to root-MAL
      when AniList is down (verified via simulated outage); dub→sub fallback
      works; string season/episode inputs coerced
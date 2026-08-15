/**
 * Extractor Logic
 * Yenime provider - metadata extraction + streaming
 * Uses AniList GraphQL for show/season/episode info.
 * Streaming via Vidbolt / hianime.filmu.in
 */

import {
    postJson,
    fetchJson,
    fetchText,
    HEADERS,
    ANILIST_API,
    VIDBOLT_API,
    VIDBOLT_HOME,
    VIDBOLT_MEGAPLAY_REFERER,
    DEFAULT_STREAM_REFERER
} from './http.js';

const ANILIST_ID_FROM_MAL_QUERY = `
query ($malId: Int) {
  Media(idMal: $malId, type: ANIME) {
    id
    idMal
    title { romaji english native }
    format
    episodes
    status
    nextAiringEpisode { episode airingAt }
  }
}
`;

const ANILIST_MEDIA_DETAIL_QUERY = `
query ($animeId: Int) {
  Media(id: $animeId, type: ANIME) {
    id
    idMal
    title { romaji english }
    format
    episodes
    status
    nextAiringEpisode { episode airingAt }
    relations {
      edges {
        relationType
        node {
          id
          idMal
          type
          format
          title { romaji english }
          episodes
        }
      }
    }
  }
}
`;

const ANILIST_SEARCH_QUERY = `
query ($search: String) {
  Page(page:1, perPage:10) {
    media(search:$search, type:ANIME) {
      id
      idMal
      title { romaji english native }
      format
      episodes
    }
  }
}
`;

// Language flags that mean "dubbed audio is wanted".
const DUB_LANGUAGE_FLAGS = ['dub', 'dubbed', 'en-dub', 'english-dub', 'english dub'];

// AniList blocks browser-like User-Agents on some egress IPs (verified:
// 403 with a Mozilla UA, 200 with a custom UA). Use a distinct UA for all
// AniList GraphQL traffic.
const ANILIST_UA = 'kitsune/0.1';

// TMDB API key for the TMDB -> MAL ladder. Optional: the keyless path (TMDB
// website <title> + Vidbolt /search) is tried first; the official API is only
// used as a fallback when a key is set via env TMDB_API_KEY.
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = (() => {
    try {
        return (typeof process !== 'undefined' && process.env && process.env.TMDB_API_KEY) || '';
    } catch (err) {
        return '';
    }
})();

// Season chain cache: root anilist id -> chain.
const seasonChainCache = new Map();

// Sentinel: the id is a real TMDB id but does not map to any anime.
const NOT_ANIME = { notAnime: true };

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

function _invalidateToken() {
    cachedToken = null;
    tokenExpiry = 0;
}

/**
 * Choose sub or dub audio.
 * 1. env KITSUNE_YENIME_AUDIO = sub|dub
 * 2. requested languages containing a dub flag
 * 3. default: sub
 */
function _audioType(languages) {
    let envAudio = '';
    try {
        envAudio = (typeof process !== 'undefined' && process.env && process.env.KITSUNE_YENIME_AUDIO)
            ? String(process.env.KITSUNE_YENIME_AUDIO).trim().toLowerCase()
            : '';
    } catch (err) {
        // env unavailable (Hermes / React Native)
    }

    if (envAudio === 'sub' || envAudio === 'dub') {
        return envAudio;
    }

    if (Array.isArray(languages) && languages.length) {
        const wanted = languages.map(l => String(l).toLowerCase().trim());
        if (wanted.some(w => DUB_LANGUAGE_FLAGS.includes(w))) {
            return 'dub';
        }
    }

    return 'sub';
}

async function _getVidboltToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
        return cachedToken;
    }
    try {
        const headers = {
            Accept: 'application/json',
            Referer: VIDBOLT_HOME,
            Origin: VIDBOLT_API,
        };
        const data = await postJson(`${VIDBOLT_API}/token`, {}, { headers });
        // Token response may be { token: '...' } or { data: { token: '...' } }
        const token = (data && (data.token || (data.data && data.data.token))) || null;
        if (!token) {
            throw new Error('No token in response');
        }
        cachedToken = token;
        // TTL ~2.5h
        tokenExpiry = now + 2.5 * 60 * 60 * 1000;
        console.log(`[Yenime] Vidbolt token refreshed`);
        return cachedToken;
    } catch (err) {
        console.error(`[Yenime] Token fetch failed: ${err.message}`);
        throw err;
    }
}

async function _requestMegaplay(malId, episode, audioType, token) {
    const url = `${VIDBOLT_API}/hianime/megaplay?malId=${encodeURIComponent(malId)}&ep=${encodeURIComponent(episode)}&type=${encodeURIComponent(audioType)}`;
    const headers = {
        ...HEADERS,
        Referer: VIDBOLT_MEGAPLAY_REFERER,
        'x-api-key': token,
        // Some endpoints also check Origin
        Origin: VIDBOLT_API,
    };
    console.log(`[Yenime] Fetching megaplay: ${url}`);

    let resp;
    try {
        resp = await fetch(url, { headers });
    } catch (err) {
        console.error(`[Yenime] Megaplay request failed: ${err.message}`);
        return { error: err.message };
    }

    // Stale/rejected token — caller invalidates and retries once.
    if (resp.status === 401 || resp.status === 403) {
        return { authStatus: resp.status };
    }

    if (!resp.ok) {
        console.log(`[Yenime] Megaplay HTTP ${resp.status}`);
        return { error: `http ${resp.status}` };
    }

    try {
        return await resp.json();
    } catch (err) {
        console.error('[Yenime] Megaplay returned non-JSON payload');
        return { error: 'json' };
    }
}

async function _fetchVidboltStreams(malId, episode, audioType) {
    let token = await _getVidboltToken();
    let data = await _requestMegaplay(malId, episode, audioType, token);

    // Token rejected (401/403): invalidate the cache and retry once with a fresh token.
    if (data && typeof data.authStatus === 'number') {
        console.log(`[Yenime] Megaplay auth rejected (HTTP ${data.authStatus}), refreshing token and retrying`);
        _invalidateToken();
        token = await _getVidboltToken();
        data = await _requestMegaplay(malId, episode, audioType, token);
    }

    if (!data || data.error) {
        return { streams: [], subtitles: [] };
    }

    return _parseVidboltResponse(malId, episode, audioType, data);
}

async function _expandHls(masterUrl, headers) {
    try {
        const text = await fetchText(masterUrl, { headers });
        // Parse master playlist for variants
        const variants = [];
        const lines = text.split(/\r?\n/);
        let currentInfo = null;
        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                currentInfo = line;
            } else if (line && !line.startsWith('#') && currentInfo) {
                const uri = line.startsWith('http') ? line : baseUrl + line;
                const resMatch = currentInfo.match(/RESOLUTION=(\d+x\d+)/);
                const bwMatch = currentInfo.match(/BANDWIDTH=(\d+)/);
                let quality = 'auto';
                if (resMatch) {
                    const height = resMatch[1].split('x')[1];
                    quality = `${height}p`;
                } else if (bwMatch) {
                    quality = `${Math.round(parseInt(bwMatch[1], 10) / 1000)}k`;
                }
                variants.push({
                    url: uri,
                    quality,
                    resolution: resMatch ? resMatch[1] : null,
                    bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : null
                });
                currentInfo = null;
            }
        }
        if (variants.length > 0) {
            return variants;
        }
        // Fallback: single playlist
        return [{ url: masterUrl, quality: 'auto' }];
    } catch (err) {
        console.error(`[Yenime] HLS expand failed: ${err.message}`);
        return [{ url: masterUrl, quality: 'auto' }];
    }
}

function _originFromUrl(url) {
    const match = String(url).match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : String(url).replace(/\/+$/, '');
}

function _parseSubtitles(items) {
    const out = [];
    if (!items) {
        return out;
    }
    const list = Array.isArray(items) ? items : [items];

    for (const item of list) {
        let url = null;
        let language = 'und';

        if (typeof item === 'string') {
            url = item;
        } else if (item && typeof item === 'object') {
            url = item.url || item.file || item.src || item.path || item.link;
            language = item.language || item.lang || item.label || item.name || item.code || 'und';
        }

        if (!url) {
            continue;
        }

        url = String(url);
        if (url.startsWith('//')) {
            url = `https:${url}`;
        } else if (url.startsWith('/')) {
            url = VIDBOLT_API + url;
        }

        if (!url.startsWith('http')) {
            continue;
        }

        const lowered = url.toLowerCase();
        // Extension may be in the query string for proxy URLs
        // (e.g. .../proxy/stream?url=...eng-2.vtt&referer=...), so match anywhere.
        const extMatch = lowered.match(/\.(vtt|ass|ssa)(?:[&?]|$)/);
        const format = extMatch ? extMatch[1] : 'srt';

        const normalizedLang = String(language).toLowerCase().trim().replace(/_/g, '-').split('-')[0] || 'und';

        out.push({ url, lang: normalizedLang, format });
    }

    return out;
}

async function _parseVidboltResponse(malId, episode, audioType, data) {
    const streams = [];
    const allSubtitles = [];

    // Try common shapes (live API returns { streams: [...] })
    let sources = data?.streams || data?.sources || data?.data?.streams || data?.data?.sources || data?.result?.sources || data?.links;
    if (!Array.isArray(sources) || sources.length === 0) {
        if (Array.isArray(data)) {
            sources = data;
        } else {
            console.log(`[Yenime] No sources found in megaplay response`);
            return { streams: [], subtitles: [] };
        }
    }

    for (const src of sources) {
        if (!src || typeof src !== 'object') {
            continue;
        }

        const url = src.url || src.file || src.link || src.src;
        if (!url) {
            continue;
        }

        // Use the source's own referer when provided, else the default stream referer.
        const referer = src.referer || src.referrer || DEFAULT_STREAM_REFERER;
        const streamHeaders = {
            Referer: referer,
            'User-Agent': HEADERS['User-Agent'],
            Origin: _originFromUrl(referer),
        };

        const rawSubs = src.subtitles || src.captions || src.tracks || [];
        const subtitlesForStream = _parseSubtitles(rawSubs);
        for (const sub of subtitlesForStream) {
            sub.headers = streamHeaders;
            allSubtitles.push(sub);
        }

        const label = src.label || src.quality || src.res || src.height || 'auto';
        const type = String(src.type || '').toLowerCase();
        const isHls = type.includes('hls') || String(url).includes('.m3u8');

        if (isHls) {
            const variants = await _expandHls(url, streamHeaders);
            for (const v of variants) {
                streams.push({
                    name: 'Yenime',
                    title: `${v.quality} ${audioType.toUpperCase()}`,
                    url: v.url,
                    quality: v.quality,
                    headers: streamHeaders
                });
            }
        } else {
            streams.push({
                name: 'Yenime',
                title: `${label} ${audioType.toUpperCase()}`,
                url,
                quality: label,
                headers: streamHeaders
            });
        }
    }

    return {
        streams: _dedupeStreams(streams),
        subtitles: _dedupeSubtitles(allSubtitles),
    };
}

function _dedupeStreams(streams) {
    const unique = [];
    const seen = new Set();

    for (const stream of streams) {
        const referer = (stream.headers && stream.headers.Referer) || '';
        const key = `${stream.url}|${stream.quality}|${referer}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(stream);
    }

    unique.sort((a, b) => (_resolutionHeight(b.quality) || 0) - (_resolutionHeight(a.quality) || 0));
    return unique;
}

function _dedupeSubtitles(subtitles) {
    const unique = [];
    const seen = new Set();

    for (const sub of subtitles) {
        const key = `${sub.url}|${sub.lang}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(sub);
    }

    return unique;
}

function _resolutionHeight(quality) {
    if (!quality) {
        return 0;
    }
    const text = String(quality).toLowerCase();
    const pMatch = text.match(/(\d+)p/);
    if (pMatch) {
        return parseInt(pMatch[1], 10);
    }
    const xyMatch = text.match(/(\d+)x(\d+)/);
    if (xyMatch) {
        return parseInt(xyMatch[2], 10);
    }
    const numMatch = text.match(/(\d{3,4})/);
    if (numMatch) {
        return parseInt(numMatch[1], 10);
    }
    return 0;
}

/** Attach the (deduped) subtitle list to every stream object. */
function _toNuvioStreams(streams, subtitles) {
    if (!subtitles.length) {
        return streams;
    }
    return streams.map(s => Object.assign({}, s, { subtitles }));
}

export async function extractStreams(tmdbId, mediaType, season, episode, languages) {
    try {
        // For Yenime, the incoming id may be MAL, AniList, or TMDB.
        let resolved = await _resolveInput(tmdbId, mediaType);

        // A valid TMDB id with no anime match is a definitive miss: do not
        // guess at MAL ids (they collide, e.g. TMDB 9999 -> MAL 9999 could be
        // an anime with content).
        if (resolved && resolved.notAnime) {
            console.log(`[Yenime] ${tmdbId} is a known TMDB id with no anime match; returning no streams`);
            return [];
        }

        // AniList unreachable or id not found there: fall back to treating the
        // incoming id as a MAL id (kitsune convention). Movies and season-1
        // streams only need the MAL id, so they keep working without AniList.
        if (!resolved || !resolved.malId) {
            const numeric = parseInt(tmdbId, 10);
            if (!isNaN(numeric)) {
                console.log(`[Yenime] Resolver miss for ${tmdbId}, falling back to MAL-direct (kitsune convention)`);
                resolved = { malId: numeric, anilistId: null, media: null, source: 'mal-fallback' };
            }
        }

        if (!resolved || !resolved.malId) {
            console.log(`[Yenime] Could not resolve id to MAL/AniList: ${tmdbId}`);
            return [];
        }

        const malId = resolved.malId;
        const isMovie = String(mediaType || '').toLowerCase() === 'movie';
        const seasonNum = parseInt(season, 10) || 1;
        const episodeNum = isMovie ? 1 : (parseInt(episode, 10) || 1);

        const audioType = _audioType(languages);

        // Movies are exposed as episode 1 on the stream backend — no season chain needed.
        if (isMovie) {
            console.log(`[Yenime] Movie MAL ${malId} -> episode 1 (${audioType})`);
            let res = await _fetchVidboltStreams(malId, 1, audioType);

            // Dub requested but nothing came back: fall back to sub.
            if (!res.streams.length && audioType === 'dub') {
                console.log('[Yenime] No dub streams, falling back to sub');
                res = await _fetchVidboltStreams(malId, 1, 'sub');
            }

            console.log(`[Yenime] Parsed ${res.streams.length} streams`);
            return _toNuvioStreams(res.streams, res.subtitles);
        }

        const info = resolved.media;
        const rootTitle = (info && info.title && (info.title.english || info.title.romaji)) || 'Unknown';
        console.log(`[Yenime] Found: ${rootTitle} | MAL:${resolved.malId} | AniList:${resolved.anilistId} | source:${resolved.source}`);

        // Build season chain for show/episode info (cached per root AniList id)
        const chain = await buildSeasonChain(resolved.anilistId);
        console.log(`[Yenime] Season chain length: ${chain.length}`);
        chain.forEach(s => console.log(`  S${s.season_number}: ${s.title} - MAL:${s.mal_id} - AniList:${s.anilist_id} - Ep:${s.episodes}`));

        // Resolve season specific MAL id
        const seasonInfo = chain.find(s => s.season_number === seasonNum);
        const resolvedMalId = seasonInfo?.mal_id || malId;
        if (seasonInfo) {
            console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}, MAL ${seasonInfo.mal_id}`);
        } else {
            console.log(`[Yenime] Season ${seasonNum} not found in chain, using root MAL ${malId}`);
        }

        console.log(`[Yenime] Requested episode ${episodeNum} of season ${seasonNum} (MAL ${resolvedMalId}, ${audioType})`);

        // Fetch streams from Vidbolt
        let res = await _fetchVidboltStreams(resolvedMalId, episodeNum, audioType);

        // Dub requested but nothing came back: fall back to sub.
        if (!res.streams.length && audioType === 'dub') {
            console.log('[Yenime] No dub streams, falling back to sub');
            res = await _fetchVidboltStreams(resolvedMalId, episodeNum, 'sub');
        }

        console.log(`[Yenime] Parsed ${res.streams.length} streams`);
        return _toNuvioStreams(res.streams, res.subtitles);
    } catch (err) {
        console.error(`[Yenime] Error: ${err.message}`);
        return [];
    }
}

async function anilistWithRetry(query, variables, maxAttempts = 3) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const data = await postJson(ANILIST_API, { query, variables }, {
        headers: { 'User-Agent': ANILIST_UA },
      });
      if (data?.errors) {
        throw new Error(data.errors.map(e => e.message).join('; '));
      }
      return data;
    } catch (err) {
      lastErr = err;
      const wait = 500 * Math.pow(2, i);
      console.warn(`[Yenime] AniList request failed attempt ${i+1}/${maxAttempts}: ${err.message}, retry in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Search AniList by title */
export async function searchAnime(query) {
    const data = await anilistWithRetry(ANILIST_SEARCH_QUERY, { search: query });
    const media = data?.data?.Page?.media || [];
    return media.map(m => ({
        anilistId: m.id,
        malId: m.idMal,
        title: m.title?.english || m.title?.romaji,
        format: m.format,
        episodes: m.episodes
    }));
}

async function getAnimeInfoByMal(malId) {
    const data = await anilistWithRetry(ANILIST_ID_FROM_MAL_QUERY, { malId });
    return data?.data?.Media || null;
}

async function getAnimeDetail(anilistId, maxAttempts = 3) {
    const data = await anilistWithRetry(ANILIST_MEDIA_DETAIL_QUERY, { animeId: anilistId }, maxAttempts);
    return data?.data?.Media || null;
}

/**
 * Resolve the incoming Nuvio tmdbId to a MAL id + AniList id.
 *
 * Nuvio passes TMDB ids, and TMDB ids collide with MAL ids (e.g. TMDB 37854
 * is One Piece while MAL 37854 is an unrelated 2015 show), so the TMDB step
 * must come FIRST; MAL/AniList passthrough is only used when the TMDB id has
 * no TMDB page (kitsune-style traffic). Each step is individually guarded so
 * an AniList outage cannot break the TMDB path (Vidbolt search needs no
 * AniList).
 */
async function _resolveInput(input, mediaType) {
    if (typeof input !== 'number' && !/^\d+$/.test(String(input))) {
        return null;
    }
    const id = parseInt(input, 10);

    // L-TMDB: Nuvio traffic. Keyless via TMDB page title -> Vidbolt search.
    const viaTmdb = await _resolveViaTmdb(id, mediaType);
    if (viaTmdb === NOT_ANIME) {
        // Real TMDB id, no anime behind it — do not guess MAL ids (collisions
        // can serve wrong content, e.g. TMDB 456 "The Simpsons" vs MAL 456).
        return NOT_ANIME;
    }
    if (viaTmdb) {
        return viaTmdb;
    }

    // L-MAL: kitsune convention (TMDB lookup failed -> id likely is a MAL id).
    let infoByMal = null;
    try {
        infoByMal = await getAnimeInfoByMal(id);
    } catch (err) {
        console.warn(`[Yenime] L-MAL lookup failed for ${id}: ${err.message}`);
    }
    if (infoByMal) {
        return { malId: id, anilistId: infoByMal.id, media: infoByMal, source: 'mal' };
    }

    // L-AL: AniList id.
    let infoById = null;
    try {
        infoById = await getAnimeDetail(id);
    } catch (err) {
        console.warn(`[Yenime] L-AL lookup failed for ${id}: ${err.message}`);
    }
    if (infoById) {
        return { malId: infoById.idMal || id, anilistId: id, media: infoById, source: 'anilist' };
    }

    return null;
}

async function _resolveViaTmdb(tmdbId, mediaType) {
    const kind = String(mediaType || '').toLowerCase() === 'movie' ? 'movie' : 'tv';

    // TMDB title + year, keyless via the TMDB website. JSON-LD dates are DB
    // entry timestamps, so parse the <title> tag instead:
    //   "Your Name. (2016) &#8212; The Movie Database (TMDB)"
    //   "One Piece (TV Series 1999) &#8212; The Movie Database (TMDB)"
    let meta = null;
    let pageLoaded = false;
    try {
        meta = await _tmdbPageMeta(tmdbId, kind);
        pageLoaded = true;
    } catch (err) {
        console.warn(`[Yenime] TMDB page lookup failed for ${tmdbId}: ${err.message}`);
    }
    if (!meta && TMDB_API_KEY) {
        // Fallback to the official API when a key is available.
        try {
            const url = `${TMDB_API_BASE}/${kind}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
            const info = await fetchJson(url, {
                headers: { Accept: 'application/json', 'User-Agent': ANILIST_UA },
            });
            const apiTitle = info && (info.title || info.name);
            const apiYear = String(info && (info.release_date || info.first_air_date) || '').slice(0, 4);
            if (apiTitle) {
                meta = { title: apiTitle, year: parseInt(apiYear, 10) || 0 };
                pageLoaded = true;
            }
        } catch (err) {
            console.warn(`[Yenime] TMDB API lookup failed for ${tmdbId}: ${err.message}`);
        }
    }
    if (!meta && !pageLoaded) {
        // The id may exist under the other kind (the app can mislabel a movie
        // as tv or vice versa) — one cheap cross-kind retry before giving up.
        try {
            const otherKind = kind === 'movie' ? 'tv' : 'movie';
            const otherMeta = await _tmdbPageMeta(tmdbId, otherKind);
            if (otherMeta && otherMeta.title) {
                meta = otherMeta;
                pageLoaded = true;
            }
        } catch (err) {
            console.warn(`[Yenime] TMDB cross-kind lookup failed for ${tmdbId}: ${err.message}`);
        }
    }
    if (!meta || !meta.title) {
        if (!pageLoaded) {
            // No TMDB page for this id (404/unreachable) — the ladder should
            // keep going and try MAL / AniList ids.
            console.warn(`[Yenime] No TMDB page for ${tmdbId}; trying MAL/AniList ids`);
            return null;
        }
        // Page loaded but title unusable — treat as not-anime (conservative).
        return NOT_ANIME;
    }

    // Primary: Vidbolt keyword search (no AniList dependency).
    const viaVidbolt = await _vidboltSearchByTitle(meta.title, meta.year, mediaType);
    if (viaVidbolt) {
        console.log(`[Yenime] TMDB ${tmdbId} -> MAL ${viaVidbolt.malId} "${meta.title}" (Vidbolt search)`);
        return { malId: viaVidbolt.malId, anilistId: viaVidbolt.anilistId, media: null, source: 'tmdb' };
    }

    // Backup: AniList title+year search.
    let media = null;
    try {
        media = await _searchAnilistByTitle(meta.title, meta.year);
    } catch (err) {
        console.warn(`[Yenime] AniList title search failed: ${err.message}`);
    }
    if (!media) {
        console.warn(`[Yenime] TMDB ${tmdbId} ("${meta.title}", ${meta.year}) exists but has no anime match`);
        return NOT_ANIME;
    }

    console.log(`[Yenime] TMDB ${tmdbId} -> MAL ${media.idMal} (${media.title.english || media.title.romaji})`);
    return { malId: media.idMal, anilistId: media.id, media, source: 'tmdb' };
}

// Fetch the TMDB page and extract { title, year } from its <title> tag.
async function _tmdbPageMeta(tmdbId, kind) {
    const url = `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(tmdbId)}`;
    const html = await fetchText(url, {
        headers: {
            'User-Agent': HEADERS['User-Agent'],
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    const match = html.match(/<title>(.*?)<\/title>/i);
    if (!match) {
        return null;
    }
    const raw = match[1].replace(/&#8212;.*$/i, ''); // strip "— The Movie Database (TMDB)"
    // Decode common entities; normalize apostrophes to the straight form so
    // they match the Vidbolt backend's stored titles (which use U+2019).
    const title = raw
        .replace(/&amp;/g, '&')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#821[67];|&#x201[89];/g, "'")
        .trim();

    // Accept "(TV Series 1999)", "(TV Series)" (no year, e.g. duplicate/alt
    // TMDB entries), and year ranges like "(TV Series 2023\u20132024)".
    const tvMatch = title.match(/^(.*?)\s*\(TV Series(?:\s+(\d{4})(?:[\u2013\u2014-]\d{4})?)?\)\s*$/i);
    if (tvMatch) {
        return { title: tvMatch[1].trim(), year: tvMatch[2] ? parseInt(tvMatch[2], 10) : 0 };
    }
    const movieMatch = title.match(/^(.*?)\s*\((\d{4})\)\s*$/i);
    if (movieMatch) {
        return { title: movieMatch[1].trim(), year: parseInt(movieMatch[2], 10) };
    }
    return { title, year: 0 };
}

// Search the Vidbolt backend for a MAL id by title. The /search endpoint
// returns AniList-based results that include both `id` (AniList) and `malId`,
// so no AniList GraphQL call is needed for the common TMDB -> MAL case.
async function _vidboltSearchByTitle(title, year, mediaType) {
    let token = null;
    try {
        token = await _getVidboltToken();
    } catch (err) {
        return null;
    }

    let data = null;
    try {
        const url = `${VIDBOLT_API}/search?q=${encodeURIComponent(title)}`;
        data = await fetchJson(url, {
            headers: {
                Accept: 'application/json',
                Referer: VIDBOLT_HOME,
                Origin: VIDBOLT_API,
                'x-api-key': token,
            },
        });
    } catch (err) {
        console.warn(`[Yenime] Vidbolt search failed: ${err.message}`);
        return null;
    }

    const results = (data && data.results) || [];
    if (!results.length) {
        return null;
    }

    const wantYear = parseInt(year, 10);
    const wantMovie = String(mediaType || '').toLowerCase() === 'movie';
    // Normalize case and apostrophe variants (U+2019 vs U+0027 etc.) so
    // TMDB-derived titles match the backend's stored titles exactly.
    const norm = (v) => String(v || '').toLowerCase().replace(/[\u2018\u2019\u02BB\u02BC]/g, "'").trim();
    const normalized = norm(title);

    // Score each result: exact title match dominates; format preference and
    // year proximity break ties; collab CMs / side content (SPECIAL/ONA/OVA)
    // are demoted so e.g. "Your Name." (MOVIE) beats the Suntory collab CM.
    let best = null;
    let bestScore = -Infinity;
    for (const r of results) {
        if (!r.malId) continue;
        const t = norm(r.title);
        const ro = norm(r.titleRomaji);
        let score = 0;
        if (t === normalized || ro === normalized) {
            score += 100;
        } else if (t.includes(normalized) || normalized.includes(t) || ro.includes(normalized) || normalized.includes(ro)) {
            score += 40;
        }
        const fmt = String(r.format || '').toUpperCase();
        if (wantMovie && fmt === 'MOVIE') score += 20;
        if (!wantMovie && fmt === 'TV') score += 20;
        if (fmt === 'SPECIAL' || fmt === 'ONA' || fmt === 'OVA') score -= 10;
        if (wantYear) {
            const ry = parseInt(r.year, 10);
            if (ry === wantYear) score += 15;
            else if (ry && Math.abs(ry - wantYear) <= 1) score += 5;
        }
        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    }

    // Require title affinity (exact/contains) adjusted by format/year bonuses;
    // a bare year-or-first pick can map a non-anime TMDB entry to an unrelated
    // show.
    if (!best || bestScore < 40) {
        return null;
    }
    return { malId: parseInt(best.malId, 10), anilistId: best.id, title: best.title };
}

const ANILIST_TITLE_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME) {
      id
      idMal
      format
      startDate { year }
      title { romaji english }
    }
  }
}
`;

async function _searchAnilistByTitle(title, year) {
    let data;
    try {
        data = await anilistWithRetry(ANILIST_TITLE_SEARCH_QUERY, { search: title });
    } catch (err) {
        console.warn(`[Yenime] AniList title search failed: ${err.message}`);
        return null;
    }

    const list = (data && data.data && data.data.Page && data.data.Page.media) || [];
    if (!list.length) {
        return null;
    }

    const wantYear = parseInt(year, 10);
    if (wantYear) {
        const exact = list.find(m => m.startDate && m.startDate.year === wantYear);
        if (exact) {
            return exact;
        }
        const near = list.find(m => m.startDate && Math.abs(m.startDate.year - wantYear) <= 1);
        if (near) {
            return near;
        }
        // Year given but nothing matches: do not blindly take the first result.
        return null;
    }

    return list[0];
}

async function buildSeasonChain(rootAnilistId) {
    if (seasonChainCache.has(rootAnilistId)) {
        return seasonChainCache.get(rootAnilistId);
    }
    if (!rootAnilistId) {
        return [];
    }
    const chain = [];
    const seen = new Set();
    let currentId = rootAnilistId;

    try {
        while (currentId && !seen.has(currentId) && chain.length < 20) {
            seen.add(currentId);
            // Lighter retry budget inside chains: a slow/blocked AniList must
            // not stall stream delivery for minutes.
            const media = await getAnimeDetail(currentId, 2);
            if (!media) break;

            chain.push({
                season_number: chain.length + 1,
                anilist_id: media.id,
                mal_id: media.idMal,
                title: media.title?.english || media.title?.romaji || 'Unknown',
                format: media.format,
                episodes: media.episodes || 0
            });

            // Find SEQUEL
            const sequel = (media.relations?.edges || []).find(e => e.relationType === 'SEQUEL' && e.node?.type === 'ANIME');
            currentId = sequel?.node?.id || null;
        }
        seasonChainCache.set(rootAnilistId, chain);
    } catch (err) {
        // AniList down/rate-limited: return whatever we have (possibly empty).
        // Callers fall back to the root MAL id, which is correct for season 1.
        console.warn(`[Yenime] Season chain build interrupted for ${rootAnilistId}: ${err.message}`);
        if (!chain.length) {
            console.warn('[Yenime] Using root MAL id for season resolution');
        }
    }
    return chain;
}
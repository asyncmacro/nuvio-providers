/**
 * yenime - Built from src/yenime/
 * Generated: 2026-08-15T23:40:10.277Z
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/yenime/http.js
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};
var VIDBOLT_API = "https://hianime.filmu.in";
var VIDBOLT_HOME = "https://hianime.filmu.in/";
var VIDBOLT_MEGAPLAY_REFERER = "https://hianime.filmu.in/hianime/megaplay";
var DEFAULT_STREAM_REFERER = "https://megaplay.buzz/";
var ANILIST_API = "https://graphql.anilist.co";
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    console.log(`[Template] Fetching: ${url}`);
    const _a = options, { headers: extraHeaders } = _a, rest = __objRest(_a, ["headers"]);
    const response = yield fetch(url, __spreadValues({
      headers: __spreadValues(__spreadValues({}, HEADERS), extraHeaders || {})
    }, rest));
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} for ${url}`);
    }
    return yield response.text();
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const raw = yield fetchText(url, options);
    return JSON.parse(raw);
  });
}
function postJson(_0, _1) {
  return __async(this, arguments, function* (url, data, options = {}) {
    const _a = options, { headers: extraHeaders } = _a, rest = __objRest(_a, ["headers"]);
    const response = yield fetch(url, __spreadValues({
      method: "POST",
      headers: __spreadValues(__spreadValues({
        "Content-Type": "application/json"
      }, HEADERS), extraHeaders || {}),
      body: JSON.stringify(data)
    }, rest));
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} for ${url}`);
    }
    return yield response.json();
  });
}

// src/yenime/extractor.js
var ANILIST_ID_FROM_MAL_QUERY = `
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
var ANILIST_MEDIA_DETAIL_QUERY = `
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
var DUB_LANGUAGE_FLAGS = ["dub", "dubbed", "en-dub", "english-dub", "english dub"];
var ANILIST_UA = "kitsune/0.1";
var TMDB_API_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = (() => {
  try {
    return typeof process !== "undefined" && process.env && process.env.TMDB_API_KEY || "";
  } catch (err) {
    return "";
  }
})();
var seasonChainCache = /* @__PURE__ */ new Map();
var NOT_ANIME = { notAnime: true };
var cachedToken = null;
var tokenExpiry = 0;
function _invalidateToken() {
  cachedToken = null;
  tokenExpiry = 0;
}
function _audioType(languages) {
  let envAudio = "";
  try {
    envAudio = typeof process !== "undefined" && process.env && process.env.KITSUNE_YENIME_AUDIO ? String(process.env.KITSUNE_YENIME_AUDIO).trim().toLowerCase() : "";
  } catch (err) {
  }
  if (envAudio === "sub" || envAudio === "dub") {
    return envAudio;
  }
  if (Array.isArray(languages) && languages.length) {
    const wanted = languages.map((l) => String(l).toLowerCase().trim());
    if (wanted.some((w) => DUB_LANGUAGE_FLAGS.includes(w))) {
      return "dub";
    }
  }
  return "sub";
}
function _getVidboltToken() {
  return __async(this, null, function* () {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
      return cachedToken;
    }
    try {
      const headers = {
        Accept: "application/json",
        Referer: VIDBOLT_HOME,
        Origin: VIDBOLT_API
      };
      const data = yield postJson(`${VIDBOLT_API}/token`, {}, { headers });
      const token = data && (data.token || data.data && data.data.token) || null;
      if (!token) {
        throw new Error("No token in response");
      }
      cachedToken = token;
      tokenExpiry = now + 2.5 * 60 * 60 * 1e3;
      console.log(`[Yenime] Vidbolt token refreshed`);
      return cachedToken;
    } catch (err) {
      console.error(`[Yenime] Token fetch failed: ${err.message}`);
      throw err;
    }
  });
}
function _requestMegaplay(malId, episode, audioType, token) {
  return __async(this, null, function* () {
    const url = `${VIDBOLT_API}/hianime/megaplay?malId=${encodeURIComponent(malId)}&ep=${encodeURIComponent(episode)}&type=${encodeURIComponent(audioType)}`;
    const headers = __spreadProps(__spreadValues({}, HEADERS), {
      Referer: VIDBOLT_MEGAPLAY_REFERER,
      "x-api-key": token,
      // Some endpoints also check Origin
      Origin: VIDBOLT_API
    });
    console.log(`[Yenime] Fetching megaplay: ${url}`);
    let resp;
    try {
      resp = yield fetch(url, { headers });
    } catch (err) {
      console.error(`[Yenime] Megaplay request failed: ${err.message}`);
      return { error: err.message };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { authStatus: resp.status };
    }
    if (!resp.ok) {
      console.log(`[Yenime] Megaplay HTTP ${resp.status}`);
      return { error: `http ${resp.status}` };
    }
    try {
      return yield resp.json();
    } catch (err) {
      console.error("[Yenime] Megaplay returned non-JSON payload");
      return { error: "json" };
    }
  });
}
function _fetchVidboltStreams(malId, episode, audioType) {
  return __async(this, null, function* () {
    let token = yield _getVidboltToken();
    let data = yield _requestMegaplay(malId, episode, audioType, token);
    if (data && typeof data.authStatus === "number") {
      console.log(`[Yenime] Megaplay auth rejected (HTTP ${data.authStatus}), refreshing token and retrying`);
      _invalidateToken();
      token = yield _getVidboltToken();
      data = yield _requestMegaplay(malId, episode, audioType, token);
    }
    if (!data || data.error) {
      return { streams: [], subtitles: [] };
    }
    return _parseVidboltResponse(malId, episode, audioType, data);
  });
}
function _expandHls(masterUrl, headers) {
  return __async(this, null, function* () {
    try {
      const text = yield fetchText(masterUrl, { headers });
      const variants = [];
      const lines = text.split(/\r?\n/);
      let currentInfo = null;
      const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          currentInfo = line;
        } else if (line && !line.startsWith("#") && currentInfo) {
          const uri = line.startsWith("http") ? line : baseUrl + line;
          const resMatch = currentInfo.match(/RESOLUTION=(\d+x\d+)/);
          const bwMatch = currentInfo.match(/BANDWIDTH=(\d+)/);
          let quality = "auto";
          if (resMatch) {
            const height = resMatch[1].split("x")[1];
            quality = `${height}p`;
          } else if (bwMatch) {
            quality = `${Math.round(parseInt(bwMatch[1], 10) / 1e3)}k`;
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
      return [{ url: masterUrl, quality: "auto" }];
    } catch (err) {
      console.error(`[Yenime] HLS expand failed: ${err.message}`);
      return [{ url: masterUrl, quality: "auto" }];
    }
  });
}
function _originFromUrl(url) {
  const match = String(url).match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : String(url).replace(/\/+$/, "");
}
function _parseSubtitles(items) {
  const out = [];
  if (!items) {
    return out;
  }
  const list = Array.isArray(items) ? items : [items];
  for (const item of list) {
    let url = null;
    let language = "und";
    if (typeof item === "string") {
      url = item;
    } else if (item && typeof item === "object") {
      url = item.url || item.file || item.src || item.path || item.link;
      language = item.language || item.lang || item.label || item.name || item.code || "und";
    }
    if (!url) {
      continue;
    }
    url = String(url);
    if (url.startsWith("//")) {
      url = `https:${url}`;
    } else if (url.startsWith("/")) {
      url = VIDBOLT_API + url;
    }
    if (!url.startsWith("http")) {
      continue;
    }
    const lowered = url.toLowerCase();
    const extMatch = lowered.match(/\.(vtt|ass|ssa)(?:[&?]|$)/);
    const format = extMatch ? extMatch[1] : "srt";
    const normalizedLang = String(language).toLowerCase().trim().replace(/_/g, "-").split("-")[0] || "und";
    out.push({ url, lang: normalizedLang, format });
  }
  return out;
}
function _parseVidboltResponse(malId, episode, audioType, data) {
  return __async(this, null, function* () {
    var _a, _b, _c;
    const streams = [];
    const allSubtitles = [];
    let sources = (data == null ? void 0 : data.streams) || (data == null ? void 0 : data.sources) || ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.streams) || ((_b = data == null ? void 0 : data.data) == null ? void 0 : _b.sources) || ((_c = data == null ? void 0 : data.result) == null ? void 0 : _c.sources) || (data == null ? void 0 : data.links);
    if (!Array.isArray(sources) || sources.length === 0) {
      if (Array.isArray(data)) {
        sources = data;
      } else {
        console.log(`[Yenime] No sources found in megaplay response`);
        return { streams: [], subtitles: [] };
      }
    }
    for (const src of sources) {
      if (!src || typeof src !== "object") {
        continue;
      }
      const url = src.url || src.file || src.link || src.src;
      if (!url) {
        continue;
      }
      const referer = src.referer || src.referrer || DEFAULT_STREAM_REFERER;
      const streamHeaders = {
        Referer: referer,
        "User-Agent": HEADERS["User-Agent"],
        Origin: _originFromUrl(referer)
      };
      const rawSubs = src.subtitles || src.captions || src.tracks || [];
      const subtitlesForStream = _parseSubtitles(rawSubs);
      for (const sub of subtitlesForStream) {
        sub.headers = streamHeaders;
        allSubtitles.push(sub);
      }
      const label = src.label || src.quality || src.res || src.height || "auto";
      const type = String(src.type || "").toLowerCase();
      const isHls = type.includes("hls") || String(url).includes(".m3u8");
      if (isHls) {
        const variants = yield _expandHls(url, streamHeaders);
        for (const v of variants) {
          streams.push({
            name: "Yenime",
            title: `${v.quality} ${audioType.toUpperCase()}`,
            url: v.url,
            quality: v.quality,
            headers: streamHeaders
          });
        }
      } else {
        streams.push({
          name: "Yenime",
          title: `${label} ${audioType.toUpperCase()}`,
          url,
          quality: label,
          headers: streamHeaders
        });
      }
    }
    return {
      streams: _dedupeStreams(streams),
      subtitles: _dedupeSubtitles(allSubtitles)
    };
  });
}
function _dedupeStreams(streams) {
  const unique = [];
  const seen = /* @__PURE__ */ new Set();
  for (const stream of streams) {
    const referer = stream.headers && stream.headers.Referer || "";
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
  const seen = /* @__PURE__ */ new Set();
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
function _toNuvioStreams(streams, subtitles) {
  if (!subtitles.length) {
    return streams;
  }
  return streams.map((s) => Object.assign({}, s, { subtitles }));
}
function extractStreams(tmdbId, mediaType, season, episode, languages) {
  return __async(this, null, function* () {
    try {
      let resolved = yield _resolveInput(tmdbId, mediaType);
      if (resolved && resolved.notAnime) {
        console.log(`[Yenime] ${tmdbId} is a known TMDB id with no anime match; returning no streams`);
        return [];
      }
      if (!resolved || !resolved.malId) {
        const numeric = parseInt(tmdbId, 10);
        if (!isNaN(numeric)) {
          console.log(`[Yenime] Resolver miss for ${tmdbId}, falling back to MAL-direct (kitsune convention)`);
          resolved = { malId: numeric, anilistId: null, media: null, source: "mal-fallback" };
        }
      }
      if (!resolved || !resolved.malId) {
        console.log(`[Yenime] Could not resolve id to MAL/AniList: ${tmdbId}`);
        return [];
      }
      const malId = resolved.malId;
      const isMovie = String(mediaType || "").toLowerCase() === "movie";
      const seasonNum = parseInt(season, 10) || 1;
      const episodeNum = isMovie ? 1 : parseInt(episode, 10) || 1;
      const audioType = _audioType(languages);
      if (isMovie) {
        console.log(`[Yenime] Movie MAL ${malId} -> episode 1 (${audioType})`);
        let res2 = yield _fetchVidboltStreams(malId, 1, audioType);
        if (!res2.streams.length && audioType === "dub") {
          console.log("[Yenime] No dub streams, falling back to sub");
          res2 = yield _fetchVidboltStreams(malId, 1, "sub");
        }
        console.log(`[Yenime] Parsed ${res2.streams.length} streams`);
        return _toNuvioStreams(res2.streams, res2.subtitles);
      }
      const info = resolved.media;
      const rootTitle = info && info.title && (info.title.english || info.title.romaji) || "Unknown";
      console.log(`[Yenime] Found: ${rootTitle} | MAL:${resolved.malId} | AniList:${resolved.anilistId} | source:${resolved.source}`);
      const chain = yield buildSeasonChain(resolved.anilistId);
      console.log(`[Yenime] Season chain length: ${chain.length}`);
      chain.forEach((s) => console.log(`  S${s.season_number}: ${s.title} - MAL:${s.mal_id} - AniList:${s.anilist_id} - Ep:${s.episodes}`));
      const seasonInfo = chain.find((s) => s.season_number === seasonNum);
      const resolvedMalId = (seasonInfo == null ? void 0 : seasonInfo.mal_id) || malId;
      if (seasonInfo) {
        console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}, MAL ${seasonInfo.mal_id}`);
      } else {
        console.log(`[Yenime] Season ${seasonNum} not found in chain, using root MAL ${malId}`);
      }
      console.log(`[Yenime] Requested episode ${episodeNum} of season ${seasonNum} (MAL ${resolvedMalId}, ${audioType})`);
      let res = yield _fetchVidboltStreams(resolvedMalId, episodeNum, audioType);
      if (!res.streams.length && audioType === "dub") {
        console.log("[Yenime] No dub streams, falling back to sub");
        res = yield _fetchVidboltStreams(resolvedMalId, episodeNum, "sub");
      }
      console.log(`[Yenime] Parsed ${res.streams.length} streams`);
      return _toNuvioStreams(res.streams, res.subtitles);
    } catch (err) {
      console.error(`[Yenime] Error: ${err.message}`);
      return [];
    }
  });
}
function anilistWithRetry(query, variables, maxAttempts = 3) {
  return __async(this, null, function* () {
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const data = yield postJson(ANILIST_API, { query, variables }, {
          headers: { "User-Agent": ANILIST_UA }
        });
        if (data == null ? void 0 : data.errors) {
          throw new Error(data.errors.map((e) => e.message).join("; "));
        }
        return data;
      } catch (err) {
        lastErr = err;
        const wait = 500 * Math.pow(2, i);
        console.warn(`[Yenime] AniList request failed attempt ${i + 1}/${maxAttempts}: ${err.message}, retry in ${wait}ms`);
        yield new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  });
}
function getAnimeInfoByMal(malId) {
  return __async(this, null, function* () {
    var _a;
    const data = yield anilistWithRetry(ANILIST_ID_FROM_MAL_QUERY, { malId });
    return ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.Media) || null;
  });
}
function getAnimeDetail(anilistId, maxAttempts = 3) {
  return __async(this, null, function* () {
    var _a;
    const data = yield anilistWithRetry(ANILIST_MEDIA_DETAIL_QUERY, { animeId: anilistId }, maxAttempts);
    return ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.Media) || null;
  });
}
function _resolveInput(input, mediaType) {
  return __async(this, null, function* () {
    if (typeof input !== "number" && !/^\d+$/.test(String(input))) {
      return null;
    }
    const id = parseInt(input, 10);
    const viaTmdb = yield _resolveViaTmdb(id, mediaType);
    if (viaTmdb === NOT_ANIME) {
      return NOT_ANIME;
    }
    if (viaTmdb) {
      return viaTmdb;
    }
    let infoByMal = null;
    try {
      infoByMal = yield getAnimeInfoByMal(id);
    } catch (err) {
      console.warn(`[Yenime] L-MAL lookup failed for ${id}: ${err.message}`);
    }
    if (infoByMal) {
      return { malId: id, anilistId: infoByMal.id, media: infoByMal, source: "mal" };
    }
    let infoById = null;
    try {
      infoById = yield getAnimeDetail(id);
    } catch (err) {
      console.warn(`[Yenime] L-AL lookup failed for ${id}: ${err.message}`);
    }
    if (infoById) {
      return { malId: infoById.idMal || id, anilistId: id, media: infoById, source: "anilist" };
    }
    return null;
  });
}
function _resolveViaTmdb(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const kind = String(mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
    let meta = null;
    let pageLoaded = false;
    try {
      meta = yield _tmdbPageMeta(tmdbId, kind);
      pageLoaded = true;
    } catch (err) {
      console.warn(`[Yenime] TMDB page lookup failed for ${tmdbId}: ${err.message}`);
    }
    if (!meta && TMDB_API_KEY) {
      try {
        const url = `${TMDB_API_BASE}/${kind}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
        const info = yield fetchJson(url, {
          headers: { Accept: "application/json", "User-Agent": ANILIST_UA }
        });
        const apiTitle = info && (info.title || info.name);
        const apiYear = String(info && (info.release_date || info.first_air_date) || "").slice(0, 4);
        if (apiTitle) {
          meta = { title: apiTitle, year: parseInt(apiYear, 10) || 0 };
          pageLoaded = true;
        }
      } catch (err) {
        console.warn(`[Yenime] TMDB API lookup failed for ${tmdbId}: ${err.message}`);
      }
    }
    if (!meta && !pageLoaded) {
      try {
        const otherKind = kind === "movie" ? "tv" : "movie";
        const otherMeta = yield _tmdbPageMeta(tmdbId, otherKind);
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
        console.warn(`[Yenime] No TMDB page for ${tmdbId}; trying MAL/AniList ids`);
        return null;
      }
      return NOT_ANIME;
    }
    const viaVidbolt = yield _vidboltSearchByTitle(meta.title, meta.year, mediaType);
    if (viaVidbolt) {
      console.log(`[Yenime] TMDB ${tmdbId} -> MAL ${viaVidbolt.malId} "${meta.title}" (Vidbolt search)`);
      return { malId: viaVidbolt.malId, anilistId: viaVidbolt.anilistId, media: null, source: "tmdb" };
    }
    let media = null;
    try {
      media = yield _searchAnilistByTitle(meta.title, meta.year);
    } catch (err) {
      console.warn(`[Yenime] AniList title search failed: ${err.message}`);
    }
    if (!media) {
      console.warn(`[Yenime] TMDB ${tmdbId} ("${meta.title}", ${meta.year}) exists but has no anime match`);
      return NOT_ANIME;
    }
    console.log(`[Yenime] TMDB ${tmdbId} -> MAL ${media.idMal} (${media.title.english || media.title.romaji})`);
    return { malId: media.idMal, anilistId: media.id, media, source: "tmdb" };
  });
}
function _tmdbPageMeta(tmdbId, kind) {
  return __async(this, null, function* () {
    const url = `https://www.themoviedb.org/${kind === "movie" ? "movie" : "tv"}/${encodeURIComponent(tmdbId)}`;
    const html = yield fetchText(url, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const match = html.match(/<title>(.*?)<\/title>/i);
    if (!match) {
      return null;
    }
    const raw = match[1].replace(/&#8212;.*$/i, "");
    const title = raw.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#821[67];|&#x201[89];/g, "'").trim();
    const tvMatch = title.match(/^(.*?)\s*\(TV Series(?:\s+(\d{4})(?:[\u2013\u2014-]\d{4})?)?\)\s*$/i);
    if (tvMatch) {
      return { title: tvMatch[1].trim(), year: tvMatch[2] ? parseInt(tvMatch[2], 10) : 0 };
    }
    const movieMatch = title.match(/^(.*?)\s*\((\d{4})\)\s*$/i);
    if (movieMatch) {
      return { title: movieMatch[1].trim(), year: parseInt(movieMatch[2], 10) };
    }
    return { title, year: 0 };
  });
}
function _vidboltSearchByTitle(title, year, mediaType) {
  return __async(this, null, function* () {
    let token = null;
    try {
      token = yield _getVidboltToken();
    } catch (err) {
      return null;
    }
    let data = null;
    try {
      const url = `${VIDBOLT_API}/search?q=${encodeURIComponent(title)}`;
      data = yield fetchJson(url, {
        headers: {
          Accept: "application/json",
          Referer: VIDBOLT_HOME,
          Origin: VIDBOLT_API,
          "x-api-key": token
        }
      });
    } catch (err) {
      console.warn(`[Yenime] Vidbolt search failed: ${err.message}`);
      return null;
    }
    const results = data && data.results || [];
    if (!results.length) {
      return null;
    }
    const wantYear = parseInt(year, 10);
    const wantMovie = String(mediaType || "").toLowerCase() === "movie";
    const norm = (v) => String(v || "").toLowerCase().replace(/[\u2018\u2019\u02BB\u02BC]/g, "'").trim();
    const normalized = norm(title);
    let best = null;
    let bestScore = -Infinity;
    for (const r of results) {
      if (!r.malId)
        continue;
      const t = norm(r.title);
      const ro = norm(r.titleRomaji);
      let score = 0;
      if (t === normalized || ro === normalized) {
        score += 100;
      } else if (t.includes(normalized) || normalized.includes(t) || ro.includes(normalized) || normalized.includes(ro)) {
        score += 40;
      }
      const fmt = String(r.format || "").toUpperCase();
      if (wantMovie && fmt === "MOVIE")
        score += 20;
      if (!wantMovie && fmt === "TV")
        score += 20;
      if (fmt === "SPECIAL" || fmt === "ONA" || fmt === "OVA")
        score -= 10;
      if (wantYear) {
        const ry = parseInt(r.year, 10);
        if (ry === wantYear)
          score += 15;
        else if (ry && Math.abs(ry - wantYear) <= 1)
          score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best || bestScore < 40) {
      return null;
    }
    return { malId: parseInt(best.malId, 10), anilistId: best.id, title: best.title };
  });
}
var ANILIST_TITLE_SEARCH_QUERY = `
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
function _searchAnilistByTitle(title, year) {
  return __async(this, null, function* () {
    let data;
    try {
      data = yield anilistWithRetry(ANILIST_TITLE_SEARCH_QUERY, { search: title });
    } catch (err) {
      console.warn(`[Yenime] AniList title search failed: ${err.message}`);
      return null;
    }
    const list = data && data.data && data.data.Page && data.data.Page.media || [];
    if (!list.length) {
      return null;
    }
    const wantYear = parseInt(year, 10);
    if (wantYear) {
      const exact = list.find((m) => m.startDate && m.startDate.year === wantYear);
      if (exact) {
        return exact;
      }
      const near = list.find((m) => m.startDate && Math.abs(m.startDate.year - wantYear) <= 1);
      if (near) {
        return near;
      }
      return null;
    }
    return list[0];
  });
}
function buildSeasonChain(rootAnilistId) {
  return __async(this, null, function* () {
    var _a, _b, _c, _d;
    if (seasonChainCache.has(rootAnilistId)) {
      return seasonChainCache.get(rootAnilistId);
    }
    if (!rootAnilistId) {
      return [];
    }
    const chain = [];
    const seen = /* @__PURE__ */ new Set();
    let currentId = rootAnilistId;
    try {
      while (currentId && !seen.has(currentId) && chain.length < 20) {
        seen.add(currentId);
        const media = yield getAnimeDetail(currentId, 2);
        if (!media)
          break;
        chain.push({
          season_number: chain.length + 1,
          anilist_id: media.id,
          mal_id: media.idMal,
          title: ((_a = media.title) == null ? void 0 : _a.english) || ((_b = media.title) == null ? void 0 : _b.romaji) || "Unknown",
          format: media.format,
          episodes: media.episodes || 0
        });
        const sequel = (((_c = media.relations) == null ? void 0 : _c.edges) || []).find((e) => {
          var _a2;
          return e.relationType === "SEQUEL" && ((_a2 = e.node) == null ? void 0 : _a2.type) === "ANIME";
        });
        currentId = ((_d = sequel == null ? void 0 : sequel.node) == null ? void 0 : _d.id) || null;
      }
      seasonChainCache.set(rootAnilistId, chain);
    } catch (err) {
      console.warn(`[Yenime] Season chain build interrupted for ${rootAnilistId}: ${err.message}`);
      if (!chain.length) {
        console.warn("[Yenime] Using root MAL id for season resolution");
      }
    }
    return chain;
  });
}

// src/yenime/index.js
function getStreams(tmdbId, mediaType, season, episode, languages) {
  return __async(this, null, function* () {
    try {
      console.log(`[Yenime] Request: ${mediaType} ${tmdbId}`);
      const streams = yield extractStreams(tmdbId, mediaType, season, episode, languages);
      return streams;
    } catch (error) {
      console.error(`[Yenime] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

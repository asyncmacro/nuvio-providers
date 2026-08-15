/**
 * yenime - Built from src/yenime/
 * Generated: 2026-08-15T17:49:15.573Z
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
var VIDBOLT_MEGAPLAY_REFERER = "https://hianime.filmu.in/hianime/megaplay";
var DEFAULT_STREAM_REFERER = "https://megaplay.buzz/";
var ANILIST_API = "https://graphql.anilist.co";
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    console.log(`[Template] Fetching: ${url}`);
    const response = yield fetch(url, __spreadValues({
      headers: __spreadValues(__spreadValues({}, HEADERS), options.headers)
    }, options));
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
    const response = yield fetch(url, __spreadValues({
      method: "POST",
      headers: __spreadValues(__spreadValues({
        "Content-Type": "application/json"
      }, HEADERS), options.headers),
      body: JSON.stringify(data)
    }, options));
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
var cachedToken = null;
var tokenExpiry = 0;
function _getVidboltToken() {
  return __async(this, null, function* () {
    var _a;
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
      return cachedToken;
    }
    try {
      const data = yield postJson(`${VIDBOLT_API}/token`, {});
      const token = (data == null ? void 0 : data.token) || ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.token) || data;
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
function _fetchVidboltStreams(malId, episode, audioType) {
  return __async(this, null, function* () {
    const token = yield _getVidboltToken();
    const url = `${VIDBOLT_API}/hianime/megaplay?malId=${encodeURIComponent(malId)}&ep=${encodeURIComponent(episode)}&type=${encodeURIComponent(audioType)}`;
    const headers = __spreadProps(__spreadValues({}, HEADERS), {
      Referer: VIDBOLT_MEGAPLAY_REFERER,
      "X-Token": token,
      // Some endpoints also check Origin
      Origin: "https://hianime.filmu.in"
    });
    console.log(`[Yenime] Fetching megaplay: ${url}`);
    const data = yield fetchJson(url, { headers });
    return data;
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
          const resolution = resMatch ? resMatch[1] : null;
          const bandwidth = bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 1e3) : null;
          const quality = resolution || (bandwidth ? `${bandwidth}k` : "auto");
          variants.push({
            url: uri,
            quality,
            resolution,
            bandwidth
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
function _parseVidboltResponse(malId, episode, audioType, data) {
  return __async(this, null, function* () {
    var _a, _b;
    const streams = [];
    const sources = (data == null ? void 0 : data.sources) || ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.sources) || ((_b = data == null ? void 0 : data.result) == null ? void 0 : _b.sources) || (data == null ? void 0 : data.links) || [];
    if (!Array.isArray(sources) || sources.length === 0) {
      console.log(`[Yenime] No sources found in megaplay response`);
      if (Array.isArray(data)) {
        sources.push(...data);
      } else {
        return streams;
      }
    }
    const streamHeaders = {
      Referer: DEFAULT_STREAM_REFERER,
      "User-Agent": HEADERS["User-Agent"],
      Origin: "https://megaplay.buzz"
    };
    for (const src of sources) {
      const url = src.url || src.file || src.link || src.src || src;
      if (!url)
        continue;
      const label = src.label || src.quality || src.res || src.height || "auto";
      const type = (src.type || "").toLowerCase();
      const isHls = type.includes("hls") || url.includes(".m3u8");
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
    return streams;
  });
}
function extractStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const malId = parseInt(tmdbId, 10);
      if (isNaN(malId)) {
        console.log(`[Yenime] Invalid tmdbId/MAL id: ${tmdbId}`);
        return [];
      }
      const info = yield getAnimeInfoByMal(malId);
      if (!info) {
        console.log(`[Yenime] No AniList info for MAL ${malId}`);
        return [];
      }
      console.log(`[Yenime] Found: ${info.title.english || info.title.romaji} | MAL:${info.idMal} | AniList:${info.id} | Episodes:${info.episodes}`);
      const chain = yield buildSeasonChain(info.id);
      console.log(`[Yenime] Season chain length: ${chain.length}`);
      chain.forEach((s) => console.log(`  S${s.season_number}: ${s.title} - MAL:${s.mal_id} - AniList:${s.anilist_id} - Ep:${s.episodes}`));
      const seasonNum = season || 1;
      const seasonInfo = chain.find((s) => s.season_number === seasonNum);
      const resolvedMalId = (seasonInfo == null ? void 0 : seasonInfo.mal_id) || malId;
      if (seasonInfo) {
        console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}, MAL ${seasonInfo.mal_id}`);
      } else {
        console.log(`[Yenime] Season ${seasonNum} not found in chain, using root MAL ${malId}`);
      }
      const episodeNum = episode || 1;
      console.log(`[Yenime] Requested episode ${episodeNum} of season ${seasonNum} (MAL ${resolvedMalId})`);
      const audioType = "sub";
      const vidboltData = yield _fetchVidboltStreams(resolvedMalId, episodeNum, audioType);
      const streams = yield _parseVidboltResponse(resolvedMalId, episodeNum, audioType, vidboltData);
      console.log(`[Yenime] Parsed ${streams.length} streams`);
      return streams;
    } catch (err) {
      console.error(`[Yenime] Error: ${err.message}`);
      return [];
    }
  });
}
function getAnimeInfoByMal(malId) {
  return __async(this, null, function* () {
    var _a;
    const data = yield postJson(ANILIST_API, { query: ANILIST_ID_FROM_MAL_QUERY, variables: { malId } });
    return ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.Media) || null;
  });
}
function getAnimeDetail(anilistId) {
  return __async(this, null, function* () {
    var _a;
    const data = yield postJson(ANILIST_API, { query: ANILIST_MEDIA_DETAIL_QUERY, variables: { animeId: anilistId } });
    return ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.Media) || null;
  });
}
function buildSeasonChain(rootAnilistId) {
  return __async(this, null, function* () {
    var _a, _b, _c, _d;
    const chain = [];
    const seen = /* @__PURE__ */ new Set();
    let currentId = rootAnilistId;
    while (currentId && !seen.has(currentId) && chain.length < 20) {
      seen.add(currentId);
      const media = yield getAnimeDetail(currentId);
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
    return chain;
  });
}

// src/yenime/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      console.log(`[Yenime] Request: ${mediaType} ${tmdbId}`);
      const streams = yield extractStreams(tmdbId, mediaType, season, episode);
      return streams;
    } catch (error) {
      console.error(`[Yenime] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

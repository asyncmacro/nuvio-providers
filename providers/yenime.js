/**
 * yenime - Built from src/yenime/
 * Generated: 2026-08-15T15:24:55.844Z
 */
var __defProp = Object.defineProperty;
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
var ANILIST_API = "https://graphql.anilist.co";
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
      if (seasonInfo) {
        console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}`);
      }
      if (episode) {
        console.log(`[Yenime] Requested episode ${episode} of season ${seasonNum}`);
      }
      return [];
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

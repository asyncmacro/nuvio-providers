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

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

async function _getVidboltToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
        return cachedToken;
    }
    try {
        const data = await postJson(`${VIDBOLT_API}/token`, {});
        // Token response may be { token: '...' } or plain string
        const token = data?.token || data?.data?.token || data;
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

async function _fetchVidboltStreams(malId, episode, audioType) {
    const token = await _getVidboltToken();
    const url = `${VIDBOLT_API}/hianime/megaplay?malId=${encodeURIComponent(malId)}&ep=${encodeURIComponent(episode)}&type=${encodeURIComponent(audioType)}`;
    const headers = {
        ...HEADERS,
        Referer: VIDBOLT_MEGAPLAY_REFERER,
        'X-Token': token,
        // Some endpoints also check Origin
        Origin: 'https://hianime.filmu.in'
    };
    console.log(`[Yenime] Fetching megaplay: ${url}`);
    const data = await fetchJson(url, { headers });
    return data;
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
                const resolution = resMatch ? resMatch[1] : null;
                const bandwidth = bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 1000) : null;
                const quality = resolution || (bandwidth ? `${bandwidth}k` : 'auto');
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
        // Fallback: single playlist
        return [{ url: masterUrl, quality: 'auto' }];
    } catch (err) {
        console.error(`[Yenime] HLS expand failed: ${err.message}`);
        return [{ url: masterUrl, quality: 'auto' }];
    }
}

async function _parseVidboltResponse(malId, episode, audioType, data) {
    const streams = [];
    // Try common shapes
    const sources = data?.sources || data?.data?.sources || data?.result?.sources || data?.links || [];
    if (!Array.isArray(sources) || sources.length === 0) {
        console.log(`[Yenime] No sources found in megaplay response`);
        // Try alternative structure: maybe data is array directly
        if (Array.isArray(data)) {
            sources.push(...data);
        } else {
            return streams;
        }
    }

    const streamHeaders = {
        Referer: DEFAULT_STREAM_REFERER,
        'User-Agent': HEADERS['User-Agent'],
        Origin: 'https://megaplay.buzz'
    };

    for (const src of sources) {
        const url = src.url || src.file || src.link || src.src || src;
        if (!url) continue;
        const label = src.label || src.quality || src.res || src.height || 'auto';
        const type = (src.type || '').toLowerCase();
        const isHls = type.includes('hls') || url.includes('.m3u8');
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
    return streams;
}

export async function extractStreams(tmdbId, mediaType, season, episode) {
    try {
        // For Yenime, tmdbId is used as MAL id in kitsune convention
        const malId = parseInt(tmdbId, 10);
        if (isNaN(malId)) {
            console.log(`[Yenime] Invalid tmdbId/MAL id: ${tmdbId}`);
            return [];
        }

        // Resolve metadata
        const info = await getAnimeInfoByMal(malId);
        if (!info) {
            console.log(`[Yenime] No AniList info for MAL ${malId}`);
            return [];
        }

        console.log(`[Yenime] Found: ${info.title.english || info.title.romaji} | MAL:${info.idMal} | AniList:${info.id} | Episodes:${info.episodes}`);

        // Build season chain for show/episode info
        const chain = await buildSeasonChain(info.id);
        console.log(`[Yenime] Season chain length: ${chain.length}`);
        chain.forEach(s => console.log(`  S${s.season_number}: ${s.title} - MAL:${s.mal_id} - AniList:${s.anilist_id} - Ep:${s.episodes}`));

        // Resolve season specific MAL id
        const seasonNum = season || 1;
        const seasonInfo = chain.find(s => s.season_number === seasonNum);
        const resolvedMalId = seasonInfo?.mal_id || malId;
        if (seasonInfo) {
            console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}, MAL ${seasonInfo.mal_id}`);
        } else {
            console.log(`[Yenime] Season ${seasonNum} not found in chain, using root MAL ${malId}`);
        }

        const episodeNum = episode || 1;
        console.log(`[Yenime] Requested episode ${episodeNum} of season ${seasonNum} (MAL ${resolvedMalId})`);

        // Audio selection - default sub, can be extended via env
        const audioType = 'sub';

        // Fetch streams from Vidbolt
        const vidboltData = await _fetchVidboltStreams(resolvedMalId, episodeNum, audioType);
        const streams = await _parseVidboltResponse(resolvedMalId, episodeNum, audioType, vidboltData);

        console.log(`[Yenime] Parsed ${streams.length} streams`);
        return streams;
    } catch (err) {
        console.error(`[Yenime] Error: ${err.message}`);
        return [];
    }
}

async function anilistWithRetry(query, variables, maxAttempts = 3) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const data = await postJson(ANILIST_API, { query, variables });
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

async function getAnimeDetail(anilistId) {
    const data = await anilistWithRetry(ANILIST_MEDIA_DETAIL_QUERY, { animeId: anilistId });
    return data?.data?.Media || null;
}

async function buildSeasonChain(rootAnilistId) {
    const chain = [];
    const seen = new Set();
    let currentId = rootAnilistId;

    while (currentId && !seen.has(currentId) && chain.length < 20) {
        seen.add(currentId);
        const media = await getAnimeDetail(currentId);
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

    return chain;
}

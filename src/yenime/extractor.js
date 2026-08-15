/**
 * Extractor Logic
 * Yenime provider - metadata extraction phase
 * Uses AniList GraphQL for show/season/episode info.
 * Streaming extraction will be added later.
 */

import { postJson, HEADERS, ANILIST_API } from './http.js';

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

        // Resolve season specific info
        const seasonNum = season || 1;
        const seasonInfo = chain.find(s => s.season_number === seasonNum);
        if (seasonInfo) {
            console.log(`[Yenime] Season ${seasonNum} info: ${seasonInfo.title}, episodes ${seasonInfo.episodes}`);
        }

        // Episode info extraction
        if (episode) {
            console.log(`[Yenime] Requested episode ${episode} of season ${seasonNum}`);
        }

        // Streaming extraction not implemented yet - phase 1 only metadata
        return [];
    } catch (err) {
        console.error(`[Yenime] Error: ${err.message}`);
        return [];
    }
}

/** Search AniList by title */
export async function searchAnime(query) {
    const data = await postJson(ANILIST_API, { query: ANILIST_SEARCH_QUERY, variables: { search: query } });
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
    const data = await postJson(ANILIST_API, { query: ANILIST_ID_FROM_MAL_QUERY, variables: { malId } });
    return data?.data?.Media || null;
}

async function getAnimeDetail(anilistId) {
    const data = await postJson(ANILIST_API, { query: ANILIST_MEDIA_DETAIL_QUERY, variables: { animeId: anilistId } });
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

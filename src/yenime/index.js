/**
 * Yenime Provider
 * Main entry point.
 */

import { extractStreams } from './extractor.js';

/**
 * Main function called by Nuvio
 * @param {string} tmdbId - TMDB ID of the media
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} season - Season number (for TV)
 * @param {number} episode - Episode number (for TV)
 * @param {Array<string>} [languages] - Optional audio/preferred languages (e.g. ['dub'])
 */
async function getStreams(tmdbId, mediaType, season, episode, languages) {
    try {
        console.log(`[Yenime] Request: ${mediaType} ${tmdbId}`);

        // Call your extraction logic
        const streams = await extractStreams(tmdbId, mediaType, season, episode, languages);

        return streams;
    } catch (error) {
        console.error(`[Yenime] Error: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };

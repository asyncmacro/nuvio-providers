/**
 * Yenime Provider
 * Main entry point.
 */

import { extractStreams } from './extractor.js';

// --- In-app diagnostics (temporary debug aid) --------------------------------
// Nuvio's Plugin Tester may not surface console output, so when getStreams
// yields nothing we return ONE diagnostic stream whose title carries the
// incoming args and the resolver's last log lines. This makes the failure
// visible in the app's results list without needing console access.
let _logBuf = [];
const _origLog = console.log && console.log.bind(console);
const _origErr = console.error && console.error.bind(console);
function _capture(fn, line) {
    try {
        _logBuf.push(line);
        if (_logBuf.length > 60) {
            _logBuf.shift();
        }
    } catch (e) {}
    if (fn) try { fn(line); } catch (e) {}
}
if (console.log) {
    console.log = (...a) => _capture(_origLog, a.map(String).join(' '));
}
if (console.error) {
    console.error = (...a) => _capture(_origErr, 'ERR ' + a.map(String).join(' '));
}
function _diagStream(diag) {
    const text = '[Yenime DEBUG] ' + diag;
    return [{
        name: 'Yenime',
        title: text.slice(0, 300),
        url: 'data:text/plain,debug',
        quality: 'DEBUG',
        headers: {},
    }];
}
// -----------------------------------------------------------------------------

/**
 * Main function called by Nuvio
 * @param {string} tmdbId - TMDB ID of the media
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} season - Season number (for TV)
 * @param {number} episode - Episode number (for TV)
 * @param {Array<string>} [languages] - Optional audio/preferred languages (e.g. ['dub'])
 */
async function getStreams(tmdbId, mediaType, season, episode, languages) {
    _logBuf = [];
    try {
        console.log(`[Yenime] Request: ${mediaType} ${tmdbId} season=${season} episode=${episode} languages=${JSON.stringify(languages)}`);

        const streams = await extractStreams(tmdbId, mediaType, season, episode, languages);

        if (streams && streams.length) {
            return streams;
        }

        // Empty result: surface the resolver's last logs in a diagnostic stream.
        const diag = _logBuf.slice(-12).join(' | ') || 'no logs captured';
        console.log(`[Yenime] No streams; diag: ${diag}`);
        return _diagStream(diag);
    } catch (error) {
        const diag = `CRASH: ${error && error.message} :: ${_logBuf.slice(-6).join(' | ')}`;
        console.error(`[Yenime] Error: ${error.message}`);
        return _diagStream(diag);
    }
}

module.exports = { getStreams };
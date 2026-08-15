/**
 * HTTP Utilities
 * Use this file for network requests and headers.
 */

export const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
};

export const VIDBOLT_API = "https://hianime.filmu.in";
export const VIDBOLT_MEGAPLAY_REFERER = "https://hianime.filmu.in/hianime/megaplay";
export const DEFAULT_STREAM_REFERER = "https://megaplay.buzz/";
export const ANILIST_API = "https://graphql.anilist.co";

/**
 * Fetch text content from a URL
 * @param {string} url 
 * @param {object} options 
 */
export async function fetchText(url, options = {}) {
    console.log(`[Template] Fetching: ${url}`);

    const response = await fetch(url, {
        headers: {
            ...HEADERS,
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} for ${url}`);
    }

    return await response.text();
}

/**
 * Fetch JSON content from a URL
 * @param {string} url 
 * @param {object} options 
 */
export async function fetchJson(url, options = {}) {
    const raw = await fetchText(url, options);
    return JSON.parse(raw);
}

export async function postJson(url, data, options = {}) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...HEADERS,
            ...options.headers
        },
        body: JSON.stringify(data),
        ...options
    });
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} for ${url}`);
    }
    return await response.json();
}

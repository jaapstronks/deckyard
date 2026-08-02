/**
 * Resolve the poster still for a video slide in static exports (PDF / PNG).
 *
 * A video can't play in a PDF or a PNG, so the placeholder shows the video's own
 * thumbnail behind a play badge. Getting those bytes has two provider-specific
 * snags that a plain `<img src>` in the export HTML does not survive:
 *
 *   1. **Bunny needs a pull zone.** The thumbnail lives at
 *      `https://<pullzone>.b-cdn.net/<videoId>/thumbnail.jpg`, and the pull zone
 *      is nowhere in the slide — it used to come only from `BUNNY_PULLZONE`,
 *      documented as an optional PPTX setting. A fork that never enabled PPTX
 *      video embedding silently got an empty grey box. We now discover the pull
 *      zone from the library's own play page (`og:image`) and cache it.
 *   2. **Bunny pull zones ship with hotlink protection on.** A request without a
 *      `Referer` gets a 403, so the generic export embed pass (which sends none)
 *      dropped the image even when the URL was right. We fetch the still here,
 *      with a referer, and inline it as a data URL so the later pass has nothing
 *      left to fetch.
 *
 * YouTube and Vimeo have neither problem; they go through the same path so all
 * providers end up as inlined bytes.
 */

import { assertPublicHttpUrl, safeFetchRemoteImage } from '../utils/ssrf-guard.js';
import { debugLog } from '../utils/debug-log.js';
import {
  parseVideoSource,
  getBunnyConfig,
  buildBunnyThumbnailUrl,
  buildYouTubeThumbnailUrl,
  buildVimeoThumbnailUrl,
} from './video-helpers.js';

/** Host that serves every Bunny Stream embed/play page. */
const BUNNY_EMBED_HOST = 'iframe.mediadelivery.net';

/** Cap on the play page we parse for `og:image` (the real page is ~30 KB). */
const MAX_PLAY_PAGE_BYTES = 512 * 1024;

const PLAY_PAGE_TIMEOUT_MS = 8000;

/**
 * Discovered Bunny pull zones, keyed by library id. `null` means "we looked and
 * came up empty" — cached too, so a fork without a reachable play page pays the
 * lookup once per process instead of once per exported video slide.
 * @type {Map<string, Promise<string|null>>}
 */
const bunnyPullZoneCache = new Map();

/**
 * Extract the `og:image` URL from a page's HTML.
 * Handles both attribute orders (`property` before or after `content`).
 * @param {string} html
 * @returns {string|null}
 */
export function parseOgImage(html) {
  const s = String(html || '');
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Pull the Bunny CDN host out of a play page, given the video we asked for.
 *
 * Deliberately strict: the page is third-party HTML, so we only accept an
 * `og:image` that is an https URL on a `*.b-cdn.net` host and whose path names
 * the video id we requested. Anything else is treated as "not found" rather than
 * followed.
 *
 * @param {string} html - The play page HTML.
 * @param {string} videoId - The video UUID we resolved the page for.
 * @returns {string|null} The pull zone hostname, or null.
 */
export function bunnyPullZoneFromPlayPage(html, videoId) {
  const og = parseOgImage(html);
  if (!og) return null;
  let url;
  try {
    url = new URL(og);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.b-cdn.net')) return null;
  if (!url.pathname.toLowerCase().includes(String(videoId || '').toLowerCase())) return null;
  return host;
}

/**
 * Fetch a Bunny play page through the SSRF guard and return its HTML.
 * Never throws; returns null on any refusal, error, or non-HTML response.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchPlayPageHtml(url) {
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return null;
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PLAY_PAGE_TIMEOUT_MS),
      redirect: 'error', // don't follow redirects into private space
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('text/html')) return null;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > MAX_PLAY_PAGE_BYTES) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > MAX_PLAY_PAGE_BYTES) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve the Bunny pull zone for a library: configured value wins, otherwise
 * discover it once from the library's play page and cache the result.
 * @param {string} libraryId
 * @param {string} videoId
 * @returns {Promise<string|null>}
 */
async function resolveBunnyPullZone(libraryId, videoId) {
  const { pullZone } = getBunnyConfig();
  if (pullZone) return pullZone;

  const lib = String(libraryId || '').trim();
  const id = String(videoId || '').trim();
  if (!lib || !id) return null;

  const cached = bunnyPullZoneCache.get(lib);
  if (cached) return cached;

  const promise = (async () => {
    const playUrl = `https://${BUNNY_EMBED_HOST}/play/${encodeURIComponent(lib)}/${encodeURIComponent(id)}`;
    const html = await fetchPlayPageHtml(playUrl);
    if (!html) {
      debugLog(`[video-thumbnail] no play page for Bunny library ${lib}`);
      return null;
    }
    const host = bunnyPullZoneFromPlayPage(html, id);
    if (!host) {
      debugLog(`[video-thumbnail] no usable og:image on the play page for library ${lib}`);
      return null;
    }
    debugLog(`[video-thumbnail] discovered Bunny pull zone ${host} for library ${lib}`);
    return host;
  })();

  bunnyPullZoneCache.set(lib, promise);
  return promise;
}

/**
 * Resolve the thumbnail URL for a video slide source, plus the referer needed to
 * fetch it (Bunny pull zones 403 a request that carries none).
 * @param {string} source - Slide `content.source` (URL or Bunny UUID).
 * @param {string} bunnyLibraryId - Slide `content.bunnyLibraryId`.
 * @returns {Promise<{url: string, referer: string|null, provider: string}|null>}
 */
export async function resolveVideoThumbnailRequest(source, bunnyLibraryId) {
  const parsed = parseVideoSource(source, bunnyLibraryId);
  if (!parsed.provider || !parsed.videoId) return null;

  switch (parsed.provider) {
    case 'youtube':
      return {
        url: buildYouTubeThumbnailUrl(parsed.videoId, 'hqdefault'),
        referer: null,
        provider: 'youtube',
      };
    case 'vimeo':
      return {
        url: buildVimeoThumbnailUrl(parsed.videoId),
        referer: null,
        provider: 'vimeo',
      };
    case 'bunny': {
      const lib = parsed.libraryId || bunnyLibraryId;
      const pullZone = await resolveBunnyPullZone(lib, parsed.videoId);
      if (!pullZone) return null;
      return {
        url: buildBunnyThumbnailUrl(pullZone, parsed.videoId),
        // Hotlink protection accepts any referer; the player's own host is the
        // one every Bunny library allows by construction.
        referer: `https://${BUNNY_EMBED_HOST}/`,
        provider: 'bunny',
      };
    }
    default:
      return null;
  }
}

/**
 * Resolve a video slide's poster still and return it as an inlined data URL.
 *
 * Inlining happens here rather than through the export's generic `<img src>`
 * pass because that pass can't send the referer Bunny requires. Returns null
 * when no thumbnail can be resolved or fetched; callers fall back to an empty
 * frame.
 *
 * @param {object} content - The video slide's content object.
 * @param {object} [options]
 * @param {(buf: Buffer, ext: string, mime: string) => Promise<{buf: Buffer, mime: string}>} [options.transform]
 *   Optional image-bytes transform (the PDF export's downsample/recompress).
 * @param {Map<string, Promise<string>>} [options.cache] - Per-run embed cache,
 *   shared with the other export embed passes so one still is fetched once.
 * @returns {Promise<string|null>} A `data:` URL, or null.
 */
export async function resolveVideoThumbnailDataUrl(content, { transform = null, cache = null } = {}) {
  const source = String(content?.source || '').trim();
  if (!source) return null;
  const bunnyLibraryId = String(content?.bunnyLibraryId || '366590').trim();

  const request = await resolveVideoThumbnailRequest(source, bunnyLibraryId);
  if (!request) return null;

  if (cache) {
    const existing = cache.get(request.url);
    if (existing) {
      const value = await existing;
      return value && value.startsWith('data:') ? value : null;
    }
  }

  const promise = (async () => {
    const fetched = await safeFetchRemoteImage(request.url, {
      headers: request.referer ? { Referer: request.referer } : undefined,
    });
    if (!fetched) {
      debugLog(`[video-thumbnail] could not fetch ${request.provider} still ${request.url}`);
      return '';
    }
    let buf = fetched.buffer;
    let mime = fetched.contentType || 'image/jpeg';
    const ext = mime.startsWith('image/') ? mime.slice(6) : '';
    if (typeof transform === 'function') {
      const r = await transform(buf, ext, mime);
      if (r && Buffer.isBuffer(r.buf)) {
        buf = r.buf;
        if (r.mime) mime = r.mime;
      }
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  })();

  if (cache) cache.set(request.url, promise);
  const dataUrl = await promise;
  return dataUrl || null;
}

/** Test seam: forget discovered pull zones. */
export function resetBunnyPullZoneCache() {
  bunnyPullZoneCache.clear();
}

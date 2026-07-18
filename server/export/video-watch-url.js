/**
 * Resolve the "watch online" URL for a video slide in static exports (PDF).
 *
 * A video can't play inside a PDF, so the PDF placeholder points the reader at
 * a live URL instead. The ladder (decided 2026-07-18):
 *
 *   1. Published deck — if the presentation is published and a public base URL
 *      is configured, deep-link into the published deck at the video slide
 *      (`/p/<id>-<slug>#slide=<index>`). The reader lands on the video and can
 *      click through the rest of the deck. This is the preferred target.
 *   2. Provider URL — otherwise fall back to the video's own public URL
 *      (YouTube / Vimeo watch page, Bunny player page). Always watchable,
 *      independent of whether the *deck* is published, and needs no new backend.
 *   3. None — no source we can resolve; the placeholder shows a "not available
 *      online" line instead of a link.
 *
 * The base URL is fork-configurable via APP_URL / DOMAIN (see getAppBaseUrl),
 * since only the slides.ciiic.nl fork is live.
 */

import { parseVideoSource } from './video-helpers.js';

/**
 * Build the public provider URL for a parsed video source.
 * @param {{provider: string|null, videoId: string|null, libraryId: string|null}} parsed
 * @param {boolean} autoplay - Whether to request autoplay on the landing page.
 * @returns {string|null}
 */
function buildProviderUrl(parsed, autoplay) {
  if (!parsed?.provider || !parsed?.videoId) return null;

  switch (parsed.provider) {
    case 'youtube': {
      const q = autoplay ? '&autoplay=1' : '';
      return `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.videoId)}${q}`;
    }
    case 'vimeo': {
      // Vimeo's autoplay only works through the player URL; without autoplay the
      // canonical vimeo.com page is the friendlier landing target.
      return autoplay
        ? `https://player.vimeo.com/video/${encodeURIComponent(parsed.videoId)}?autoplay=1`
        : `https://vimeo.com/${encodeURIComponent(parsed.videoId)}`;
    }
    case 'bunny': {
      const lib = encodeURIComponent(parsed.libraryId || '366590');
      const id = encodeURIComponent(parsed.videoId);
      const q = autoplay ? '?autoplay=true' : '';
      return `https://iframe.mediadelivery.net/play/${lib}/${id}${q}`;
    }
    default:
      return null;
  }
}

/**
 * Resolve the watch URL for a video slide.
 *
 * @param {object} slide - The video slide ({ id, content }).
 * @param {object} pres - The presentation (may carry `published: { id, slug }`).
 * @param {object} options
 * @param {string} [options.baseUrl] - Public base URL (no trailing slash), from
 *   getAppBaseUrl(). Empty means the deck deep-link can't be built (no origin).
 * @param {number} [options.slideIndex] - 0-based index of this slide in the
 *   export. Used for the published-deck `#slide=` deep-link. NOTE: this is the
 *   export-context index; it matches the published-deck index when the deck has
 *   no per-context hidden slides (the common case). If export/published
 *   visibility diverge, the link may land on a neighbouring slide.
 * @returns {{ url: string, kind: 'deck' | 'provider' } | { url: null, kind: null }}
 */
export function resolveVideoWatchUrl(slide, pres, { baseUrl = '', slideIndex = 0 } = {}) {
  const content = slide && typeof slide === 'object' ? slide.content : {};
  const source = String(content?.source || '').trim();
  const autoplay = content?.autoplay === 'on';

  // Rung 1: published deck deep-link.
  const published = pres && typeof pres.published === 'object' ? pres.published : null;
  const publishId = published ? String(published.id || '').trim() : '';
  const slug = published ? String(published.slug || '').trim() : '';
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (publishId && base) {
    const slugPart = slug ? `-${slug}` : '';
    const idx = Number.isInteger(slideIndex) && slideIndex >= 0 ? slideIndex : 0;
    // The published deck reads the initial slide from `#slide=<0-based index>`.
    return { url: `${base}/p/${publishId}${slugPart}#slide=${idx}`, kind: 'deck' };
  }

  // Rung 2: provider URL from the video source.
  if (source) {
    const bunnyLibraryId = String(content?.bunnyLibraryId || '366590').trim();
    const parsed = parseVideoSource(source, bunnyLibraryId);
    const url = buildProviderUrl(parsed, autoplay);
    if (url) return { url, kind: 'provider' };
  }

  // Rung 3: nothing resolvable.
  return { url: null, kind: null };
}

/**
 * Localised copy for the PDF video placeholder. Centralised here so the strings
 * live in one place (nl / en-GB; other langs fall back to nl).
 */
const VIDEO_PDF_COPY = {
  nl: {
    kicker: 'Videoslide',
    lead: 'Deze slide bevat een video die niet in een PDF kan worden afgespeeld. Bekijk de video online:',
    noUrl: 'Deze slide bevat een video. De video is niet online beschikbaar.',
    watchCta: 'Bekijk online',
  },
  'en-GB': {
    kicker: 'Video slide',
    lead: "This slide contains a video that can't play in a PDF. Watch it online:",
    noUrl: "This slide contains a video. It isn't available online.",
    watchCta: 'Watch online',
  },
};

/**
 * Get the localised copy block for the given document language.
 * @param {string} docLang - Normalised doc language ('nl' | 'en-GB' | ...).
 * @returns {{kicker: string, lead: string, noUrl: string, watchCta: string}}
 */
export function videoPdfCopy(docLang) {
  return VIDEO_PDF_COPY[docLang] || VIDEO_PDF_COPY.nl;
}

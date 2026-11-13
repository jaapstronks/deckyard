/**
 * The video slide's frame for an output where the video cannot play (the PDF
 * and PNG exports): the poster in the embed's own box with a play badge over
 * it, and, for a document the reader can click through, a caption under it
 * pointing at where the video can be watched.
 *
 * Pure markup, like every slide-type renderer: the server resolves the poster
 * (inlined as a data URL) and the watch URL before it renders, and hands them
 * in as `ctx.staticVideo`. See docs/reference/video-slide-pdf-export.md.
 */

import { escapeHtml } from '../../helpers.js';
import { getSlideCopy } from '../../slide-copy.js';

/** Only a real web address becomes a link; anything else is left unlinked. */
const WEB_URL_RE = /^https?:\/\/[^\s/]+/i;

/**
 * @typedef {object} StaticVideo
 * @property {string} [still] - The poster as a data URL; empty for the neutral ground.
 * @property {boolean} [caption] - Print the watch caption under the frame.
 * @property {string} [watchUrl] - Where the video can be watched; empty when nowhere.
 */

/**
 * @param {StaticVideo} staticVideo
 * @param {object} opts
 * @param {string} opts.alt - Alt text for the poster.
 * @param {string} [opts.lang] - Language of the caption copy.
 * @returns {string} The frame (and caption) markup.
 */
export function renderStaticVideoFrame(staticVideo, { alt, lang }) {
  const still = String(staticVideo?.still || '');
  const stillHtml = still
    ? `<img class="video-still" src="${escapeHtml(still)}" alt="${escapeHtml(alt)}" />`
    : `<div class="video-still video-still--empty"></div>`;
  const frame = `
            <div class="video-frame video-frame--still">
              ${stillHtml}
              <div class="video-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          `;
  if (!staticVideo?.caption) return frame;
  return `${frame}${renderWatchCaption(staticVideo.watchUrl, lang)}`;
}

/**
 * The line under the frame: lead and link, or the "not online" line. The
 * printed link drops the scheme (and a trailing slash), because the reader has
 * to read or retype it and `https://` is noise either way; the href keeps it.
 *
 * @param {string} [watchUrl]
 * @param {string} [lang]
 * @returns {string}
 */
function renderWatchCaption(watchUrl, lang) {
  const copy = getSlideCopy(lang);
  const url = String(watchUrl || '').trim();
  if (!WEB_URL_RE.test(url)) {
    return `<p class="video-caption">${escapeHtml(copy.videoPdfNoUrl)}</p>`;
  }
  const linkText = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return `<p class="video-caption">${escapeHtml(copy.videoPdfLead)} <a class="video-caption-link" href="${escapeHtml(
    url,
  )}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a></p>`;
}

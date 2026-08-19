/**
 * Shared utility for rendering video slide HTML placeholders
 * for PNG/image exports where videos cannot be embedded.
 */

import { escapeHtml } from './html-utils.js';
import { resolveVideoThumbnailDataUrl } from '../export/video-thumbnail.js';

/**
 * Render a video slide as a static HTML for PNG export.
 * Shows the video thumbnail when available, otherwise falls back to a placeholder.
 *
 * The still is fetched and inlined by {@link resolveVideoThumbnailDataUrl}
 * rather than emitted as a remote `<img src>`: Bunny's CDN 403s a request that
 * carries no referer, which the generic export embed pass cannot send.
 *
 * @param {object} slide - The video slide.
 * @param {object} [options]
 * @param {string} [options.missingSourceText] - Copy for a slide with no source.
 * @returns {Promise<string>} HTML for the placeholder slide.
 */
export async function renderVideoSlidePngHtml(
  slide,
  { missingSourceText = 'Video bron ontbreekt' } = {},
) {
  const content = slide && typeof slide === 'object' ? slide.content : {};
  const title = String(content?.title || '').trim();
  const bg = content?.background === 'lime' ? 'slide-bg-lime' : 'slide-bg-mist';
  const source = String(content?.source || '').trim();

  const titleHtml = title
    ? `<div class="heading">${escapeHtml(title)}</div>`
    : '';

  // Try to get a thumbnail for the video, already inlined as a data URL.
  const thumbnailDataUrl = await resolveVideoThumbnailDataUrl(content);

  let frameHtml;
  if (thumbnailDataUrl) {
    // Show the video thumbnail with a play button overlay
    frameHtml = `
      <div class="video-frame" style="position:relative;">
        <img
          src="${escapeHtml(thumbnailDataUrl)}"
          alt="${escapeHtml(title || 'Video thumbnail')}"
          style="width:100%; height:100%; object-fit:cover; display:block;"
        />
        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:80px; height:80px; background:rgba(0,0,0,0.6); border-radius:50%; display:flex; align-items:center; justify-content:center;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white" style="margin-left:4px;">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
    `;
  } else if (source) {
    // No thumbnail available, show placeholder with source info
    frameHtml = `
      <div class="video-frame">
        <div class="video-empty">
          <div style="font-weight:600; margin-bottom:6px;">Video</div>
          <div style="word-break:break-all;">${escapeHtml(source)}</div>
        </div>
      </div>
    `;
  } else {
    // No source provided
    frameHtml = `
      <div class="video-frame">
        <div class="video-empty">
          <div style="font-weight:600; margin-bottom:6px;">Video</div>
          <div>${escapeHtml(missingSourceText)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="slide slide-video ${bg}">
      <div class="slide-inner">
        ${titleHtml}
        ${frameHtml}
      </div>
    </div>
  `;
}

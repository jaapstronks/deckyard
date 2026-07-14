/**
 * Shared utility for rendering video slide HTML placeholders
 * for PNG/image exports where videos cannot be embedded.
 */

import { escapeHtml } from './html-utils.js';
import {
  parseVideoSource,
  getBunnyConfig,
  buildBunnyThumbnailUrl,
  buildYouTubeThumbnailUrl,
  buildVimeoThumbnailUrl,
} from '../export/video-helpers.js';

/**
 * Get the thumbnail URL for a video based on provider and ID.
 * @param {string} source - The video source (URL or ID)
 * @param {string} bunnyLibraryId - The Bunny library ID
 * @returns {{ thumbnailUrl: string | null, provider: string | null }}
 */
function getVideoThumbnailUrl(source, bunnyLibraryId) {
  const parsed = parseVideoSource(source, bunnyLibraryId);

  if (!parsed.provider || !parsed.videoId) {
    return { thumbnailUrl: null, provider: null };
  }

  switch (parsed.provider) {
    case 'bunny': {
      const { pullZone } = getBunnyConfig();
      if (pullZone) {
        return {
          thumbnailUrl: buildBunnyThumbnailUrl(pullZone, parsed.videoId),
          provider: 'bunny',
        };
      }
      return { thumbnailUrl: null, provider: 'bunny' };
    }
    case 'youtube':
      return {
        thumbnailUrl: buildYouTubeThumbnailUrl(parsed.videoId, 'hqdefault'),
        provider: 'youtube',
      };
    case 'vimeo':
      return {
        thumbnailUrl: buildVimeoThumbnailUrl(parsed.videoId),
        provider: 'vimeo',
      };
    default:
      return { thumbnailUrl: null, provider: null };
  }
}

/**
 * Render a video slide as a static HTML for PNG export.
 * Shows the video thumbnail when available, otherwise falls back to a placeholder.
 */
export function renderVideoSlidePngHtml(slide, { missingSourceText = 'Video bron ontbreekt' } = {}) {
  const content =
    slide && typeof slide === 'object' ? slide.content : {};
  const title = String(content?.title || '').trim();
  const bg =
    content?.background === 'lime'
      ? 'slide-bg-lime'
      : 'slide-bg-mist';
  const source = String(content?.source || '').trim();
  const bunnyLibraryId = String(content?.bunnyLibraryId || '366590').trim();

  const titleHtml = title
    ? `<div class="heading">${escapeHtml(title)}</div>`
    : '';

  // Try to get a thumbnail URL for the video
  const { thumbnailUrl } = getVideoThumbnailUrl(source, bunnyLibraryId);

  let frameHtml;
  if (thumbnailUrl) {
    // Show the video thumbnail with a play button overlay
    frameHtml = `
      <div class="video-frame" style="position:relative;">
        <img
          src="${escapeHtml(thumbnailUrl)}"
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

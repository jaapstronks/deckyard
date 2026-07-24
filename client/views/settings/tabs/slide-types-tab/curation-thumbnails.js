import { h } from '../../../../lib/dom.js';
import { renderSlideElement } from '../../../../lib/slide-runtime/slide-render.js';
import { getSampleContent } from '../../../editor/slide-type-sample-content.js';
import { SLIDE_TYPES as BUNDLED_SLIDE_TYPES } from '../../../../../shared/slide-types.js';

/**
 * A play-button mockup thumbnail. Video slides have no static preview worth
 * rendering, so the curation grid shows a frame + play glyph instead.
 * @param {string} className
 * @returns {HTMLElement}
 */
export function createVideoMockup(className) {
  const thumbWrap = h('div', { class: `${className} thumb is-video-mock` });
  const inner = h('div', { class: 'slide-type-curation-video-mock' });
  const frame = h('div', { class: 'slide-type-curation-video-frame' });
  const playBtn = h('div', { class: 'slide-type-curation-video-play' });
  playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  frame.append(playBtn);
  inner.append(frame);
  thumbWrap.append(inner);
  return thumbWrap;
}

/**
 * Render a sample-content thumbnail for a slide type. Falls back to a "?" error
 * tile when the type fails to render, and to a play-button mockup for video.
 * @param {string} type - slide type key
 * @param {string} className - base class for the thumb wrapper
 * @param {object|null} theme - resolved theme for sample rendering
 * @returns {HTMLElement}
 */
export function createCurationThumbnail(type, className, theme) {
  if (type === 'video-slide') {
    return createVideoMockup(className);
  }

  const sampleContent = getSampleContent(type, BUNDLED_SLIDE_TYPES, theme);
  const slide = {
    id: `curation-${type}`,
    type,
    content: sampleContent,
    notes: '',
  };

  const thumbWrap = h('div', { class: `${className} thumb` });
  try {
    const el = renderSlideElement(slide, { mode: 'thumb', theme });
    thumbWrap.append(el);
  } catch {
    thumbWrap.classList.add('is-error');
    thumbWrap.append(h('div', { class: 'slide-type-curation-thumb-error', text: '?' }));
  }
  return thumbWrap;
}

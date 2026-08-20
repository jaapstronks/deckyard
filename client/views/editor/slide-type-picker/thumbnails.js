/**
 * Thumbnail builders for the insert-slide type picker.
 *
 * The static mockups (video poster, embed browser chrome) and the abstract
 * schematic filler are pure DOM builders that take their dependencies as
 * arguments — no picker render state. The live-render path (hydrateThumb) stays
 * in the render seam because it closes over the mutable preview surface; it
 * calls these to fill the video/embed/schematic cases.
 */

import { icon } from '../../../lib/dom/icons.js';
import { renderSlideSchematic } from '../../../lib/slide-authoring/slide-schematic.js';
import { schematicFor } from '../slide-type-schematics.js';
import { SLIDE_CANVAS_WIDTH } from './data.js';

// Scale a rendered thumbnail's slide to exactly fill its (fluid) tile.
export const applyThumbScale = (wrap) => {
  const w = wrap.clientWidth;
  if (w > 0)
    wrap.style.setProperty('--thumb-scale', String(w / SLIDE_CANVAS_WIDTH));
};

// Static mockup for the video slide: a poster frame with a play button. The
// real video slide is never rendered in the picker (it would boot an embed
// SDK), so this stands in for it.
export const fillVideoThumb = (h, thumbWrap) => {
  thumbWrap.classList.add('ps-type-thumb-video');
  const inner = h('div', { class: 'ps-type-video-mock' });
  const frame = h('div', { class: 'ps-type-video-frame' });
  const poster = h('img', {
    class: 'ps-type-video-poster',
    src: 'https://picsum.photos/seed/deckyard-video/480/270',
    alt: '',
    loading: 'lazy',
  });
  const playBtn = h('div', { class: 'ps-type-video-play' }, [
    icon('play', { size: 22 }),
  ]);
  frame.append(poster, playBtn);
  inner.append(frame);
  thumbWrap.append(inner);
};

// Static mockup for the embed slide: a small browser window. Rendering the
// real slide with a sample URL would load a live external iframe in the
// picker (once per visible thumbnail), so we mock the chrome instead.
export const fillEmbedThumb = (h, thumbWrap) => {
  thumbWrap.classList.add('ps-type-thumb-embed');
  const win = h('div', { class: 'ps-type-embed-window' });
  const bar = h('div', { class: 'ps-type-embed-bar' });
  bar.append(
    h('span', { class: 'ps-type-embed-dot' }),
    h('span', { class: 'ps-type-embed-dot' }),
    h('span', { class: 'ps-type-embed-dot' }),
    h('span', { class: 'ps-type-embed-url' }),
  );
  const bodyEl = h('div', { class: 'ps-type-embed-body' }, [
    icon('globe', { size: 40 }),
  ]);
  win.append(bar, bodyEl);
  thumbWrap.append(win);
};

// Fill a thumbnail wrapper with an abstract schematic diagram (view mode
// 'schematic'). Cheap and synchronous — no live render, no observers needed.
// Reads the type + optional preset id stashed on the wrap.
export const fillSchematic = (thumbWrap, h, SLIDE_TYPES) => {
  const type = thumbWrap.dataset.thumbType;
  thumbWrap.classList.remove('is-pending');
  const spec = schematicFor(
    type,
    thumbWrap.__presetId || null,
    SLIDE_TYPES?.[type],
  );
  thumbWrap.append(renderSlideSchematic(h, spec || {}));
};

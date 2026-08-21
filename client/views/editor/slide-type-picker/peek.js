/**
 * Click-to-peek lightbox for the insert-slide type picker.
 *
 * A larger preview of a slide type (on the current preview surface) before
 * committing, opened over the picker modal. Esc / scrim / Close dismiss it, and
 * "Insert slide" inserts + closes everything.
 *
 * The single-open invariant is shared with the render seam via `peekRef`
 * ({ close }): the render seam's teardown calls `peekRef.close?.()` so a
 * re-render tears an open peek down, and opening a new peek closes the previous
 * one — the same behaviour the old mutable `closePeek` closure gave.
 */

import {
  renderSlideElement,
  cleanupSlideRuntimes,
} from '../../../lib/slide-runtime/slide-render.js';
import { createOverlay } from '../../../lib/dom/modal.js';
import { h } from '../../../lib/dom.js';

/**
 * Open the peek lightbox for a slide type (or curated preset variant).
 * @param {string} type - slide type key
 * @param {HTMLElement} _anchorBtn - unused; the overlay restores focus itself
 * @param {object|null} preset - curated preset variant, or null for the base type
 * @param {object} ctx
 * @param {Function} ctx.tr - translator (key, fallback)
 * @param {object|null} ctx.theme - resolved theme for the preview render
 * @param {Function} ctx.labelFor - (type) => resolved label
 * @param {Function} ctx.presetLabelFor - (preset) => resolved variant label
 * @param {Function} ctx.descFor - (type) => description ('' when none)
 * @param {Function} ctx.sampleContentFor - (type, overrides) => sample content
 * @param {Function} ctx.previewOverridesFor - (preset) => preview content overrides
 * @param {Function} ctx.onPick - (type, preset) => insert the slide
 * @param {{close: (Function|null)}} ctx.peekRef - shared single-open handle
 */
export function openTypePeek(type, _anchorBtn, preset, ctx) {
  const {
    tr,
    theme,
    labelFor,
    presetLabelFor,
    descFor,
    sampleContentFor,
    previewOverridesFor,
    onPick,
    peekRef,
  } = ctx;

  peekRef.close?.();
  // For a preset tile, title on the variant; otherwise the base type.
  const peekTitle = preset ? presetLabelFor(preset) : labelFor(type);

  const card = h('div', {
    class: 'modal ps-modal ps-type-peek',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': peekTitle,
  });
  // The overlay owns everything here, Escape included: it only reacts on the
  // topmost open overlay (#884), so one Escape peels the peek and leaves the
  // picker modal underneath open.
  const overlay = createOverlay({
    backdropClass: 'modal-backdrop ps-type-peek-overlay',
    surface: card,
    onClose: () => {
      window.removeEventListener('resize', updateScale);
      try {
        cleanupSlideRuntimes(bigThumb);
      } catch {
        // ignore
      }
      if (peekRef.close === close) peekRef.close = null;
    },
  });

  const stage = h('div', { class: 'ps-type-peek-stage' });
  const bigThumb = h('div', { class: 'thumb ps-type-peek-thumb' });
  try {
    const el = renderSlideElement(
      {
        id: `peek-${type}`,
        type,
        content: sampleContentFor(type, previewOverridesFor(preset)),
        notes: '',
      },
      { mode: 'thumb', theme },
    );
    bigThumb.append(el);
  } catch {
    bigThumb.append(h('div', { class: 'ps-type-thumb-error', text: '?' }));
  }
  stage.append(bigThumb);

  const desc = descFor(type);
  const info = h('div', { class: 'ps-type-peek-info' }, [
    h('h3', { class: 'ps-type-peek-title', text: peekTitle }),
    ...(desc ? [h('p', { class: 'ps-type-peek-desc', text: desc })] : []),
  ]);
  const insertBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: tr('editor.slideTypePicker.insertThis', 'Insert slide'),
    onclick: () => {
      close();
      onPick(type, preset);
    },
  });
  const closeBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: tr('common.close', 'Close'),
    onclick: () => close(),
  });
  const actions = h('div', { class: 'ps-type-peek-actions' }, [
    closeBtn,
    insertBtn,
  ]);

  card.append(
    h('div', { class: 'ps-type-peek-body' }, [
      stage,
      h('div', { class: 'ps-type-peek-foot' }, [info, actions]),
    ]),
  );
  overlay.show(document.body);

  // Scale the 1600x900 slide to fit the stage.
  const updateScale = () => {
    const r = stage.getBoundingClientRect();
    const scale = Math.min(r.width / 1600, r.height / 900, 1);
    if (!(scale > 0)) return;
    bigThumb.style.setProperty('--thumb-scale', String(scale));
    bigThumb.style.width = `${1600 * scale}px`;
    bigThumb.style.height = `${900 * scale}px`;
  };
  requestAnimationFrame(() => requestAnimationFrame(updateScale));
  window.addEventListener('resize', updateScale);

  const close = () => overlay.close();
  peekRef.close = close;
  requestAnimationFrame(() => {
    try {
      insertBtn.focus();
    } catch {
      // ignore
    }
  });
}

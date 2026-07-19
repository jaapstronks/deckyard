/**
 * Deck grid ("light table"): a reusable overview grid of a deck's slides with
 * truthful thumbnails. Used by the plain deck-overview modal and as the
 * substrate for the AI review modals — AI-specific captions are injected via
 * `annotationFor`, so this module itself stays AI-free.
 *
 * Thumbnails follow the insert-slide picker's pattern: each tile starts
 * pending and hydrates lazily via an IntersectionObserver; a per-tile
 * `--thumb-scale` (tile width / 1600) is kept in sync by a ResizeObserver.
 */
import { t } from '../../lib/ui-i18n.js';
import {
  renderSlideElement,
  cleanupSlideRuntimes,
} from '../../lib/slide-render.js';

const SLIDE_CANVAS_WIDTH = 1600;
const SLIDE_CANVAS_HEIGHT = 900;

/** Best-effort human label for a slide tile: its own title, else the type label. */
function slideTileLabel(slide, SLIDE_TYPES) {
  const c = slide?.content || {};
  const own = String(c.title || c.question || c.statement || c.quote || '').trim();
  if (own) return own;
  const def = SLIDE_TYPES?.[slide?.type];
  return t(`slideType.${slide?.type}.label`, def?.label || slide?.type || '');
}

/**
 * Create a deck grid view.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {Object} options.theme - Resolved theme (for truthful slide renders)
 * @param {Object} [options.SLIDE_TYPES] - Type registry (for tile labels)
 * @param {string} [options.presentationId] - Passed to renderSlideElement
 * @param {Function} options.getSlides - () => slide[] (re-read on every render)
 * @param {Function} [options.annotationFor] - (slide, index) => Node|string|null,
 *   rendered under the tile label (the AI layer hook)
 * @param {boolean} [options.selectable] - Multi-select mode: selection via a
 *   corner checkbox (hover-revealed, stays while checked)
 * @param {boolean} [options.previewOnClick] - Clicking a tile opens the large
 *   peek preview instead of picking/toggling it (the AI-review interaction:
 *   preview is the common action, selection the batch action). Keyboard on a
 *   focused tile: Enter → preview, Space → toggle selection.
 * @param {Function} [options.peekNoteFor] - (slide, index) => Node|string|null,
 *   extra info rendered inside the peek preview (e.g. the AI rationale)
 * @param {Function} [options.onSelectionChange] - (ids: string[]) => void
 * @param {Function} [options.onTilePick] - (slide, index) => void, offered as a
 *   button in the peek preview (and the primary click when previewOnClick is off)
 * @param {string} [options.tilePickLabel] - Label for the onTilePick action
 * @returns {Object} { el, render, teardown, getSelectedIds, clearSelection, refreshTile }
 */
export function createDeckGridView({
  h,
  theme,
  SLIDE_TYPES = null,
  presentationId = null,
  getSlides,
  annotationFor = null,
  selectable = false,
  previewOnClick = false,
  peekNoteFor = null,
  onSelectionChange = null,
  onTilePick = null,
  tilePickLabel = '',
} = {}) {
  const el = h('div', { class: 'deck-grid' });

  let observers = [];
  let closePeek = null;
  const selectedIds = new Set();

  const teardown = () => {
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {
        // ignore
      }
    }
    observers = [];
    try {
      closePeek?.();
    } catch {
      // ignore
    }
    try {
      cleanupSlideRuntimes(el);
    } catch {
      // ignore
    }
  };

  const applyThumbScale = (wrap) => {
    const w = wrap.clientWidth;
    if (w > 0)
      wrap.style.setProperty('--thumb-scale', String(w / SLIDE_CANVAS_WIDTH));
  };

  const hydrateThumb = (thumbWrap, resizeObserver) => {
    thumbWrap.classList.remove('is-pending');
    const slide = thumbWrap.__slide;
    if (!slide) return;
    try {
      const rendered = renderSlideElement(slide, {
        mode: 'thumb',
        theme,
        presentationId,
      });
      thumbWrap.append(rendered);
      applyThumbScale(thumbWrap);
      resizeObserver?.observe(thumbWrap);
    } catch {
      thumbWrap.classList.add('is-error');
      thumbWrap.append(h('div', { class: 'deck-grid-thumb-error', text: '?' }));
    }
  };

  // Larger preview of one slide in a lightbox over the grid (same pattern as
  // the picker's click-to-peek: capture-phase Escape so the host modal stays).
  // Navigates through the whole deck without closing (‹ › buttons + arrow keys)
  // and shows the optional peek note (the AI rationale) beside the preview.
  const openPeek = (index, anchorBtn) => {
    closePeek?.();
    const slides = (typeof getSlides === 'function' ? getSlides() : []) || [];
    if (!slides.length) return;
    let peekIndex = Math.max(0, Math.min(index, slides.length - 1));
    const canNav = slides.length > 1;
    const prevFocus = anchorBtn || document.activeElement;

    const backdrop = h('div', {
      class: 'modal-backdrop ps-modal-overlay deck-grid-peek-overlay',
    });
    const card = h('div', {
      class: 'modal ps-modal deck-grid-peek',
      role: 'dialog',
      'aria-modal': 'true',
    });

    const stage = h('div', { class: 'deck-grid-peek-stage' });
    const bigThumb = h('div', { class: 'thumb deck-grid-peek-thumb' });
    stage.append(bigThumb);

    const prevBtn = canNav
      ? h('button', {
          class: 'btn deck-grid-peek-nav is-prev',
          type: 'button',
          'aria-label': t('editor.deckGrid.prev', 'Previous slide'),
          title: t('editor.deckGrid.prev', 'Previous slide'),
          onclick: () => show(peekIndex - 1),
        })
      : null;
    const nextBtn = canNav
      ? h('button', {
          class: 'btn deck-grid-peek-nav is-next',
          type: 'button',
          'aria-label': t('editor.deckGrid.next', 'Next slide'),
          title: t('editor.deckGrid.next', 'Next slide'),
          onclick: () => show(peekIndex + 1),
        })
      : null;
    if (prevBtn) prevBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
    if (nextBtn) nextBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`;

    const titleEl = h('h3', { class: 'deck-grid-peek-title' });
    const counterEl = canNav ? h('span', { class: 'deck-grid-peek-count' }) : null;
    const noteEl = h('div', { class: 'deck-grid-peek-why', hidden: true });
    const info = h('div', { class: 'deck-grid-peek-info' }, [
      titleEl,
      ...(counterEl ? [counterEl] : []),
      noteEl,
    ]);

    const closeBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    });
    const actions = h('div', { class: 'deck-grid-peek-actions' }, [closeBtn]);
    let jumpBtn = null;
    if (typeof onTilePick === 'function' && tilePickLabel) {
      jumpBtn = h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: tilePickLabel,
        onclick: () => {
          const slide = slides[peekIndex];
          close();
          if (slide) onTilePick(slide, peekIndex);
        },
      });
      actions.append(jumpBtn);
    }

    const stageWrap = h('div', { class: 'deck-grid-peek-stagewrap' }, [
      ...(prevBtn ? [prevBtn] : []),
      stage,
      ...(nextBtn ? [nextBtn] : []),
    ]);
    card.append(
      h('div', { class: 'deck-grid-peek-body' }, [
        stageWrap,
        h('div', { class: 'deck-grid-peek-foot' }, [info, actions]),
      ])
    );
    backdrop.append(card);
    document.body.append(backdrop);

    const updateScale = () => {
      const r = stage.getBoundingClientRect();
      const scale = Math.min(
        r.width / SLIDE_CANVAS_WIDTH,
        r.height / SLIDE_CANVAS_HEIGHT,
        1
      );
      if (!(scale > 0)) return;
      bigThumb.style.setProperty('--thumb-scale', String(scale));
      bigThumb.style.width = `${SLIDE_CANVAS_WIDTH * scale}px`;
      bigThumb.style.height = `${SLIDE_CANVAS_HEIGHT * scale}px`;
    };

    // Fill (or re-fill, on navigation) the lightbox for slide `idx`.
    const show = (idx) => {
      if (idx < 0 || idx >= slides.length) return;
      peekIndex = idx;
      const slide = slides[idx];
      const label = slideTileLabel(slide, SLIDE_TYPES);
      card.setAttribute('aria-label', label);
      titleEl.textContent = `${idx + 1}. ${label}`;
      if (counterEl) counterEl.textContent = `${idx + 1} / ${slides.length}`;

      try {
        cleanupSlideRuntimes(bigThumb);
      } catch {
        // ignore
      }
      bigThumb.innerHTML = '';
      try {
        bigThumb.append(
          renderSlideElement(slide, { mode: 'thumb', theme, presentationId })
        );
      } catch {
        bigThumb.append(h('div', { class: 'deck-grid-thumb-error', text: '?' }));
      }

      noteEl.innerHTML = '';
      const note =
        typeof peekNoteFor === 'function' ? peekNoteFor(slide, idx) : null;
      if (note) {
        if (typeof note === 'string') noteEl.textContent = note;
        else noteEl.append(note);
        noteEl.hidden = false;
      } else {
        noteEl.hidden = true;
      }

      if (prevBtn) prevBtn.disabled = idx <= 0;
      if (nextBtn) nextBtn.disabled = idx >= slides.length - 1;
      requestAnimationFrame(() => requestAnimationFrame(updateScale));
    };

    window.addEventListener('resize', updateScale);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (canNav && e.key === 'ArrowLeft') {
        e.stopPropagation();
        show(peekIndex - 1);
      } else if (canNav && e.key === 'ArrowRight') {
        e.stopPropagation();
        show(peekIndex + 1);
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', updateScale);
      try {
        cleanupSlideRuntimes(bigThumb);
      } catch {
        // ignore
      }
      backdrop.remove();
      if (closePeek === close) closePeek = null;
      try {
        prevFocus?.focus?.();
      } catch {
        // ignore
      }
    };
    closePeek = close;

    show(peekIndex);
    requestAnimationFrame(() => {
      try {
        closeBtn.focus();
      } catch {
        // ignore
      }
    });
  };

  const emitSelection = () => {
    onSelectionChange?.(Array.from(selectedIds));
  };

  const setTileSelected = (tile, on) => {
    tile.classList.toggle('is-selected', on);
    const box = tile.querySelector('.deck-grid-select');
    if (box) {
      box.classList.toggle('is-checked', on);
      box.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    // Legacy toggle-on-click mode keeps aria-pressed on the tile button.
    if (!previewOnClick) {
      const btn = tile.querySelector('.deck-grid-tile-btn');
      btn?.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };

  const toggleSelection = (slide, tile) => {
    const id = slide?.id;
    if (!id) return;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    setTileSelected(tile, selectedIds.has(id));
    emitSelection();
  };

  const buildTile = (slide, index, intersectionObserver, resizeObserver) => {
    const thumbWrap = h('div', {
      class: 'deck-grid-thumb thumb is-pending',
      'data-slide-id': slide?.id || '',
    });
    thumbWrap.__slide = slide;
    if (intersectionObserver) intersectionObserver.observe(thumbWrap);
    else hydrateThumb(thumbWrap, resizeObserver);

    const label = slideTileLabel(slide, SLIDE_TYPES);
    const typeDef = SLIDE_TYPES?.[slide?.type];
    const typeLabel = t(
      `slideType.${slide?.type}.label`,
      typeDef?.label || slide?.type || ''
    );

    const labelWrap = h('div', { class: 'deck-grid-labelwrap' }, [
      h('span', { class: 'deck-grid-label', text: label }),
      h('span', { class: 'deck-grid-type', text: typeLabel }),
    ]);

    // Tile title reflects the primary click action for this mode.
    const previewLabel = t('editor.deckGrid.peek', 'Enlarge preview');
    const pickTitle = previewOnClick
      ? previewLabel
      : selectable
        ? t('editor.deckGrid.toggleSelect', 'Select slide')
        : tilePickLabel || label;

    const tileBtn = h(
      'button',
      {
        class: 'deck-grid-tile-btn',
        type: 'button',
        title: pickTitle,
        ...(selectable && !previewOnClick ? { 'aria-pressed': 'false' } : {}),
      },
      [thumbWrap, labelWrap]
    );

    const num = h('span', { class: 'deck-grid-num', text: String(index + 1) });

    const tileChildren = [tileBtn, num];

    // Selection control. In flipped (previewOnClick) mode this is a corner
    // checkbox, revealed on hover and kept visible while checked; the tile
    // click is reserved for the preview. In legacy mode the whole tile toggles.
    if (selectable && previewOnClick) {
      const selectLabel = t('editor.deckGrid.toggleSelect', 'Select slide');
      const checkbox = h('button', {
        class: 'deck-grid-select',
        type: 'button',
        role: 'checkbox',
        'aria-checked': 'false',
        'aria-label': selectLabel,
        title: selectLabel,
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleSelection(slide, tile);
        },
      });
      checkbox.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
      tileChildren.push(checkbox);
    }

    // Magnifier peek button — only when the tile click doesn't already preview.
    if (!previewOnClick) {
      const peekBtn = h('button', {
        class: 'deck-grid-peek-btn',
        type: 'button',
        title: previewLabel,
        'aria-label': previewLabel,
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openPeek(index, peekBtn);
        },
      });
      peekBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-4.35-4.35"/></svg>`;
      tileChildren.push(peekBtn);
    }

    const tile = h(
      'div',
      {
        class:
          'deck-grid-tile' +
          (selectable && previewOnClick ? ' has-checkbox' : ''),
        'data-slide-id': slide?.id || '',
      },
      tileChildren
    );

    tileBtn.addEventListener('click', () => {
      if (previewOnClick) openPeek(index, tileBtn);
      else if (selectable) toggleSelection(slide, tile);
      else onTilePick?.(slide, index);
    });

    // Flipped mode: Space toggles selection from a focused tile (Enter falls
    // through to the native button click → preview).
    if (previewOnClick && selectable) {
      tileBtn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          toggleSelection(slide, tile);
        }
      });
    }

    if (selectable && slide?.id && selectedIds.has(slide.id)) {
      setTileSelected(tile, true);
    }

    // AI layer hook: rationale/alternatives etc. rendered under the label.
    if (typeof annotationFor === 'function') {
      const note = annotationFor(slide, index);
      if (note) {
        const holder = h('div', { class: 'deck-grid-annotation' });
        if (typeof note === 'string') holder.textContent = note;
        else holder.append(note);
        tile.append(holder);
      }
    }

    return tile;
  };

  const render = () => {
    teardown();
    el.innerHTML = '';

    const slides = (typeof getSlides === 'function' ? getSlides() : []) || [];
    // Drop selections for slides that no longer exist (e.g. after a refresh).
    const liveIds = new Set(slides.map((s) => s?.id).filter(Boolean));
    let selectionChanged = false;
    for (const id of Array.from(selectedIds)) {
      if (!liveIds.has(id)) {
        selectedIds.delete(id);
        selectionChanged = true;
      }
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const e of entries) applyThumbScale(e.target);
          })
        : null;
    if (resizeObserver) observers.push(resizeObserver);

    const intersectionObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries, obs) => {
              for (const e of entries) {
                if (!e.isIntersecting) continue;
                obs.unobserve(e.target);
                hydrateThumb(e.target, resizeObserver);
              }
            },
            { rootMargin: '300px 0px' }
          )
        : null;
    if (intersectionObserver) observers.push(intersectionObserver);

    slides.forEach((slide, index) => {
      el.append(buildTile(slide, index, intersectionObserver, resizeObserver));
    });

    if (selectionChanged) emitSelection();
  };

  return {
    el,
    render,
    teardown,
    getSelectedIds: () => Array.from(selectedIds),
    clearSelection: () => {
      selectedIds.clear();
      for (const tile of el.querySelectorAll('.deck-grid-tile.is-selected')) {
        setTileSelected(tile, false);
      }
      emitSelection();
    },
  };
}

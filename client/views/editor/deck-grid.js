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
 * @param {boolean} [options.selectable] - Multi-select mode: clicking a tile
 *   toggles selection instead of picking it
 * @param {Function} [options.onSelectionChange] - (ids: string[]) => void
 * @param {Function} [options.onTilePick] - (slide, index) => void, primary click
 * @param {string} [options.tilePickLabel] - Tooltip for the primary click
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
  const openPeek = (slide, index, anchorBtn) => {
    closePeek?.();
    const prevFocus = anchorBtn || document.activeElement;
    const label = slideTileLabel(slide, SLIDE_TYPES);

    const backdrop = h('div', {
      class: 'modal-backdrop ps-modal-overlay deck-grid-peek-overlay',
    });
    const card = h('div', {
      class: 'modal ps-modal deck-grid-peek',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': label,
    });
    const stage = h('div', { class: 'deck-grid-peek-stage' });
    const bigThumb = h('div', { class: 'thumb deck-grid-peek-thumb' });
    try {
      bigThumb.append(
        renderSlideElement(slide, { mode: 'thumb', theme, presentationId })
      );
    } catch {
      bigThumb.append(h('div', { class: 'deck-grid-thumb-error', text: '?' }));
    }
    stage.append(bigThumb);

    const info = h('div', { class: 'deck-grid-peek-info' }, [
      h('h3', {
        class: 'deck-grid-peek-title',
        text: `${index + 1}. ${label}`,
      }),
    ]);
    const closeBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    });
    const actions = h('div', { class: 'deck-grid-peek-actions' }, [closeBtn]);
    if (typeof onTilePick === 'function' && tilePickLabel) {
      actions.append(
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: tilePickLabel,
          onclick: () => {
            close();
            onTilePick(slide, index);
          },
        })
      );
    }
    card.append(
      h('div', { class: 'deck-grid-peek-body' }, [
        stage,
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
    requestAnimationFrame(() => requestAnimationFrame(updateScale));
    window.addEventListener('resize', updateScale);

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
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
    const btn = tile.querySelector('.deck-grid-tile-btn');
    btn?.setAttribute('aria-pressed', on ? 'true' : 'false');
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

    const pickTitle = selectable
      ? t('editor.deckGrid.toggleSelect', 'Select slide')
      : tilePickLabel || label;

    const tileBtn = h(
      'button',
      {
        class: 'deck-grid-tile-btn',
        type: 'button',
        title: pickTitle,
        ...(selectable ? { 'aria-pressed': 'false' } : {}),
      },
      [thumbWrap, labelWrap]
    );

    const num = h('span', { class: 'deck-grid-num', text: String(index + 1) });

    const peekLabel = t('editor.deckGrid.peek', 'Enlarge preview');
    const peekBtn = h('button', {
      class: 'deck-grid-peek-btn',
      type: 'button',
      title: peekLabel,
      'aria-label': peekLabel,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPeek(slide, index, peekBtn);
      },
    });
    peekBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-4.35-4.35"/></svg>`;

    const tile = h(
      'div',
      { class: 'deck-grid-tile', 'data-slide-id': slide?.id || '' },
      [tileBtn, num, peekBtn]
    );

    tileBtn.addEventListener('click', () => {
      if (selectable) toggleSelection(slide, tile);
      else onTilePick?.(slide, index);
    });

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

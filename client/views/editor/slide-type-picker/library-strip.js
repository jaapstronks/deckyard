/**
 * Inline "From your library" strip for the insert-slide type picker (item 10).
 *
 * Loaded async so it never blocks the type grid, prepended above the categories
 * when non-empty, and gated by the caller on both a loader and an onSeeAllLibrary
 * handler (modal context with a library tab). Hidden entirely on empty/error.
 *
 * Split across the personal and organization shelves: the tile budget is
 * weighted by how many slides each shelf has but guarantees at least one tile
 * from every non-empty shelf, so a lone personal slide is never hidden behind a
 * large organization library (and vice versa).
 */

import { renderSlideElement } from '../../../lib/slide-runtime/slide-render.js';
import { applyThumbScale } from './thumbnails.js';

const LIBRARY_STRIP_TOTAL = 8;

const splitLibraryBudget = (pCount, oCount) => {
  let pShow = pCount ? 1 : 0;
  let oShow = oCount ? 1 : 0;
  const remaining = LIBRARY_STRIP_TOTAL - pShow - oShow;
  if (remaining > 0) {
    const pRem = pCount - pShow;
    const oRem = oCount - oShow;
    if (pRem + oRem > 0) {
      let addP = Math.min(pRem, Math.round((remaining * pRem) / (pRem + oRem)));
      let addO = Math.min(oRem, remaining - addP);
      addP = Math.min(pRem, remaining - addO);
      pShow += addP;
      oShow += addO;
    }
  }
  return { pShow, oShow };
};

/**
 * Load and mount the library strip above the type grid. Fire-and-forget: kicks
 * off the async load and returns immediately.
 * @param {object} ctx
 * @param {HTMLElement} ctx.typesWrap - grid container to prepend the strip into
 * @param {Function} ctx.h - DOM builder
 * @param {Function} ctx.tr - translator (key, fallback)
 * @param {object|null} ctx.theme - resolved theme for thumbnail rendering
 * @param {Function} ctx.labelFor - (type) => resolved label
 * @param {string} [ctx.afterSlideId] - insert anchor for a picked library item
 * @param {Function} [ctx.onPicked] - called after a library item is inserted
 * @param {Function} ctx.loadLibraryStripItems - async () => ({ personal, organization })
 * @param {Function} ctx.insertLibraryItem - (item, opts) => insert it
 * @param {Function} ctx.onSeeAllLibrary - (shelf) => open the full library
 * @param {ResizeObserver|null} ctx.resizeObserver - keeps hydrated tiles scaled
 * @param {Function} ctx.applyFilter - re-apply the current search query
 */
export function mountLibraryStrip(ctx) {
  const {
    typesWrap,
    h,
    tr,
    theme,
    labelFor,
    afterSlideId,
    onPicked,
    loadLibraryStripItems,
    insertLibraryItem,
    onSeeAllLibrary,
    resizeObserver,
    applyFilter,
  } = ctx;

  const buildLibraryTile = (item) => {
    const type = String(item?.slideType || '').trim();
    const name = String(item?.name || '').trim() || labelFor(type);
    const thumbWrap = h('div', {
      class: 'ps-type-thumb thumb',
      'data-thumb-type': type,
    });
    try {
      const el = renderSlideElement(
        {
          id: `lib-${item?.id || type}`,
          type,
          content:
            item?.content && typeof item.content === 'object'
              ? item.content
              : {},
          notes: '',
        },
        { mode: 'thumb', theme },
      );
      thumbWrap.append(el);
      applyThumbScale(thumbWrap);
      resizeObserver?.observe(thumbWrap);
    } catch {
      thumbWrap.classList.add('is-error');
      thumbWrap.append(h('div', { class: 'ps-type-thumb-error', text: '?' }));
    }
    const labelWrap = h('div', { class: 'ps-type-labelwrap' }, [
      h('span', { class: 'ps-type-label', text: name }),
    ]);
    const card = h(
      'button',
      {
        class: 'ps-type-card ps-type-card-thumb',
        type: 'button',
        title: name,
        onclick: () => {
          insertLibraryItem?.(item, { afterSlideId });
          onPicked?.();
        },
      },
      [thumbWrap, labelWrap],
    );
    return h(
      'div',
      {
        class: 'ps-type-card-wrap',
        'data-search': `${name} ${type}`.toLowerCase(),
      },
      [card],
    );
  };

  (async () => {
    let data = {};
    try {
      data = (await loadLibraryStripItems()) || {};
    } catch {
      data = {};
    }
    const personal = Array.isArray(data.personal) ? data.personal : [];
    const organization = Array.isArray(data.organization)
      ? data.organization
      : [];
    if (!personal.length && !organization.length) return;
    // A newer render replaced this pass while we were loading.
    if (!typesWrap.isConnected) return;

    const { pShow, oShow } = splitLibraryBudget(
      personal.length,
      organization.length,
    );
    const groups = [];
    if (pShow) {
      groups.push({
        shelf: 'personal',
        label: tr('editor.slideTypeGroup.libraryPersonal', 'Personal library'),
        items: personal.slice(0, pShow),
      });
    }
    if (oShow) {
      groups.push({
        shelf: 'organization',
        label: tr('editor.slideTypeGroup.libraryTeam', 'Team library'),
        items: organization.slice(0, oShow),
      });
    }

    const buildGroup = (g) => {
      const group = h('div', {
        class: 'ps-type-group ps-type-group-library',
        'data-group-key': `library-${g.shelf}`,
      });
      const seeAll = h('button', {
        class: 'ps-lib-strip-seeall',
        type: 'button',
        text: tr('editor.slideTypePicker.seeAll', 'See all'),
        onclick: () => {
          try {
            onSeeAllLibrary(g.shelf);
          } catch {
            // ignore
          }
        },
      });
      const head = h('div', { class: 'ps-lib-strip-head' }, [
        h('span', { class: 'ps-lib-strip-name', text: g.label }),
        seeAll,
      ]);
      const grid = h('div', { class: 'ps-type-grid ps-type-grid-thumbs' });
      for (const it of g.items) grid.append(buildLibraryTile(it));
      group.append(head, grid);
      return group;
    };

    // Prepend in reverse so the groups land above the category grid in
    // order (personal on top, then organization).
    for (const g of [...groups].reverse()) typesWrap.prepend(buildGroup(g));
    // Re-apply the current filter so a persisted query also filters the strip.
    applyFilter();
  })();
}

/**
 * Layout switcher: the first row of the inspector (B703 PR 3, D335). Up to four
 * mini-schematics inline, plus "All N →" that opens the full tile popover (every
 * declared variant and the mirror / text-columns toggles). One click switches
 * the variant; content stays put and the switch is a single undo step.
 *
 * Variants come from the slide-type definition (`layoutVariants`, see
 * shared/slide-types/types/image-text-slide.js) - nothing here is
 * type-specific, so forks that override a type by name control their own
 * variant set (or hide the chip by declaring none). Cross-type tiles
 * (`convertTo`, e.g. "Text only" on image-text) go through the shared
 * convert seam and only render when the seam supports the conversion.
 */
import { t } from '../../lib/ui-i18n.js';
import {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from '../../../shared/slide-types.js';
import {
  canConvertSlideTo,
  convertSlideWithConfirm,
  slideTypeLabel,
} from './convert-slide-action.js';
import { renderSlideSchematic } from '../../lib/slide-authoring/slide-schematic.js';
import { registerOverlayCloser } from '../../lib/dom/modal.js';
import { h } from '../../lib/dom/index.js';
import { takeEscape } from '../../lib/dom/escape.js';

/**
 * The definition's mirror declaration (`layoutMirror`): which enum field
 * flips the image side, and its two values in [left, right] order. Null when
 * the type declares none (no toggle, schematics never mirror).
 * @param {Object} def
 * @returns {{key: string, values: string[]}|null}
 */
function getLayoutMirror(def) {
  const m = def?.layoutMirror;
  const key = typeof m?.key === 'string' ? m.key : '';
  const values =
    Array.isArray(m?.values) && m.values.length === 2
      ? m.values.map(String)
      : null;
  return key && values ? { key, values } : null;
}

/**
 * Effective value of a content field, falling back to the definition's
 * defaults so an older slide without the field still reads correctly.
 * @param {Object} slide
 * @param {Object} def
 * @param {string} key
 * @returns {string}
 */
function effectiveContentValue(slide, def, key) {
  const raw = slide?.content?.[key];
  return raw != null && raw !== ''
    ? String(raw)
    : String(def?.defaults?.[key] ?? '');
}

/** Mirror state: schematics flip when the mirror field holds the right-hand value. */
function isMirrored(slide, def) {
  const mirror = getLayoutMirror(def);
  if (!mirror) return false;
  return effectiveContentValue(slide, def, mirror.key) === mirror.values[1];
}

/**
 * The definition's text-columns declaration (`layoutTextColumns`): which enum
 * field holds the column count, its two values in [one, two] order, and for
 * which values of another enum field (`when`, typically the layout) the
 * toggle applies. Null when the type declares none.
 * @param {Object} def
 * @returns {{key: string, values: string[], when: {key: string, values: string[]}|null}|null}
 */
function getLayoutTextColumns(def) {
  const d = def?.layoutTextColumns;
  const key = typeof d?.key === 'string' ? d.key : '';
  const values =
    Array.isArray(d?.values) && d.values.length === 2
      ? d.values.map(String)
      : null;
  if (!key || !values) return null;
  const whenKey = typeof d?.when?.key === 'string' ? d.when.key : '';
  const whenValues = Array.isArray(d?.when?.values)
    ? d.when.values.map(String)
    : null;
  const when =
    whenKey && whenValues?.length ? { key: whenKey, values: whenValues } : null;
  return { key, values, when };
}

/**
 * Draw the mini-schematic for one variant tile via the shared schematic
 * renderer, so the layout switcher and the slide-type picker speak one visual
 * language. Reads the variant's declared `schematic` spec (see
 * client/lib/slide-authoring/slide-schematic.js for the grammar).
 * @param {Object} variant
 * @param {boolean} mirrored
 * @returns {HTMLElement}
 */
function renderSchematic(variant, mirrored) {
  return renderSlideSchematic(variant?.schematic, { mirrored });
}

/** Inline tiles in the inspector row; the popover holds the rest. */
const ROW_TILE_COUNT = 4;

/**
 * Pick the variant set a surface may show: cross-type tiles (`convertTo`)
 * only where the type may change, and only when the convert seam supports
 * the conversion here (keeps custom types that override a core name working).
 */
function surfaceVariants({ variants, slide, typeConversion, SLIDE_TYPES }) {
  return variants.filter(
    (variant) =>
      !variant.convertTo ||
      (typeConversion &&
        canConvertSlideTo(slide, variant.convertTo, SLIDE_TYPES)),
  );
}

/** Display label of one variant tile. */
function variantLabel(variant, SLIDE_TYPES) {
  return variant.convertTo && !variant.labelKey && !variant.label
    ? slideTypeLabel(variant.convertTo, SLIDE_TYPES)
    : t(
        variant.labelKey || `editor.layoutVariant.${variant.id}`,
        variant.label || variant.id,
      );
}

/**
 * Apply one variant: a same-type `set`, or a cross-type tile through the
 * shared convert seam.
 */
async function pickVariant({ variant, slide, pres, SLIDE_TYPES, editorState }) {
  if (variant.convertTo) {
    // Cross-type tile: the shared convert seam moves the type underneath
    // (lossy confirm included); any `set` lands on the converted content.
    const ok = await convertSlideWithConfirm({
      slide,
      toType: variant.convertTo,
      pres,
      editorState,
      SLIDE_TYPES,
    });
    // Strip convertTo before applying: applyLayoutVariant rejects
    // cross-type variants (those must go through the seam above), but
    // after a successful conversion the remaining `set` is a plain
    // same-type update on the converted content.
    if (ok && applyLayoutVariant(slide, { set: variant.set })) {
      editorState.dirtyRefreshWithItem();
    }
    return;
  }
  if (applyLayoutVariant(slide, variant)) {
    editorState.dirtyRefreshWithItem();
  }
}

/**
 * One tile: schematic plus label, `is-active` on the current variant. The
 * compact (inspector row) tile carries its label as title and aria-label, and
 * shows it only when the variant asks (`rowLabel`: schematics too alike to
 * tell apart, such as a block's left and centred tiles).
 */
function buildTile({ variant, label, isActive, mirrored, compact, onPick }) {
  const showLabel = !compact || variant.rowLabel === true;
  return h(
    'button',
    {
      type: 'button',
      class: `layout-tile${isActive ? ' is-active' : ''}`,
      'aria-pressed': isActive ? 'true' : 'false',
      title: label,
      ...(compact ? { 'aria-label': label } : {}),
      onclick: onPick,
    },
    [
      renderSchematic(variant, mirrored),
      showLabel ? h('span', { class: 'layout-tile-label', text: label }) : null,
    ].filter(Boolean),
  );
}

/**
 * The inline tiles: the first four declared, with the active variant swapped
 * into the last slot when it would fall outside them.
 */
function rowVariants(variants, activeId) {
  const head = variants.slice(0, ROW_TILE_COUNT);
  const active = variants.find((v) => !v.convertTo && v.id === activeId);
  if (!active || head.includes(active)) return head;
  return [...head.slice(0, ROW_TILE_COUNT - 1), active];
}

/**
 * Build the inspector's Layout row for a slide, or null when its type
 * declares no layout variants.
 * @param {Object} opts
 * @param {Object} opts.slide - live slide object
 * @param {Object} opts.pres
 * @param {Object} opts.SLIDE_TYPES
 * @param {Object} opts.editorState - createEditorStateUpdater instance
 * @param {boolean} opts.typeConversion - whether cross-type tiles (`convertTo`)
 *   may render: the form surface's `typeConversion` capability. A surface
 *   whose slide keeps its type (the library editor) gets none.
 * @returns {HTMLElement|null}
 */
export function createLayoutRow({
  slide,
  pres,
  SLIDE_TYPES,
  editorState,
  typeConversion,
} = {}) {
  const def = SLIDE_TYPES?.[slide?.type];
  const variants = surfaceVariants({
    variants: getLayoutVariants(def),
    slide,
    typeConversion,
    SLIDE_TYPES,
  });
  if (!variants.length) return null;

  const activeId = activeLayoutVariantId(slide, def);
  const mirrored = isMirrored(slide, def);
  const tiles = h('div', { class: 'layout-row-tiles' });
  for (const variant of rowVariants(variants, activeId)) {
    tiles.append(
      buildTile({
        variant,
        label: variantLabel(variant, SLIDE_TYPES),
        isActive: !variant.convertTo && variant.id === activeId,
        mirrored,
        compact: true,
        onPick: () =>
          pickVariant({ variant, slide, pres, SLIDE_TYPES, editorState }),
      }),
    );
  }

  const head = h('div', { class: 'layout-row-head' }, [
    h('span', {
      class: 'field-label',
      text: t('editor.layoutSwitcher.chip', 'Layout'),
    }),
  ]);
  const row = h('div', { class: 'layout-row' }, [head, tiles]);

  // "All N →": the full chooser, when it holds more than the row shows - more
  // variants, or a mirror / text-columns toggle.
  const hasToggles = !!getLayoutMirror(def) || !!getLayoutTextColumns(def);
  if (variants.length > ROW_TILE_COUNT || hasToggles) {
    const allBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm layout-row-all',
      text: t('editor.layoutSwitcher.all', 'All {count} →', {
        count: variants.length,
      }),
      title: t('editor.layoutSwitcher.title', 'Slide layout'),
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    });
    attachLayoutPopover({
      chip: allBtn,
      slide,
      def,
      variants,
      pres,
      SLIDE_TYPES,
      editorState,
    });
    head.append(allBtn);
  }
  return row;
}

/**
 * The full tile popover (every variant the surface may show, plus the mirror
 * and text-columns toggles), opened from the row's "All N →".
 */
function attachLayoutPopover({
  chip,
  slide,
  def,
  variants,
  pres,
  SLIDE_TYPES,
  editorState,
}) {
  let close = null;
  let unregisterCloser = null;

  const openPopover = () => {
    const popover = h('div', {
      class: 'layout-switcher-popover',
      role: 'dialog',
      'aria-label': t('editor.layoutSwitcher.title', 'Slide layout'),
    });
    const grid = h('div', { class: 'layout-switcher-grid' });

    // Mirror toggle (image left/right): only when the definition declares a
    // mirror field. Applying it is a normal content-field update (one undo
    // step); the popover stays open and the schematics flip live.
    const mirror = getLayoutMirror(def);
    let mirrorBtns = null;
    if (mirror) {
      const setSide = (idx) => {
        if (!slide?.content || typeof slide.content !== 'object') return;
        const value = mirror.values[idx];
        if (slide.content[mirror.key] === value) return;
        slide.content[mirror.key] = value;
        editorState.dirtyRefreshWithItem();
        syncMirrorState();
        renderGrid();
      };
      mirrorBtns = [
        h('button', {
          type: 'button',
          class: 'sb-segmented-btn',
          text: t('editor.layoutSwitcher.imageLeft', 'Image left'),
          onclick: () => setSide(0),
        }),
        h('button', {
          type: 'button',
          class: 'sb-segmented-btn',
          text: t('editor.layoutSwitcher.imageRight', 'Image right'),
          onclick: () => setSide(1),
        }),
      ];
      popover.append(
        h(
          'div',
          {
            class: 'sb-segmented is-toggle layout-switcher-mirror',
            role: 'group',
            'aria-label': t(
              'editor.layoutSwitcher.imagePosition',
              'Image position',
            ),
          },
          mirrorBtns,
        ),
      );
    }
    const syncMirrorState = () => {
      if (!mirrorBtns) return;
      const mirrored = isMirrored(slide, def);
      mirrorBtns[0].classList.toggle('is-active', !mirrored);
      mirrorBtns[0].setAttribute('aria-pressed', mirrored ? 'false' : 'true');
      mirrorBtns[1].classList.toggle('is-active', mirrored);
      mirrorBtns[1].setAttribute('aria-pressed', mirrored ? 'true' : 'false');
    };
    syncMirrorState();

    // Text-columns toggle (1/2 columns): only when the definition declares
    // it AND the current layout is one it applies to (`when`). Picking a
    // layout tile closes the popover, so this visibility check at open time
    // can't go stale. Same interaction model as the mirror toggle: a normal
    // content-field update, one undo step, popover stays open.
    const textCols = getLayoutTextColumns(def);
    let textColsBtns = null;
    const textColsApplies =
      textCols &&
      (!textCols.when ||
        textCols.when.values.includes(
          effectiveContentValue(slide, def, textCols.when.key),
        ));
    const syncTextColsState = () => {
      if (!textColsBtns) return;
      const active =
        effectiveContentValue(slide, def, textCols.key) === textCols.values[1]
          ? 1
          : 0;
      textColsBtns.forEach((btn, i) => {
        btn.classList.toggle('is-active', i === active);
        btn.setAttribute('aria-pressed', i === active ? 'true' : 'false');
      });
    };
    if (textColsApplies) {
      const setCols = (idx) => {
        if (!slide?.content || typeof slide.content !== 'object') return;
        const value = textCols.values[idx];
        if (slide.content[textCols.key] === value) return;
        slide.content[textCols.key] = value;
        editorState.dirtyRefreshWithItem();
        syncTextColsState();
      };
      textColsBtns = [
        h('button', {
          type: 'button',
          class: 'sb-segmented-btn',
          text: t('editor.layoutSwitcher.textCols1', '1 column'),
          onclick: () => setCols(0),
        }),
        h('button', {
          type: 'button',
          class: 'sb-segmented-btn',
          text: t('editor.layoutSwitcher.textCols2', '2 columns'),
          onclick: () => setCols(1),
        }),
      ];
      popover.append(
        h(
          'div',
          {
            class: 'sb-segmented is-toggle layout-switcher-mirror',
            role: 'group',
            'aria-label': t(
              'editor.layoutSwitcher.textColumns',
              'Text columns',
            ),
          },
          textColsBtns,
        ),
      );
      syncTextColsState();
    }

    popover.append(grid);

    const renderGrid = () => {
      const activeId = activeLayoutVariantId(slide, def);
      const mirrored = isMirrored(slide, def);
      grid.replaceChildren();
      for (const variant of variants) {
        grid.append(
          buildTile({
            variant,
            label: variantLabel(variant, SLIDE_TYPES),
            isActive: !variant.convertTo && variant.id === activeId,
            mirrored,
            compact: false,
            onPick: () => {
              close?.();
              pickVariant({ variant, slide, pres, SLIDE_TYPES, editorState });
            },
          }),
        );
      }
    };
    renderGrid();

    document.body.append(popover);

    // Position under the chip, clamped to the viewport.
    const r = chip.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = `${r.bottom + 6}px`;
    popover.style.left = `${r.left}px`;
    requestAnimationFrame(() => {
      const pr = popover.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        popover.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`;
      }
      if (pr.bottom > window.innerHeight - 8) {
        popover.style.top = `${Math.max(8, r.top - pr.height - 6)}px`;
      }
    });

    const onDocClick = (e) => {
      if (!popover.contains(e.target) && !chip.contains(e.target)) close?.();
    };
    const onKey = (e) => {
      if (!takeEscape(e)) return;
      close?.();
      try {
        chip.focus();
      } catch {
        // ignore
      }
    };

    close = () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      popover.remove();
      chip.setAttribute('aria-expanded', 'false');
      unregisterCloser?.();
      unregisterCloser = null;
      close = null;
    };
    unregisterCloser = registerOverlayCloser(popover, close);
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    chip.setAttribute('aria-expanded', 'true');

    const firstTile =
      grid.querySelector('.layout-tile.is-active') ||
      grid.querySelector('.layout-tile');
    requestAnimationFrame(() => {
      try {
        firstTile?.focus();
      } catch {
        // ignore
      }
    });
  };

  chip.addEventListener('click', () => {
    if (close) close();
    else openPopover();
  });
}

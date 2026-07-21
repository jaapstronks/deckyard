/**
 * Layout switcher: a "Layout" chip in the slide toolbar (above the canvas)
 * that opens a tile popover with one mini-schematic per declared layout
 * variant. One click switches the variant; content stays put and the switch
 * is a single undo step.
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
import { canConvertSlideTo, convertSlideWithConfirm, slideTypeLabel } from './convert-slide-action.js';
import { renderSlideSchematic } from '../../lib/slide-authoring/slide-schematic.js';

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
  const when = whenKey && whenValues?.length ? { key: whenKey, values: whenValues } : null;
  return { key, values, when };
}

/**
 * Draw the mini-schematic for one variant tile via the shared schematic
 * renderer, so the layout switcher and the slide-type picker speak one visual
 * language. Reads the variant's declared `schematic` spec (see
 * client/lib/slide-schematic.js for the grammar).
 * @param {Function} h
 * @param {Object} variant
 * @param {boolean} mirrored
 * @returns {HTMLElement}
 */
function renderSchematic(h, variant, mirrored) {
  return renderSlideSchematic(h, variant?.schematic, { mirrored });
}

/**
 * Build the "Layout" toolbar chip for a slide, or null when its type
 * declares no layout variants.
 * @param {Object} opts
 * @param {Function} opts.h
 * @param {Object} opts.slide - live slide object
 * @param {Object} opts.pres
 * @param {Object} opts.SLIDE_TYPES
 * @param {Object} opts.editorState - createEditorStateUpdater instance
 * @param {Set<Function>} [opts.openOverlayClosers]
 * @returns {HTMLElement|null}
 */
export function createLayoutSwitcherChip({
  h,
  slide,
  pres,
  SLIDE_TYPES,
  editorState,
  openOverlayClosers,
} = {}) {
  const def = SLIDE_TYPES?.[slide?.type];
  const variants = getLayoutVariants(def);
  if (!variants.length) return null;

  const chip = h('button', {
    type: 'button',
    class: 'btn layout-switcher-chip',
    title: t('editor.layoutSwitcher.title', 'Slide layout'),
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  });
  chip.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><line x1="8" y1="2.5" x2="8" y2="13.5"/></svg>';
  chip.append(
    h('span', { text: t('editor.layoutSwitcher.chip', 'Layout') })
  );

  let close = null;

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
            'aria-label': t('editor.layoutSwitcher.imagePosition', 'Image position'),
          },
          mirrorBtns
        )
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
          effectiveContentValue(slide, def, textCols.when.key)
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
            'aria-label': t('editor.layoutSwitcher.textColumns', 'Text columns'),
          },
          textColsBtns
        )
      );
      syncTextColsState();
    }

    popover.append(grid);

    const pickVariant = async (variant) => {
      close?.();
      if (variant.convertTo) {
        // Cross-type tile: the shared convert seam moves the type underneath
        // (lossy confirm included); any `set` lands on the converted content.
        const ok = await convertSlideWithConfirm({
          h,
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
    };

    const renderGrid = () => {
      const activeId = activeLayoutVariantId(slide, def);
      const mirrored = isMirrored(slide, def);
      grid.replaceChildren();
      for (const variant of variants) {
        // Cross-type tiles only when the seam supports the conversion here
        // (keeps custom types that override a core name working).
        if (variant.convertTo && !canConvertSlideTo(slide, variant.convertTo, SLIDE_TYPES)) {
          continue;
        }
        const label = variant.convertTo && !variant.labelKey && !variant.label
          ? slideTypeLabel(variant.convertTo, SLIDE_TYPES)
          : t(variant.labelKey || `editor.layoutVariant.${variant.id}`, variant.label || variant.id);
        const isActive = !variant.convertTo && variant.id === activeId;
        const tile = h(
          'button',
          {
            type: 'button',
            class: `layout-tile${isActive ? ' is-active' : ''}`,
            'aria-pressed': isActive ? 'true' : 'false',
            title: label,
            onclick: () => pickVariant(variant),
          },
          [renderSchematic(h, variant, mirrored), h('span', { class: 'layout-tile-label', text: label })]
        );
        grid.append(tile);
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
      if (e.key !== 'Escape') return;
      e.stopPropagation();
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
      openOverlayClosers?.delete(close);
      close = null;
    };
    openOverlayClosers?.add(close);
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    chip.setAttribute('aria-expanded', 'true');

    const firstTile = grid.querySelector('.layout-tile.is-active') || grid.querySelector('.layout-tile');
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

  return chip;
}

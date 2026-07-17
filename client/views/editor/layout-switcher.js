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

/** Mirror state: schematics flip when the image sits on the right. */
const isMirrored = (slide) => slide?.content?.imageSide === 'right';

/**
 * Draw the mini-schematic for one variant tile: a 16:9 box with an "image"
 * block and "text" lines, driven by the variant's declared `schematic`
 * ({ split: <image %> } | { corner: <image %> } | { duo: <image %> } |
 * { row: 'top'|'bottom' } | {} for text-only). Rows don't mirror.
 * @param {Function} h
 * @param {Object} variant
 * @param {boolean} mirrored
 * @returns {HTMLElement}
 */
function renderSchematic(h, variant, mirrored) {
  const box = h('div', { class: 'layout-tile-schematic', 'aria-hidden': 'true' });
  const sch = variant?.schematic && typeof variant.schematic === 'object' ? variant.schematic : {};
  const textBlock = () =>
    h('div', { class: 'layout-tile-text' }, [
      h('div', { class: 'layout-tile-line is-heading' }),
      h('div', { class: 'layout-tile-line' }),
      h('div', { class: 'layout-tile-line is-short' }),
    ]);

  const splitPct = Number(sch.split);
  const cornerPct = Number(sch.corner);
  const duoPct = Number(sch.duo);
  const row = sch.row === 'top' || sch.row === 'bottom' ? sch.row : '';
  const rowBlock = () =>
    h('div', { class: 'layout-tile-row' }, [
      h('div', { class: 'layout-tile-image' }),
      h('div', { class: 'layout-tile-image' }),
    ]);
  if (Number.isFinite(splitPct) && splitPct > 0) {
    const img = h('div', { class: 'layout-tile-image', style: `width:${splitPct}%` });
    box.classList.add('is-split');
    if (mirrored) box.append(textBlock(), img);
    else box.append(img, textBlock());
  } else if (Number.isFinite(cornerPct) && cornerPct > 0) {
    const img = h('div', { class: 'layout-tile-image is-corner', style: `width:${cornerPct}%` });
    box.classList.add('is-corner');
    if (mirrored) box.append(textBlock(), img);
    else box.append(img, textBlock());
  } else if (Number.isFinite(duoPct) && duoPct > 0) {
    const stack = h('div', { class: 'layout-tile-duo', style: `width:${duoPct}%` }, [
      h('div', { class: 'layout-tile-image' }),
      h('div', { class: 'layout-tile-image' }),
    ]);
    box.classList.add('is-duo');
    if (mirrored) box.append(textBlock(), stack);
    else box.append(stack, textBlock());
  } else if (row) {
    box.classList.add('is-row', row === 'top' ? 'is-row-top' : 'is-row-bottom');
    if (row === 'top') box.append(rowBlock(), textBlock());
    else box.append(textBlock(), rowBlock());
  } else {
    box.classList.add('is-text-only');
    box.append(textBlock());
  }
  return box;
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
    class: 'btn btn-sm layout-switcher-chip',
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
    const activeId = activeLayoutVariantId(slide, def);
    const mirrored = isMirrored(slide);

    const popover = h('div', {
      class: 'layout-switcher-popover',
      role: 'dialog',
      'aria-label': t('editor.layoutSwitcher.title', 'Slide layout'),
    });
    const grid = h('div', { class: 'layout-switcher-grid' });
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

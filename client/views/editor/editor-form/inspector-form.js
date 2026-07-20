import { t } from '../../../lib/ui-i18n.js';
import { getInlineFormTextKeys } from '../inline-edit/descriptors.js';
import { renderImagePositionPicker } from './image-position-picker.js';
import { fieldCardLink } from '../fields/card-link-field.js';
import { renderChartConfigControls } from './slide-forms/chart.js';
import { syncIconCardsToNumbered } from './slide-forms/icon-card-grid.js';
import {
  appendImageFocusPicker,
  appendImageZoomSettings,
  appendImageTextLayoutOptions,
} from './slide-forms/image-slide.js';
import { renderImageTextImagesSection } from './slide-forms/image-text-images.js';
import { renderImageElementCard } from './image-element-card.js';

/**
 * What the phase-3 inspector keeps per slide type (editor-UI track, fase 3).
 *
 * This map mirrors the per-type coverage audit in
 * docs/reference/editor-inspector.md: the inspector renders
 * ONLY Background, Accessibility and these settings/design fields. Content
 * fields live on the slide itself (wysiwyg) and - all of them, by
 * construction - in the "Edit all text" bulk modal. A key may only be dropped
 * from this map when its replacement surface has shipped (parity invariant).
 *
 * Documented deviations from the audit table's shorthand (see the reference doc):
 * - table colCount, team-cards cardCount and logo-wall logoCount are derived
 *   mirrors managed by their editors/arrays and were never rendered as form
 *   controls; they are not resurrected here.
 * - gallery keeps its layout enum (missing from the audit's keeps column;
 *   enums are inspector material by definition).
 *
 * Keys handled by the shared Background/Accessibility sections are not listed.
 */
const INSPECTOR_KEEPS = {
  'title-slide': ['logoCorner'],
  'chapter-title-slide': ['layout'],
  'content-slide': ['layout', 'density'],
  'table-slide': ['headerRow', 'tableStyle', 'animateByCell'],
  'list-slide': ['variant', 'layout', 'density'],
  'lijstje-slide': ['variant', 'layout', 'density'],
  'kpi-metrics-slide': ['accent', 'countUp'],
  'split-partner-title-slide': [],
  // `layout` (structural variant) is intentionally NOT kept: the toolbar
  // "Layout" chip is its canonical control in the inspector. textColumns /
  // imageSide stay as precise, distinctly-named sub-settings.
  // `imageFit` is intentionally absent since datamodel step 2b: fit is a
  // per-image ImageRef property (images manager / "This image"), no longer a
  // writable slide-level setting.
  'image-text-slide': ['imageRole', 'density', 'textColumns', 'imageSide', 'imageWidth', 'imageBackground'],
  'video-slide': ['autoplay'],
  'team-cards-slide': ['textPosition', 'imageShape', 'imageAspect', 'showPhotoFrame', 'columnSplit'],
  'logo-wall-slide': [],
  'card-stack-slide': ['cardCount'],
  'icon-card-grid-slide': ['layout'],
  'payoff-slide': [],
  'quote-slide': [],
  'image-slide': ['imageRole', 'layout', 'zoomSteps', 'zoomLevel', 'zoomPositions'],
  'embed-slide': ['aspectRatio', 'sandbox'],
  'countdown-slide': ['durationMinutes', 'durationSeconds', 'autoStart', 'flashOnZero', 'soundOnZero'],
  'poll-slide': ['onClose'],
  'likert-slide': ['onClose'],
  'likert-slider-slide': [],
  'feedback-slide': [],
  'lead-capture-slide': [],
  'follow-invite-slide': [],
  'chart-slide': ['chartType', 'showLegend', 'showValues', 'pieLabelMode'],
  'text-blocks-slide': [],
  'content-columns-slide': ['columnCount'],
  'comparison-slide': [],
  'process-slide': ['direction'],
  'timeline-slide': [],
  'matrix-slide': [],
  'funnel-slide': [],
  'pyramid-slide': [],
  'cycle-slide': [],
  'gallery-slide': ['layout'],
  'freeform-slide': ['snapToGrid'],
  'custom-html-slide': [],
  'end-slide': [],
};

/**
 * Resolve the set of field keys the inspector may render for a slide type.
 *
 * Unknown (custom/fork) types are not in the audit, so they fall back
 * conservatively: every schema field EXCEPT the ones with proven wysiwyg
 * coverage (getInlineFormTextKeys) stays in the inspector - dropping more
 * would risk orphaning a field the fork has no other surface for.
 *
 * @param {string} type
 * @param {Object} def - Slide type definition (fields[])
 * @returns {Set<string>} keys allowed in the inspector (excl. bg/a11y routing)
 */
export function getInspectorKeepKeys(type, def) {
  const keeps = INSPECTOR_KEEPS[type];
  if (Array.isArray(keeps)) return new Set(keeps);
  const inlineCovered = new Set(getInlineFormTextKeys(type, def));
  const all = (def?.fields || []).map((f) => f.key).filter((k) => !inlineCovered.has(k));
  return new Set(all);
}

/**
 * Collapsible group for a bulky per-type widget block, styled like the
 * Background/Accessibility sections. Big blocks default closed so the pane
 * leads with the at-a-glance settings (chrome re-org stap 3).
 *
 * @param {Function} h - DOM helper
 * @param {string} title - Summary label
 * @param {{ open?: boolean }} [opts]
 * @returns {{ el: HTMLElement, body: HTMLElement }}
 */
function collapsibleGroup(h, title, { open = false } = {}) {
  const el = h('details', { class: 'editor-advanced' });
  if (open) el.open = true;
  el.append(h('summary', { class: 'editor-advanced-summary', text: title }));
  const body = h('div', { class: 'editor-advanced-body' });
  el.append(body);
  return { el, body };
}

/**
 * Per-type inspector widgets that a flat keeps-list cannot express: the chart
 * data editor, per-card icon/link controls, focus pickers, per-column image
 * settings. Runs BEFORE the generic keeps loop; anything rendered here marks
 * its keys used so the loop skips them.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderInspectorExtrasByType(ctx) {
  const { h, form, elementForm, selectedElement, slide, def, add, used, fieldByKey,
    renderField, deckSlides, fieldRenderers, markDirty, rerenderEditor,
    rerenderPreview, scheduleUiRefresh } = ctx;
  const { fieldGrid } = fieldRenderers || {};

  // The shared "This image" card for a selected image element (all image types
  // except image-text, which has its own per-image manager). Renders into the
  // element tab; returns whether it produced anything.
  const renderSelectedImageCard = (container) =>
    renderImageElementCard({
      h,
      container,
      slide,
      def,
      idx: selectedElement?.idx,
      fieldRenderers,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      scheduleUiRefresh,
    });

  // Render a keep field directly into a chosen container (element or slide
  // panel), marking it used so the main keeps loop skips it. `add()` always
  // targets the slide form, so element-scoped keeps use this instead.
  const renderKeyInto = (container, key) => {
    used.add(key);
    const f = fieldByKey.get(key);
    if (!f) return;
    const node = renderField(f);
    if (node) container.append(node);
  };

  switch (slide.type) {
    case 'chart-slide':
      // chartType + data editor + per-type display toggles, exactly like the
      // form's config half (axis/series labels stay bulk-modal-only).
      renderChartConfigControls({
        h, form, slide, add, used, fieldByKey, renderField, fieldGrid,
        markDirty, rerenderEditor, scheduleUiRefresh,
      });
      return;

    case 'image-slide': {
      // The single image is the element: with it selected, all of its controls
      // (replace/alt, role, crop layout, focus grid, zoom) live in the element
      // tab; otherwise they render in the slide form as before.
      const imageSelected = selectedElement?.kind === 'image';
      const target = imageSelected ? elementForm : form;
      // Replace / alt / focus grid (cover) at the top of the element tab.
      if (imageSelected) renderSelectedImageCard(elementForm);
      renderKeyInto(target, 'imageRole');
      renderKeyInto(target, 'layout');
      const imgSection = h('div', { class: 'stack', 'data-inspector-section': 'image' });
      // Contain-mode (centered) alignment stays here; the cover focus grid is
      // rendered by the shared card above, so this is a no-op in cover mode.
      appendImageFocusPicker({ h, form: imgSection, slide, used, fieldByKey, markDirty, scheduleUiRefresh });
      appendImageZoomSettings({ h, form: imgSection, slide, used, fieldByKey, renderField });
      target.append(imgSection);
      return;
    }

    case 'image-text-slide': {
      // Image controls (role, per-image alt/fit/focus, image-area layout) move
      // to the element tab when an image is selected; density stays slide-wide.
      const target = selectedElement?.kind === 'image' ? elementForm : form;
      renderKeyInto(target, 'imageRole');
      add('density');
      // Images manager (images[], phase 2): the canvas media popover covers
      // pick/change per cell; this section adds per-image alt/fit/focus,
      // reorder, and the row model's third image. Rendering it also migrates
      // legacy flat content and pads items to the layout's cell count.
      const { fieldText, fieldEnum, fieldImage } = fieldRenderers || {};
      const imagesSection = renderImageTextImagesSection({
        h,
        slide,
        used,
        fieldGrid,
        fieldText,
        fieldEnum,
        fieldImage,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      if (imagesSection) {
        const section = collapsibleGroup(
          h,
          t('editor.imageText.images', 'Images')
        );
        // Marked so the canvas image's "Settings" chip can scroll here.
        section.el.setAttribute('data-inspector-section', 'image');
        section.body.append(imagesSection);
        target.append(section.el);
      }
      appendImageTextLayoutOptions({
        h, form: target, slide, used, fieldByKey, renderField, fieldGrid, markDirty, scheduleUiRefresh,
        // Inspector: the toolbar "Layout" chip owns the structural variant.
        hideLayoutField: true,
      });
      return;
    }

    case 'icon-card-grid-slide': {
      add('layout');
      // Per-card icon picker + link: settings the wysiwyg deliberately never
      // covers. With a card selected, only that card's controls render in the
      // element tab; otherwise all cards render in the slide-tab collapsible.
      const items = Array.isArray(slide.content?.items) ? slide.content.items : [];
      if (!items.length) return;
      const { fieldIconPicker } = fieldRenderers || {};
      const renderCard = (item, idx, container) => {
        const group = h('div', { class: 'stack card-group' });
        group.append(h('div', {
          class: 'help',
          text: `${idx + 1}. ${String(item?.title || '').trim() || t('editor.inspector.cardUntitled', 'Untitled card')}`,
        }));
        if (typeof fieldIconPicker === 'function') {
          group.append(fieldIconPicker(
            t('editor.cards.icon', 'Icon'),
            item.icon || '',
            (v) => {
              items[idx].icon = v;
              syncIconCardsToNumbered(slide);
              markDirty?.();
              scheduleUiRefresh?.();
            },
            {}
          ));
        }
        group.append(fieldCardLink({
          value: item.link || '',
          slides: deckSlides,
          onChange: (v) => {
            items[idx].link = v;
            syncIconCardsToNumbered(slide);
            markDirty?.();
            scheduleUiRefresh?.();
          },
          help: t(
            'editor.cards.linkHelp2',
            'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).'
          ),
        }));
        container.append(group);
      };

      const cardIdx =
        selectedElement?.kind === 'card' && selectedElement.idx < items.length
          ? selectedElement.idx
          : null;
      if (cardIdx != null) {
        renderCard(items[cardIdx], cardIdx, elementForm);
      } else {
        const section = collapsibleGroup(
          h,
          t('editor.inspector.cardsConfig', 'Card icons & links')
        );
        items.forEach((item, idx) => renderCard(item, idx, section.body));
        form.append(section.el);
      }
      return;
    }

    case 'content-columns-slide': {
      add('columnCount');
      const count = Math.max(1, Math.min(7, Number(slide.content?.columnCount || 3) || 3));
      // A selected column image routes to the element tab: the shared card
      // (replace/alt/fit/focus grid) plus that column's block count. `idx` is the
      // 1-based column number (data-inline-photo), matching the col{n} schema.
      if (selectedElement?.kind === 'image' && renderSelectedImageCard(elementForm)) {
        const n = selectedElement.idx;
        const blockCountField = fieldByKey.get(`col${n}BlockCount`);
        if (blockCountField) {
          used.add(`col${n}BlockCount`);
          const bcEl = renderField(blockCountField);
          if (bcEl) elementForm.append(bcEl);
        }
        // Mark every column's numbered image keys used so the generic keeps loop
        // never leaks a raw col{n}* field into the slide form.
        for (let n2 = 1; n2 <= count; n2 += 1) {
          used.add(`col${n2}Image`);
          used.add(`col${n2}Alt`);
          used.add(`col${n2}ImageFit`);
          used.add(`col${n2}ImageFocusX`);
          used.add(`col${n2}ImageFocusY`);
          used.add(`col${n2}BlockCount`);
        }
        return;
      }
      // Nothing selected: all active columns render in one slide-tab collapsible
      // (fit + contain-alignment + block count per column). Numbered schema, so
      // these are plain fields; the column texts live in the bulk modal.
      const renderColumn = (n, container) => {
        const imgUrl = String(slide.content?.[`col${n}Image`] || '').trim();
        const blockCountField = fieldByKey.get(`col${n}BlockCount`);
        if (!imgUrl && !blockCountField) return;
        const group = h('div', { class: 'stack' });
        group.append(h('div', {
          class: 'field-label',
          text: t('editor.inspector.column', 'Column {n}', { n: String(n) }),
        }));
        if (imgUrl) {
          used.add(`col${n}ImageFocusX`);
          used.add(`col${n}ImageFocusY`);
          const fitField = fieldByKey.get(`col${n}ImageFit`);
          if (fitField) {
            used.add(`col${n}ImageFit`);
            const fitEl = renderField(fitField);
            if (fitEl) group.append(fitEl);
          }
          // Cover focus is on the canvas; a contain column still gets alignment.
          const picker = renderImagePositionPicker({
            h,
            mode: slide.content?.[`col${n}ImageFit`] === 'contain' ? 'contain' : 'cover',
            imageUrl: imgUrl,
            containerSelector: '.preview-panel .thumb.is-clickable-preview .cc-image',
            focusX: slide.content?.[`col${n}ImageFocusX`] ?? 50,
            focusY: slide.content?.[`col${n}ImageFocusY`] ?? 50,
            onChange: ({ focusX, focusY } = {}) => {
              slide.content[`col${n}ImageFocusX`] = focusX;
              slide.content[`col${n}ImageFocusY`] = focusY;
              markDirty?.();
              scheduleUiRefresh?.();
            },
          });
          if (picker) group.append(picker);
        }
        if (blockCountField) {
          used.add(`col${n}BlockCount`);
          const bcEl = renderField(blockCountField);
          if (bcEl) group.append(bcEl);
        }
        if (group.childNodes.length > 1) container.append(group);
      };
      const colSection = collapsibleGroup(
        h,
        t('editor.inspector.columnsConfig', 'Column images & blocks')
      );
      for (let n = 1; n <= count; n += 1) renderColumn(n, colSection.body);
      if (colSection.body.childNodes.length) form.append(colSection.el);
      return;
    }

    // Image types whose only per-element settings are the shared card
    // (replace/alt/fit/focus/extras). Their slide-wide settings render via the
    // generic keeps loop; add/remove/reorder lives on the canvas.
    case 'gallery-slide':
    case 'team-cards-slide':
    case 'logo-wall-slide':
    case 'quote-slide':
      if (selectedElement?.kind === 'image') renderSelectedImageCard(elementForm);
      return;

    default:
  }
}

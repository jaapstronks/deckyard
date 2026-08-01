import { t } from '../../../lib/ui-i18n.js';
import { getInlineFormTextKeys } from '../inline-edit/descriptors.js';
import { renderImagePositionPicker } from './image-position-picker.js';
import { fieldCardLink } from '../fields/card-link-field.js';
import { SLIDE_TYPE_INSPECTOR_KEEPS } from '../../../../shared/slide-types/inline-edit.js';
import { slideTypeInspectorKeeps } from '../../../../shared/slide-types/inline-edit-companions.js';
import { syncIconCardsToNumbered } from '../../../../shared/slide-types/types/icon-card-grid-slide/cards.js';
import { resolveListLayout } from '../../../../shared/slide-types/types/list-slide.js';
import {
  ensureContentColumnsImages,
  resolveContentColumnImage,
  CONTENT_COLUMNS_IMAGE_DEFAULTS,
} from '../../../../shared/slide-types/content-columns-images.js';
import { renderImageTextCollectionSection } from './slide-forms/image-text-images.js';
import { renderImageElementCard } from './image-element-card.js';

/**
 * What the phase-3 inspector keeps per slide type (editor-UI track, fase 3).
 *
 * The map itself is no longer written here. Every type declares its keep-list
 * in `shared/slide-types/types/<name>/inline-edit.js`, next to the on-canvas
 * descriptor it is the counterpart of — a field is kept in the inspector
 * *because* the canvas does not cover it, so the two answers drift the moment
 * they live in different files. What is left here is the rule that decides what
 * belongs in a keep-list, and the resolution of a type's keys.
 *
 * The rule the keep-lists follow: the inspector renders ONLY Background,
 * Accessibility and these settings/design fields. Content fields live on the
 * slide itself (wysiwyg) and — all of them, by construction — in the "Edit all
 * text" bulk modal. A key may only be dropped from a keep-list when its
 * replacement surface has shipped (parity invariant).
 *
 * The per-type coverage table in docs/reference/editor-inspector.md is generated
 * FROM these declarations (scripts/lib/slide-type-doc-tables.js), so it is a
 * readout rather than a second list to keep in step — edit the declaration and
 * regenerate.
 *
 * Coverage-audit rule (editing-surfaces §"Status: per-type coverage audit",
 * re-audited 2026-07-21): CONTENT TEXT may rely on the canvas + bulk modal;
 * SETTINGS/CONFIG/METADATA may never be bulk-only — a field the user cannot
 * point at on the canvas (URLs, config texts, alt/bg images) must render in the
 * inspector. `tests/slide-type-docs.test.js` states that half as a property:
 * no enum/boolean/number field may be left with the bulk modal as its only home.
 *
 * Documented deviations from the audit table's shorthand (see the reference
 * doc): table colCount, team-cards cardCount and logo-wall logoCount are
 * derived mirrors managed by their editors/arrays and were never rendered as
 * form controls, so they are not resurrected. Keys handled by the shared
 * Background/Accessibility sections are not listed either.
 *
 * Re-exported for the companion matrix (tests/slide-type-companion-coverage.js),
 * which catches a keep-list left behind for a type that no longer exists.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const INSPECTOR_KEEPS = SLIDE_TYPE_INSPECTOR_KEEPS;

/**
 * Resolve the set of field keys the inspector may render for a slide type.
 *
 * The keep-list comes from slideTypeInspectorKeeps(): the definition's own
 * declaration first, core's aggregator second (the seam rule — see
 * shared/slide-types/inline-edit-companions.js). A fork type that ships an
 * `inspectorKeeps` array on its definition therefore narrows its own settings
 * pane, which the old core-map-only lookup made impossible.
 *
 * A type neither side narrows is not in the audit, so it falls back
 * conservatively: every schema field EXCEPT the ones with proven wysiwyg
 * coverage (getInlineFormTextKeys) stays in the inspector - dropping more
 * would risk orphaning a field the fork has no other surface for.
 *
 * @param {string} type
 * @param {Object} def - Slide type definition (fields[])
 * @returns {Set<string>} keys allowed in the inspector (excl. bg/a11y routing)
 */
export function getInspectorKeepKeys(type, def) {
  const keeps = slideTypeInspectorKeeps(type, def);
  if (keeps) return new Set(keeps);
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
 * Per-type inspector widgets that a flat keeps-list cannot express: the shared
 * "This image" element card, per-card icon/link controls, the image-text
 * collection chrome, per-column image settings. Runs BEFORE the generic keeps
 * loop; anything rendered here marks its keys used so the loop skips them.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderInspectorExtrasByType(ctx) {
  const { h, form, elementForm, selectedElement, slide, def, add, used, fieldByKey,
    renderField, deckSlides, fieldRenderers, markDirty, rerenderEditor,
    rerenderPreview, scheduleUiRefresh } = ctx;

  // The shared "This image" card for a selected image element — every image
  // type, image-slide and image-text included. Renders into the element tab;
  // returns whether it produced anything.
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

  switch (slide.type) {
    // chart-slide no longer has a case here: its config (chartType, display
    // toggles, axis/series labels, the "Edit data…" entry point) renders via
    // the generic keeps loop — visibility per chart type is a `visibleWhen`
    // declaration on the fields and the data entry point is the csv-grid
    // widget's inspector rendering (render-field.js, `onEditData`).

    // image-slide no longer has a case here: the single image IS the element,
    // and everything settable on it (replace/alt, fit, bleed, focus) is
    // declared on the inline descriptor and rendered by the shared card below.
    // Its slide-wide settings — the a11y role and the zoom chain, the latter
    // with a `visibleWhen` chain instead of imperative show/hide — render via
    // the generic keeps loop.

    case 'image-text-slide': {
      // Editing-surfaces tab split: the "This image" tab carries ONLY the
      // selected cell's card — the same shared, descriptor-driven card every
      // other image type uses (the hand-written per-cell copy is gone). The
      // slide form — the no-selection view AND the Slide tab, identical by
      // construction — carries the slide-wide settings via the keeps loop,
      // plus the one thing no declaration expresses: the slim image
      // collection (add/reorder/remove, no per-image settings).
      if (selectedElement?.kind === 'image') renderSelectedImageCard(elementForm);
      const collectionSection = renderImageTextCollectionSection({
        h,
        slide,
        used,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      if (collectionSection) {
        collectionSection.setAttribute('data-inspector-section', 'image');
        form.append(collectionSection);
      }
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
      // Rendering also canonicalizes: stamped default-equal image values (the
      // old defaults wrote cover + focus 50/50 onto every column) drop back to
      // empty = follow the type (datamodel step 4).
      ensureContentColumnsImages(slide?.content);
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
          used.add(`col${n}ImageFit`);
          const resolved = resolveContentColumnImage(slide.content, n);
          // Fit with the silent-default UX (step 4): the empty option shows
          // the derived type default and empties the field when chosen.
          const fitEl = fieldRenderers?.fieldEnum?.(
            {
              key: `col${n}ImageFit`,
              label: t('editor.contentColumns.imageFit', 'Image fit'),
              options: [
                {
                  value: '',
                  label: t('editor.imageText.fitDefaultType', 'Default · {fit}', {
                    fit:
                      CONTENT_COLUMNS_IMAGE_DEFAULTS.fit === 'contain'
                        ? t('editor.contentColumns.fitContain', 'Fixed height')
                        : t('editor.contentColumns.fitCover', 'Cropped (16:9)'),
                  }),
                },
                { value: 'cover', label: t('editor.contentColumns.fitCover', 'Cropped (16:9)') },
                { value: 'contain', label: t('editor.contentColumns.fitContain', 'Fixed height') },
              ],
            },
            resolved.fitExplicit ? resolved.fit : '',
            (v) => {
              slide.content[`col${n}ImageFit`] = v;
              markDirty?.();
              rerenderEditor?.();
              scheduleUiRefresh?.();
            }
          );
          if (fitEl) group.append(fitEl);
          // Cover focus is on the canvas; a contain column still gets alignment.
          const picker = renderImagePositionPicker({
            h,
            mode: resolved.fit === 'contain' ? 'contain' : 'cover',
            imageUrl: imgUrl,
            containerSelector: '.preview-panel .thumb.is-clickable-preview .cc-image',
            focusX: resolved.focusX !== '' ? resolved.focusX : 50,
            focusY: resolved.focusY !== '' ? resolved.focusY : 50,
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

    case 'list-slide': {
      // "Text size" is the one list setting the renderer can overrule: a list
      // long AND wordy enough to spill even across two columns steps down a
      // size. That used to happen silently, so an author who picked Large saw
      // nothing change and no reason why. Render the field here (instead of
      // via the generic keeps loop) so a note can sit under it when the step
      // down is actually in effect.
      const densityField = fieldByKey.get('density');
      if (!densityField) return;
      used.add('density');
      const el = renderField(densityField);
      if (!el) return;
      form.append(el);
      const { steppedDownFrom, twoCol } = resolveListLayout(slide?.content);
      if (steppedDownFrom === 'comfortable') {
        el.append(
          h('div', {
            class: 'help',
            text: t(
              'editor.list.sizeSteppedDown',
              'Large does not fit these items, so they are shown at the default size. Shorten the item text, or use fewer items, to get Large back.'
            ),
          })
        );
      } else if (!twoCol && slide?.content?.layout === 'two-column') {
        // Defensive: the resolver honours an explicit two-column choice, so
        // this should not occur. Kept so a future capacity change cannot make
        // the column count silently disagree with the field.
        el.append(
          h('div', {
            class: 'help',
            text: t('editor.list.oneColumnFallback', 'Shown in one column: two columns do not fit.'),
          })
        );
      }
      return;
    }

    // Image types whose only per-element settings are the shared card
    // (replace/alt/fit/bleed/focus/extras). Their slide-wide settings render
    // via the generic keeps loop; add/remove/reorder lives on the canvas.
    case 'image-slide':
    case 'gallery-slide':
    case 'team-cards-slide':
    case 'logo-wall-slide':
    case 'quote-slide':
      if (selectedElement?.kind === 'image') renderSelectedImageCard(elementForm);
      return;

    default:
  }
}

import { debugLog } from '../../../lib/util/debug.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { normalizeLang, otherLang } from '../../../lib/format/i18n.js';
import { getRecommendedImageFit } from '../image-library/utils.js';
import { createCsvGridEditor } from '../fields/csv-grid.js';
import { createTableGridEditor } from '../fields/table-grid.js';
import { fieldCardLink } from '../fields/card-link-field.js';
import { renderImageFitField } from '../fields/image-fit.js';
import { createCollectionEditor } from './collection-editor.js';
import { fieldEditor } from '../../../../shared/slide-types/field-editors.js';
import {
  isFieldVisible,
  visibilityDriverKeys,
} from '../../../../shared/slide-types/field-visibility.js';

const LANG_SHORT = { nl: 'NL', 'en-GB': 'EN' };

/**
 * The other-language source value for a field, or '' when the other language
 * version doesn't exist / has nothing for this field. Drives whether the
 * "fill from other language" button renders at all.
 */
function otherLangFieldValue({ pres, slideId, key }) {
  const sourceLang = otherLang(normalizeLang(pres?.i18n?.active) || 'nl');
  if (!sourceLang) return { sourceLang: null, value: '' };
  const srcVersion = pres?.i18n?.versions?.[sourceLang];
  const srcSlide = Array.isArray(srcVersion?.slides)
    ? srcVersion.slides.find((s) => s?.id === slideId)
    : null;
  const raw = srcSlide?.content?.[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return { sourceLang, value };
}

function translateLabelRightEl({ h, pres, onTranslateField, slideId, key }) {
  if (!onTranslateField) return null;
  // Only offer the button when there is actually something to translate FROM:
  // a bare "Translate" next to an empty other-language field is dead UI and
  // its direction (which way does it translate?) is ambiguous.
  const { sourceLang, value } = otherLangFieldValue({ pres, slideId, key });
  if (!sourceLang || !value) return null;
  const langLabel = LANG_SHORT[sourceLang] || sourceLang;
  const preview = value.length > 90 ? `${value.slice(0, 90)}…` : value;
  return h('button', {
    class: 'btn btn-secondary is-compact-sm is-pill',
    type: 'button',
    text: t('editor.translateField.from', 'From {lang}', { lang: langLabel }),
    title: t(
      'editor.translateField.fromTitle',
      'Fill this field with a translation of the {lang} value (previewed first): “{value}”',
      { lang: langLabel, value: preview }
    ),
    onclick: async () => {
      try {
        await onTranslateField?.({ slideId, key });
      } catch (e) {
        debugLog('[editor] translate field failed', { slideId, key, e });
        // ignore; editor handles toast
      }
    },
  });
}

function affectsLabelForSlide({ slideType, fieldKey }) {
  return (
    (slideType === 'title-slide' && fieldKey === 'title') ||
    (slideType === 'chapter-title-slide' && fieldKey === 'title') ||
    (slideType === 'content-slide' && fieldKey === 'title') ||
    (slideType === 'list-slide' && fieldKey === 'title') ||
    (slideType === 'chart-slide' && fieldKey === 'title') ||
    (slideType === 'image-text-slide' && fieldKey === 'title') ||
    (slideType === 'quote-slide' && fieldKey === 'quote') ||
    (slideType === 'image-slide' &&
      (fieldKey === 'caption' || fieldKey === 'title'))
  );
}

export function createRenderField({
  h,
  pres,
  slide,
  def,
  PARTNER_LOGOS,
  fieldRenderers,
  // Deck slides (minus the current one) for in-collection card-link widgets.
  deckSlides = [],
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
  updateSelectedSlideListItem,
  onTranslateField,
  canEditCustomHtml = false,
  // Inspector only: opens the bottom-panel Data tab for the csv-grid widget.
  // When set, the widget renders an "Edit data…" entry point instead of the
  // inline grid (the grid belongs on a wide surface, editing-surfaces §4.3).
  onEditData = null,
} = {}) {
  const {
    fieldText,
    fieldNumber,
    fieldMarkdown,
    fieldCode,
    fieldEnum,
    fieldBackground,
    fieldImage,
    fieldTitleBgImage,
    fieldImages,
    fieldIconPicker,
  } = fieldRenderers || {};

  // Editing one of these changes WHICH controls the form shows (some other
  // field declares `visibleWhen` on it), so its change handler rebuilds the
  // form instead of only repainting the preview. Derived from the schema, so a
  // fork type's own declarations are honoured without a line here.
  const visibilityDrivers = visibilityDriverKeys(def?.fields);

  /**
   * The csv-grid widget (field-editors.js vocabulary; also the base widget of
   * the `csv` field TYPE). Inline grid by default; with `onEditData` (the
   * inspector) an entry-point button into the wide data surface instead.
   */
  const renderCsvGrid = (field) => {
    const label = t(field.labelKey || field.key, field.label || field.key);
    if (typeof onEditData === 'function') {
      return h('div', { class: 'field chart-data-entry' }, [
        h('label', { class: 'field-label', text: label }),
        h('button', {
          class: 'btn btn-secondary chart-data-edit-btn',
          type: 'button',
          text: t('editor.chart.editData', 'Edit data…'),
          onclick: () => onEditData(),
        }),
        h('p', {
          class: 'help',
          text: t(
            'editor.chart.editDataHelp',
            'Opens the data editor with a live chart preview.'
          ),
        }),
      ]);
    }
    const dataEditor = createCsvGridEditor({
      h,
      chartType: String(slide.content?.chartType || 'bar'),
      value: slide.content[field.key] || '',
      label,
      onChange: (csv) => {
        slide.content[field.key] = csv;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    });
    return dataEditor.el;
  };

  const renderFieldInner = function renderField(field) {
    if (!field) return null;

    // `visibleWhen` (field-visibility.js): a field whose declared condition
    // does not hold right now renders nothing — the declarative form of the
    // old per-type show/hide branches (axis labels on a pie chart).
    if (!isFieldVisible(field, slide.content, def?.defaults)) return null;

    // The closed `editor` vocabulary (field-editors.js): a declared widget
    // outranks the base widget the field's type implies; an unknown or
    // unimplemented name falls through to the type dispatch below.
    const editor = fieldEditor(field);
    if (editor === 'table-grid') {
      return createTableGridEditor({
        h,
        slide,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
    }
    if (editor === 'csv-grid') {
      return renderCsvGrid(field);
    }
    if (editor === 'icon-picker' && typeof fieldIconPicker === 'function') {
      return fieldIconPicker(
        t(field.labelKey || field.key, field.label || field.key),
        slide.content[field.key] || '',
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        {}
      );
    }
    if (editor === 'card-link') {
      return fieldCardLink({
        value: slide.content[field.key] || '',
        slides: deckSlides,
        onChange: (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        help: t(
          'editor.cards.linkHelp2',
          'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).'
        ),
      });
    }
    if (editor === 'image-fit') {
      return renderImageFitField({
        fieldEnum,
        field,
        target: slide.content,
        typeDefault: def?.imageDefaults?.fit,
        onChange: (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          // The focus control switches between crop grid and alignment with
          // the effective fit, so the form is rebuilt, not just repainted.
          rerenderEditor?.();
          scheduleUiRefresh?.();
        },
      });
    }

    if (field.type === 'string') {
      const affectsLabel = affectsLabelForSlide({
        slideType: slide.type,
        fieldKey: field.key,
      });
      const isAltField =
        field.key === 'alt' ||
        field.key === 'bgAlt' ||
        String(field.key || '').toLowerCase().endsWith('alt');
      const helpText =
        typeof field.helpText === 'string' && field.helpText.trim()
          ? t(field.helpTextKey || field.key + '.help', field.helpText)
          : isAltField
            ? t(
                'editor.alt.help',
                "Describe what's important in the image (not the slide title). Aim for ~120–180 characters."
              )
            : '';
      const helpCopyExample =
        typeof field.helpCopyExample === 'string' && field.helpCopyExample.trim()
          ? field.helpCopyExample
          : '';
      const labelRightEl = translateLabelRightEl({
        h,
        pres,
        onTranslateField,
        slideId: slide.id,
        key: field.key,
      });
      return fieldText(
        t(field.labelKey || field.key, field.label || field.key),
        slide.content[field.key] || '',
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          if (affectsLabel) updateSelectedSlideListItem?.();
          scheduleUiRefresh?.();
        },
        {
          maxLength: field.maxLength,
          required: !!field.required,
          labelRightEl,
          helpText,
          helpCopyExample,
        }
      );
    }

    if (field.type === 'markdown') {
      const labelRightEl = translateLabelRightEl({
        h,
        pres,
        onTranslateField,
        slideId: slide.id,
        key: field.key,
      });
      // Show heading button only for content and image-text slides
      const showHeading =
        slide.type === 'content-slide' || slide.type === 'image-text-slide';
      return fieldMarkdown(
        t(field.labelKey || field.key, field.label || field.key),
        slide.content[field.key] || '',
        t(
          'editor.markdown.help',
          'Supports paragraphs, lists, bold/italic, links, and markdown tables.'
        ),
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        {
          maxLength: field.maxLength,
          required: !!field.required,
          labelRightEl,
          showHeading,
        }
      );
    }

    if (field.type === 'csv') {
      // The csv-grid widget is the base editor of the `csv` type (currently
      // the chart `data` field).
      return renderCsvGrid(field);
    }

    if (field.type === 'code') {
      if (!fieldCode) return null;
      // Capability-gated fields (e.g. raw HTML/CSS) are read-only unless the
      // user holds the capability. The server enforces the same rule on write;
      // this is the UI half so non-capable users see but can't edit the markup.
      const gated = field.capability === 'customHtml';
      const readOnly = gated && !canEditCustomHtml;
      const helpText =
        typeof field.helpText === 'string' && field.helpText.trim()
          ? t(field.helpTextKey || field.key + '.help', field.helpText)
          : '';
      return fieldCode(
        t(field.labelKey || field.key, field.label || field.key),
        slide.content[field.key] || '',
        readOnly
          ? t(
              'editor.code.readOnly',
              'Read-only. You do not have permission to edit raw HTML/CSS.'
            )
          : helpText,
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        {
          maxLength: field.maxLength,
          required: !!field.required,
          readOnly,
        }
      );
    }

    if (field.type === 'number') {
      if (!fieldNumber) return null;
      const val = slide.content[field.key];
      const helpText =
        typeof field.helpText === 'string' && field.helpText.trim()
          ? t(field.helpTextKey || field.key + '.help', field.helpText)
          : '';
      return fieldNumber(
        t(field.labelKey || field.key, field.label || field.key),
        val ?? '',
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        {
          required: !!field.required,
          min: field.min,
          max: field.max,
          step: field.step,
          helpText,
        }
      );
    }

    if (field.type === 'enum') {
      const val = slide.content[field.key] ?? def.defaults[field.key];
      const renderer =
        field?.key === 'background' && fieldBackground
          ? fieldBackground
          : fieldEnum;
      return renderer(field, val, (v) => {
        slide.content[field.key] = v;
        markDirty?.();
        // A driver of some other field's `visibleWhen` (chart type, image role,
        // zoom steps, …) changes which controls exist, so the form is rebuilt
        // rather than repainted.
        if (visibilityDrivers.has(field.key)) rerenderEditor?.();
        scheduleUiRefresh?.();
      });
    }

    if (field.type === 'boolean') {
      // On/off pair rendered by the enum control. Storage follows the
      // empty-means-follow-the-type rule the ImageRef axes are built on: the
      // choice that equals the type default (`defaults[key]`, absent = false)
      // clears the field, only a deviating choice is written. So a later
      // change to the default still reaches decks that never overrode it.
      const typeDefault = def?.defaults?.[field.key] === true;
      const current = typeof slide.content[field.key] === 'boolean'
        ? slide.content[field.key]
        : typeDefault;
      return fieldEnum(
        {
          key: field.key,
          label: t(field.labelKey || field.key, field.label || field.key),
          options: [
            { value: 'off', label: t('common.off', 'Off') },
            { value: 'on', label: t('common.on', 'On') },
          ],
        },
        current ? 'on' : 'off',
        (v) => {
          const next = v === 'on';
          slide.content[field.key] = next === typeDefault ? '' : next;
          markDirty?.();
          if (visibilityDrivers.has(field.key)) rerenderEditor?.();
          scheduleUiRefresh?.();
        }
      );
    }

    if (field.type === 'image') {
      // Use specialized background image picker when presetSource is 'backgrounds'
      if (field.presetSource === 'backgrounds' && fieldTitleBgImage) {
        return fieldTitleBgImage(slide, field, (url) => {
          slide.content[field.key] = url;
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        });
      }
      return fieldImage(slide, field, (url) => {
        slide.content[field.key] = url;

        // Auto-fit: for image-slide and image-text-slide, detect aspect ratio mismatch
        // and automatically switch to contain/fit mode if the image would be heavily cropped.
        // Only apply when setting a new image (not clearing), and only for the main 'image' field.
        if (url && field.key === 'image' && (slide.type === 'image-slide' || slide.type === 'image-text-slide')) {
          getRecommendedImageFit(url)
            .then(({ shouldContain }) => {
              if (shouldContain) {
                if (slide.type === 'image-slide') {
                  // Fit is an ImageRef axis (step 3): only auto-switch when the
                  // user hasn't explicitly chosen one (no own fit, no legacy
                  // layout beyond the old default 'full').
                  const c = slide.content;
                  const explicit =
                    c.fit === 'cover' || c.fit === 'contain' ||
                    (c.layout && c.layout !== 'full');
                  if (!explicit) {
                    c.fit = 'contain';
                    debugLog('[auto-fit] Switched image-slide to contain fit due to aspect ratio mismatch');
                    toast.info(
                      t('editor.autoFit.applied', 'Switched to "Fit (no crop)" to show your full image. You can change this in Layout.'),
                      { id: 'auto-fit-toast' }
                    );
                    markDirty?.();
                    rerenderEditor?.();
                    scheduleUiRefresh?.();
                  }
                } else if (slide.type === 'image-text-slide') {
                  // Fit is per-image (ImageRef, step 2b): auto-switch the first
                  // item's fit, and only when the user hasn't explicitly set one.
                  // This path fires from the legacy flat `image` field, so the
                  // image may not be migrated into images[0] yet - then write
                  // the legacy slide-level fit, which the next edit folds in.
                  const items = Array.isArray(slide.content.images) ? slide.content.images : [];
                  const item0 = items[0] && typeof items[0] === 'object' ? items[0] : null;
                  const currentFit = item0?.fit || slide.content.imageFit;
                  if (!currentFit || currentFit === 'cover') {
                    if (item0) item0.fit = 'contain';
                    else slide.content.imageFit = 'contain';
                    debugLog('[auto-fit] Switched image-text-slide to contain fit due to aspect ratio mismatch');
                    toast.info(
                      t('editor.autoFit.applied', 'Switched to "Fit (no crop)" to show your full image. You can change this in Layout options.'),
                      { id: 'auto-fit-toast' }
                    );
                    markDirty?.();
                    rerenderEditor?.();
                    scheduleUiRefresh?.();
                  }
                }
              }
            })
            .catch((err) => {
              debugLog('[auto-fit] Failed to determine image fit:', err);
              // Silently ignore - just don't auto-switch
            });
        }

        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      });
    }

    if (field.type === 'images') {
      return fieldImages(
        slide,
        field,
        field.presetSource === 'partnerlogos' ? PARTNER_LOGOS : [],
        (arr) => {
          slide.content[field.key] = arr;
          markDirty?.();
          scheduleUiRefresh?.();
        }
      );
    }

    if (field.type === 'color') {
      const { fieldColor } = fieldRenderers || {};
      if (!fieldColor) return null;
      const val = slide.content[field.key] ?? '';
      const helpText =
        typeof field.helpText === 'string' && field.helpText.trim()
          ? t(field.helpTextKey || field.key + '.help', field.helpText)
          : '';
      return fieldColor(
        t(field.labelKey || field.key, field.label || field.key),
        val,
        (v) => {
          slide.content[field.key] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        { helpText }
      );
    }

    if (field.type === 'items') {
      // The one generic collection editor (add/remove/reorder/collapse),
      // driven by this field's schema. See collection-editor.js.
      return createCollectionEditor({
        h,
        slide,
        def,
        field,
        fieldRenderers,
        deckSlides,
        markDirty,
        scheduleUiRefresh,
      });
    }

    return null;
  };

  return function renderField(field) {
    const el = renderFieldInner(field);
    // Collab presence: every field wrapper carries its content key so focus
    // inside the side form can be reported to and decorated for
    // collaborators (see presence/presence-ui.js). Inert without collab.
    if (el instanceof HTMLElement && field?.key) {
      el.setAttribute('data-collab-field-key', String(field.key));
    }
    return el;
  };
}

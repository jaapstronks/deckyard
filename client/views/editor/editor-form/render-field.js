import { debugLog } from '../../../lib/debug.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { normalizeLang, otherLang } from '../../../lib/i18n.js';
import { getRecommendedImageFit } from '../image-library/utils.js';
import { createCsvGridEditor } from '../fields/csv-grid.js';

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
    (slideType === 'lijstje-slide' && fieldKey === 'title') ||
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
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
  updateSelectedSlideListItem,
  onTranslateField,
  canEditCustomHtml = false,
} = {}) {
  const {
    fieldText,
    fieldNumber,
    fieldTextarea,
    fieldMarkdown,
    fieldCode,
    fieldEnum,
    fieldGrid,
    fieldBackground,
    fieldIconPicker,
    fieldImage,
    fieldTitleBgImage,
    fieldImages,
  } = fieldRenderers || {};

  const renderFieldInner = function renderField(field) {
    if (!field) return null;

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
      // Data-grid editor (currently the chart `data` field). The chart side form
      // renders its own instance; this branch covers the generic dispatch path.
      const dataEditor = createCsvGridEditor({
        h,
        chartType: String(slide.content?.chartType || 'bar'),
        value: slide.content[field.key] || '',
        label: t(field.labelKey || field.key, field.label || field.key),
        onChange: (csv) => {
          slide.content[field.key] = csv;
          markDirty?.();
          scheduleUiRefresh?.();
        },
      });
      return dataEditor.el;
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
        // Chart type drives which fields are shown (pie vs bar vs line), so a
        // change must rebuild the form, not just refresh the preview.
        if (field.key === 'chartType') rerenderEditor?.();
        scheduleUiRefresh?.();
      });
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
      const arr = Array.isArray(slide.content?.[field.key])
        ? slide.content[field.key]
        : structuredClone(def?.defaults?.[field.key] || []);
      const minItems = Math.max(0, Number(field?.minItems || 0) || 0);
      const maxItems = Math.max(minItems, Number(field?.maxItems || 99) || 99);
      const itemDefaults =
        field?.itemDefaults && typeof field.itemDefaults === 'object'
          ? field.itemDefaults
          : {};
      const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : [];

      const wrap = h('div', { class: 'stack is-field' });
      wrap.append(
        h('div', {
          class: 'field-label',
          text: t(field.labelKey || field.key, field.label || field.key),
        })
      );

      const getCurrentArr = () =>
        Array.isArray(slide.content?.[field.key])
          ? slide.content[field.key]
          : arr;

      const setArr = (next) => {
        slide.content[field.key] = next;
        markDirty?.();
        scheduleUiRefresh?.();
      };

      const makeInput = (label, value, { maxLength, multiline } = {}, onChange) => {
        const input = multiline
          ? h('textarea', { class: 'form-input form-textarea-sm', rows: '2' })
          : h('input', { class: 'form-input' });
        input.value = value ?? '';
        if (Number(maxLength) > 0) input.maxLength = Number(maxLength);
        input.addEventListener('input', () => onChange(input.value));
        return h('div', { class: 'stack is-field' }, [
          h('div', { class: 'field-label', text: label }),
          input,
        ]);
      };

      const list = h('div', { class: 'stack is-gap-lg items-reorder-list' });
      // Per-field override wins; otherwise lijstje stays single-column and
      // everything else defaults to the compact two-column grid.
      const cols = Number.isInteger(field?.itemColumns)
        ? Math.max(1, field.itemColumns)
        : slide.type === 'lijstje-slide' && field.key === 'items'
        ? 1
        : 2;
      const isKpiMetrics =
        slide.type === 'kpi-metrics-slide' && field.key === 'metrics';

      const btnAdd = h('button', {
        class: 'btn btn-secondary',
        text: t('editor.items.add', '+ Add item'),
      });

      // Drag state
      let draggingIndex = null;
      let dropTargetIndex = null;

      const clearDropIndicators = () => {
        for (const el of list.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
          el.classList.remove('is-drop-before', 'is-drop-after');
        }
        dropTargetIndex = null;
      };

      const setDropIndicator = (groupEl, pos, targetIdx) => {
        clearDropIndicators();
        dropTargetIndex = targetIdx;
        groupEl.classList.add(pos === 'before' ? 'is-drop-before' : 'is-drop-after');
      };

      const moveItem = (fromIdx, toIdx) => {
        if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
        const current = getCurrentArr();
        if (fromIdx >= current.length) return;
        const next = current.slice();
        const [moved] = next.splice(fromIdx, 1);
        // Adjust target index after removal
        const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
        next.splice(insertIdx, 0, moved);
        setArr(next);
        renderList();
      };

      const createDragHandle = () => {
        const handle = h('button', {
          class: 'item-drag-handle',
          type: 'button',
          title: t('editor.slideList.dragToReorder', 'Drag to reorder'),
          draggable: 'false',
        });
        // Grip icon (6 dots)
        handle.innerHTML = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5"/>
          <circle cx="9" cy="3" r="1.5"/>
          <circle cx="3" cy="8" r="1.5"/>
          <circle cx="9" cy="8" r="1.5"/>
          <circle cx="3" cy="13" r="1.5"/>
          <circle cx="9" cy="13" r="1.5"/>
        </svg>`;
        return handle;
      };

      const renderList = () => {
        const current = getCurrentArr();
        list.innerHTML = '';

        for (let i = 0; i < current.length; i += 1) {
          const item =
            current[i] && typeof current[i] === 'object' ? current[i] : {};
          const group = h('div', { class: 'stack card-group' });
          group.dataset.itemIndex = String(i);
          group.setAttribute('draggable', 'true');

          const header = h('div', {
            class: 'row spread card-group-header',
          });

          // Left side: drag handle + title
          const headerLeft = h('div', { class: 'row card-group-header-left' });
          headerLeft.append(createDragHandle());
          headerLeft.append(
            h('div', {
              class: 'card-group-title',
              text: t('editor.items.itemN', 'Item {n}', { n: i + 1 }),
            })
          );
          header.append(headerLeft);

          header.append(
            h('button', {
              class: 'btn btn-secondary btn-icon card-remove-btn',
              type: 'button',
              text: '×',
              title: t('editor.items.remove', 'Remove item'),
              'aria-label': t('editor.items.removeN', 'Remove item {n}', { n: i + 1 }),
              disabled: current.length <= minItems,
              onclick: () => {
                const now = getCurrentArr();
                if (now.length <= minItems) return;
                const next = now.slice();
                next.splice(i, 1);
                setArr(next);
                renderList();
              },
            })
          );
          group.append(header);

          // Drag events
          group.addEventListener('dragstart', (e) => {
            draggingIndex = i;
            group.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
          });

          group.addEventListener('dragend', () => {
            draggingIndex = null;
            group.classList.remove('is-dragging');
            clearDropIndicators();
          });

          group.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggingIndex === null || draggingIndex === i) {
              clearDropIndicators();
              return;
            }
            const rect = group.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const pos = e.clientY < midY ? 'before' : 'after';
            const targetIdx = pos === 'before' ? i : i + 1;
            setDropIndicator(group, pos, targetIdx);
          });

          group.addEventListener('dragleave', (e) => {
            if (e.currentTarget?.contains?.(e.relatedTarget)) return;
            if (group.classList.contains('is-drop-before') || group.classList.contains('is-drop-after')) {
              clearDropIndicators();
            }
          });

          group.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIdx = draggingIndex;
            const toIdx = dropTargetIndex;
            clearDropIndicators();
            draggingIndex = null;
            if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
              moveItem(fromIdx, toIdx);
            }
          });

          const setItemKey = (key, v) => {
            const now = getCurrentArr();
            const next = now.slice();
            const nextItem =
              next[i] && typeof next[i] === 'object' ? { ...next[i] } : {};
            nextItem[key] = v;
            next[i] = nextItem;
            slide.content[field.key] = next;
            markDirty?.();
            scheduleUiRefresh?.();
          };

          const fieldByItemKey = new Map(
            itemFields
              .filter((f) => f && (f.type === 'string' || f.type === 'image'))
              .map((f) => [String(f.key || ''), f])
          );

          const makeByKey = (key) => {
            const f = fieldByItemKey.get(key);
            if (!f) return null;
            if (f.type === 'image' && fieldImage) {
              // Use fieldImage with a proxy slide object that maps to this item
              const proxySlide = {
                type: slide.type,
                id: slide.id,
                content: new Proxy(item, {
                  get(target, prop) {
                    return target[prop];
                  },
                  set(target, prop, value) {
                    target[prop] = value;
                    return true;
                  },
                }),
              };
              const imageField = { ...f, key, hideHelp: true };
              return fieldImage(proxySlide, imageField, (url) => {
                setItemKey(key, url);
                renderList();
              });
            }
            return makeInput(
              t(f.labelKey || key, f.label || key),
              item?.[key] || '',
              { maxLength: f.maxLength, multiline: !!f.multiline },
              (v) => setItemKey(key, v)
            );
          };

          if (isKpiMetrics) {
            // KPI metrics UX: label on its own line; delta + note side-by-side.
            const row1 = fieldGrid([makeByKey('value'), makeByKey('unit')], 2);
            const row2 = fieldGrid([makeByKey('label')], 1);
            const row3 = fieldGrid([makeByKey('delta'), makeByKey('note')], 2);
            if (row1) group.append(row1);
            if (row2) group.append(row2);
            if (row3) group.append(row3);
          } else {
            const rowFields = [];
            for (const f of itemFields) {
              if (!f || (f.type !== 'string' && f.type !== 'image')) continue;
              const key = String(f.key || '');
              rowFields.push(makeByKey(key));
            }
            group.append(fieldGrid(rowFields, cols));
          }
          list.append(group);
        }

        btnAdd.disabled = current.length >= maxItems;
      };

      btnAdd.addEventListener('click', () => {
        const current = getCurrentArr();
        if (current.length >= maxItems) return;
        setArr([...current, structuredClone(itemDefaults)]);
        renderList();
      });

      wrap.append(list, btnAdd);
      renderList();

      return wrap;
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

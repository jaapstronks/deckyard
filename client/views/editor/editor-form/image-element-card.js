/**
 * Shared "This image" inspector card for a single selected image element.
 *
 * The editing-surface principle (docs/plans/briefs/editing-surfaces.md): the inspector
 * is the single home for everything settable on an element. A click on a canvas
 * image selects it and opens this card in the "This image" tab; the canvas keeps
 * only direct manipulation (the draggable focal point) and the empty-slot add.
 *
 * The card is driven by the type's inline descriptor (media / focus / fit), so
 * it writes the SAME keys the canvas focal-point drag writes - one value, two
 * representations. It covers: replace / delete (via the shared fieldImage
 * picker), alt text, any extra per-item metadata (e.g. a LinkedIn URL), the fit
 * choice (where the type has one), and the 3x3 focus grid as the precise,
 * keyboard-reachable fallback to the canvas drag.
 *
 * image-text is the one image type NOT rendered here: it already has a
 * per-image manager (image-text-images.js) with add/remove/reorder that this
 * card would duplicate.
 */
import { renderFocusGridField } from './focus-picker.js';
import { getInlineDescriptor } from '../inline-edit/descriptors.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Resolve where the image element at `idx` reads/writes, from the type's inline
 * descriptor. Mirrors the canvas-side resolveMediaTarget / resolveFocusTarget /
 * resolveFitTarget so both surfaces stay in lock-step.
 *
 * @returns {null | {
 *   member: Object, imageField: string, altField: string,
 *   extraFields: Array<{key:string,type?:string,label?:string,i18nKey?:string}>,
 *   focus: null | {xKey:string, yKey:string, cropMode:'cover'|'contain'},
 *   fit: null | {key:string, hasDefault:boolean},
 * }}
 */
function resolveImageElement(slide, def, idx) {
  const descriptor = getInlineDescriptor(slide?.type, def);
  const media = descriptor?.media;
  if (!slide || !media || !Number.isInteger(idx)) return null;

  const sub = (s) => (media.list ? s : String(s).replace('{n}', String(idx)));

  let member;
  let imageField;
  let altField;
  let extraFields;
  if (media.list) {
    const arr = slide.content?.[media.list];
    if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return null;
    member = arr[idx];
    imageField = media.imageField;
    altField = media.altField;
    extraFields = Array.isArray(media.extraFields) ? media.extraFields : [];
  } else {
    member = slide.content;
    imageField = sub(media.imageField);
    altField = sub(media.altField);
    extraFields = (media.extraFields || []).map((f) => ({ ...f, key: sub(f.key) }));
  }
  if (!member || typeof member !== 'object') return null;

  let focus = null;
  if (descriptor.focus) {
    const cropMode =
      typeof descriptor.focus.cropMode === 'function'
        ? descriptor.focus.cropMode(slide, idx)
        : 'cover';
    focus = {
      xKey: sub(descriptor.focus.xField),
      yKey: sub(descriptor.focus.yField),
      cropMode: cropMode === 'contain' ? 'contain' : 'cover',
    };
  }

  let fit = null;
  if (descriptor.fit) {
    fit = {
      key: sub(descriptor.fit.field),
      hasDefault: typeof descriptor.fit.fallback === 'function',
    };
  }

  return { member, imageField, altField, extraFields, focus, fit };
}

/**
 * Render the "This image" card for the selected image element into `container`.
 *
 * @param {Object} opts
 * @param {Function} opts.h
 * @param {HTMLElement} opts.container - the element-tab panel to append into
 * @param {Object} opts.slide
 * @param {Object} opts.def - slide-type definition (for the descriptor fallback)
 * @param {number} opts.idx - selected element index (list index or 1-based {n})
 * @param {Object} opts.fieldRenderers - { fieldImage, fieldText, fieldEnum, fieldGrid }
 * @param {Function} opts.markDirty
 * @param {Function} opts.rerenderEditor
 * @param {Function} opts.rerenderPreview
 * @param {Function} opts.scheduleUiRefresh
 * @returns {boolean} whether anything was rendered
 */
export function renderImageElementCard({
  h,
  container,
  slide,
  def,
  idx,
  fieldRenderers = {},
  markDirty,
  rerenderEditor,
  rerenderPreview,
  scheduleUiRefresh,
} = {}) {
  const resolved = resolveImageElement(slide, def, idx);
  if (!resolved) return false;
  const { member, imageField, altField, extraFields, focus, fit } = resolved;
  const { fieldImage, fieldText, fieldEnum } = fieldRenderers;

  const hasImage = !!String(member[imageField] || '').trim();

  // Image picker (replace + delete + preview) via the proxy-slide pattern: the
  // shared fieldImage edits member[imageField] and seeds alt into altField.
  if (typeof fieldImage === 'function') {
    const proxySlide = { type: slide.type, id: slide.id, content: member };
    container.append(
      fieldImage(
        proxySlide,
        {
          key: imageField,
          altFieldKey: altField,
          label: t('editor.image.fieldLabel', 'Image'),
          type: 'image',
          hideHelp: true,
        },
        (url) => {
          member[imageField] = url;
          markDirty?.();
          rerenderEditor?.();
          rerenderPreview?.();
          scheduleUiRefresh?.();
        }
      )
    );
  }

  // Alt text (metadata you cannot point at → inspector). Only meaningful once
  // there is an image; on an empty element the picker is the only thing to do.
  if (hasImage && typeof fieldText === 'function') {
    container.append(
      fieldText(
        t('editor.imageText.altText', 'Alt text'),
        typeof member[altField] === 'string' ? member[altField] : '',
        (v) => {
          member[altField] = v;
          markDirty?.();
          scheduleUiRefresh?.();
        }
      )
    );
  }

  // Extra per-item metadata (e.g. a team member's LinkedIn URL).
  if (hasImage && typeof fieldText === 'function') {
    for (const f of extraFields) {
      container.append(
        fieldText(
          t(f.i18nKey, f.label || f.key),
          typeof member[f.key] === 'string' ? member[f.key] : '',
          (v) => {
            member[f.key] = v;
            markDirty?.();
            scheduleUiRefresh?.();
          }
        )
      );
    }
  }

  // Fit choice (discrete → inspector). Types whose fit has a type-level
  // default (descriptor fit.fallback) get the silent-default empty option: it
  // shows the derived default - looked up from the type's imageDefaults
  // config, never hard-coded here - and doubles as back-to-default by
  // emptying the field. Types with a plain per-image fit get just Fill / Fit.
  if (hasImage && fit && typeof fieldEnum === 'function') {
    const coverLabel = t('editor.imageText.fitCover', 'Fill (crop)');
    const containLabel = t('editor.imageText.fitContain', 'Fit (no crop)');
    const typeDefaultFit = def?.imageDefaults?.fit === 'contain' ? 'contain' : 'cover';
    const options = fit.hasDefault
      ? [
          {
            value: '',
            label: t('editor.imageText.fitDefaultType', 'Default · {fit}', {
              fit: typeDefaultFit === 'contain' ? containLabel : coverLabel,
            }),
            title: t(
              'editor.imageText.fitDefaultTypeTitle',
              'Follow the slide type default'
            ),
          },
          { value: 'cover', label: coverLabel },
          { value: 'contain', label: containLabel },
        ]
      : [
          { value: 'cover', label: coverLabel },
          { value: 'contain', label: containLabel },
        ];
    const current = typeof member[fit.key] === 'string' ? member[fit.key] : fit.hasDefault ? '' : 'cover';
    container.append(
      fieldEnum(
        { key: fit.key, label: t('editor.imageText.imageFit', 'Image fit'), options },
        current,
        (v) => {
          member[fit.key] = v;
          markDirty?.();
          // Rebuild the element tab so the cover-only focus grid appears /
          // disappears with the mode, and repaint the canvas frame + focal point.
          rerenderEditor?.();
          rerenderPreview?.();
        }
      )
    );
  }

  // Focus grid (the precise, keyboard-reachable fallback to the canvas drag;
  // both write the same focusX/Y). Only in cover mode, where the crop bites.
  if (hasImage && focus && focus.cropMode === 'cover') {
    container.append(
      renderFocusGridField({
        h,
        label: t('editor.imageText.imageFocus', 'Image focus (crop)'),
        helpText: t(
          'editor.image.focusGridHelp',
          'Drag the point on the image, or pick a position here.'
        ),
        focusX: member[focus.xKey],
        focusY: member[focus.yKey],
        onChange: ({ focusX, focusY }) => {
          member[focus.xKey] = focusX;
          member[focus.yKey] = focusY;
          markDirty?.();
          rerenderPreview?.();
          scheduleUiRefresh?.();
        },
      })
    );
  }

  return true;
}

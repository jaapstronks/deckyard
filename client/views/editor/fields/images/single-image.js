/**
 * Single image field renderer
 */
import { t } from '../../../../lib/ui-i18n.js';
import { createAltSetter } from './alt-utils.js';
import { createImagePickerButtons } from './picker-buttons.js';
import { applyAltFromPick, applyPickMeta } from '../../media/apply-pick.js';
import { h } from '../../../../lib/dom/index.js';
import { featureEnabled, getFeatures } from '../../../../lib/state/features.js';
import {
  DEFAULT_DECK_LANG,
  translationSourceFor,
} from '../../../../../shared/i18n-utils.js';

/**
 * Create a single image field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldImage(ctx) {
  const {
    BACKGROUNDS,
    openImagePicker,
    pres,
    normalizeLang,
    markDirty,
    scheduleUiRefresh,
    rerenderEditor,
  } = ctx;

  const normalizeUrl = (x) => {
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object' && typeof x.url === 'string')
      return x.url.trim();
    return '';
  };

  const normalizeUrlList = (arr) =>
    (Array.isArray(arr) ? arr : []).map(normalizeUrl).filter(Boolean);

  // Derive the alt field key from the image field key
  // e.g., 'col1Image' → 'col1Alt', 'image' → 'alt', 'bgImage' → 'bgAlt'
  const deriveAltKey = (imageKey) => {
    if (!imageKey || typeof imageKey !== 'string') return 'alt';
    // If key ends with 'Image', replace with 'Alt'
    if (imageKey.endsWith('Image')) return imageKey.slice(0, -5) + 'Alt';
    // Otherwise just append 'Alt' or use 'alt' for simple cases
    return imageKey === 'image' ? 'alt' : `${imageKey}Alt`;
  };

  return function fieldImage(slide, field, onUploadedUrl) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', {
        class: 'field-label',
        text: field?.label || t('editor.image.fieldLabel', 'Image'),
      }),
    );

    // Use explicit altFieldKey from field config, or derive from image key
    const altFieldKey = field?.altFieldKey || deriveAltKey(field?.key);

    const preview = h('div', { class: 'help' });
    const current = slide.content?.[field.key];
    const img = current
      ? h('img', { src: current, class: 'editor-img-preview' })
      : null;
    if (img) preview.append(img);
    wrap.append(preview);

    const row = h('div', { class: 'row is-wrap' });
    if (current) {
      row.append(
        h('button', {
          class: 'btn btn-danger',
          text: t('common.delete', 'Delete'),
          onclick: () => onUploadedUrl(''),
        }),
      );
    }

    // One set of picker options for both entry points: the seam decides the
    // source, the direct upload goes straight to the file dialog (B579).
    const pickerOpts = () => {
      const activeLang =
        normalizeLang?.(pres?.i18n?.active) || DEFAULT_DECK_LANG;
      // The version this one is translated from, so a picked alt text
      // seeds the source buffer too. `otherLang()` had no answer once the
      // deck left the NL/EN pair, and silently seeded nothing (B182).
      const sourceLang = translationSourceFor(pres, activeLang);
      const setAltForLang = createAltSetter({
        slide,
        pres,
        normalizeLang,
        activeLang,
        fieldKey: altFieldKey,
      });

      return {
        title: t('editor.image.libraryTitle', 'Library: choose an image'),
        docId: pres?.id || '',
        allowCaptionCredit: 'caption' in (slide?.content || {}),
        context: {
          presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
          slideId: slide?.id || '',
          slideType: slide?.type || '',
          slideTitle:
            slide?.content &&
            typeof slide.content === 'object' &&
            typeof slide.content.title === 'string'
              ? slide.content.title
              : '',
        },
        onPick: (picked) => {
          onUploadedUrl(picked?.url || '');
          slide.content =
            slide.content && typeof slide.content === 'object'
              ? slide.content
              : {};
          applyAltFromPick({
            picked,
            activeLang,
            sourceLang,
            setAltForLang,
          });
          applyPickMeta({
            picked,
            content: slide.content,
            providerIdKey: 'imagekitFileId',
            allowCaption: 'caption' in slide.content,
          });
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        },
      };
    };

    row.append(...createImagePickerButtons(openImagePicker, pickerOpts));
    wrap.append(row);

    // Preset images
    const presetUrls =
      field?.presetSource === 'backgrounds'
        ? normalizeUrlList(BACKGROUNDS)
        : [];
    if (presetUrls.length) {
      const presetsWrap = h('div', { class: 'stack' });
      presetsWrap.append(
        h('div', {
          class: 'help',
          text: t('editor.image.presets', 'Preset images'),
        }),
      );
      const grid = h('div', { class: 'row is-wrap is-start' });
      for (const url of presetUrls) {
        grid.append(
          h(
            'button',
            {
              class: 'btn btn-secondary editor-img-thumb-btn',
              onclick: () => onUploadedUrl(url),
            },
            [h('img', { src: url, class: 'editor-img-thumb' })],
          ),
        );
      }
      presetsWrap.append(grid);
      wrap.append(presetsWrap);
    }

    // Only show help text if not explicitly hidden. D295: the upload copy
    // exists where uploads do; the sandbox greys them out with one sentence
    // (D181); an installation without uploads names them nowhere.
    if (!field?.hideHelp) {
      if (featureEnabled('uploads')) {
        wrap.append(
          h('div', {
            class: 'help',
            text: t(
              'editor.image.help.withUploads',
              'Choose from the library (recommended) or upload your own image.',
            ),
          }),
          h('div', {
            class: 'help',
            text: t(
              'editor.image.help.storage',
              'Images are stored locally in /server/uploads and used via URL.',
            ),
          }),
        );
      } else if (getFeatures()?.sandboxMode) {
        wrap.append(
          h('div', {
            class: 'help',
            text: t(
              'editor.image.help.uploadsSandbox',
              'Uploads are off in the sandbox. Choose from the library, Unsplash or Giphy.',
            ),
          }),
        );
      }
    }

    return wrap;
  };
}

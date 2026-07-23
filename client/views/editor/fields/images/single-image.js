/**
 * Single image field renderer
 */
import { t } from '../../../../lib/ui-i18n.js';
import { createAltSetter } from './alt-utils.js';
import { applyAltFromPick, applyPickMeta } from '../../media/apply-pick.js';

/**
 * Create a single image field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldImage(ctx) {
  const {
    h,
    BACKGROUNDS,
    openImagePicker,
    features,
    pres,
    normalizeLang,
    otherLang,
    markDirty,
    scheduleUiRefresh,
    rerenderEditor,
  } = ctx;

  const flags = features && typeof features === 'object' ? features : {};
  const uploadsDisabled = !!flags.disableUploads;
  const hasPicker =
    typeof openImagePicker === 'function' && (openImagePicker.providers?.length || 0) > 0;

  const normalizeUrl = (x) => {
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object' && typeof x.url === 'string') return x.url.trim();
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
      })
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
        })
      );
    }

    // Image picker button (one seam over all configured providers)
    if (hasPicker) {
      row.append(
        h('button', {
          class: 'btn btn-secondary',
          text: t('editor.image.chooseOrUpload', 'Choose / upload…'),
          onclick: () => {
            const activeLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
            const other = typeof otherLang === 'function' ? otherLang(activeLang) : null;
            const setAltForLang = createAltSetter({
              slide,
              pres,
              normalizeLang,
              activeLang,
              fieldKey: altFieldKey,
            });

            openImagePicker({
              title: t('editor.image.libraryTitle', 'Images'),
              docId: pres?.id || '',
              allowCaptionCredit: 'caption' in (slide?.content || {}),
              context: {
                presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
                slideId: slide?.id || '',
                slideType: slide?.type || '',
                slideTitle:
                  slide?.content && typeof slide.content === 'object' && typeof slide.content.title === 'string'
                    ? slide.content.title
                    : '',
              },
              onPick: (picked) => {
                onUploadedUrl(picked?.url || '');
                slide.content =
                  slide.content && typeof slide.content === 'object' ? slide.content : {};
                applyAltFromPick({ picked, activeLang, otherLang: other, setAltForLang });
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
            });
          },
        })
      );
    }
    wrap.append(row);

    // Preset images
    const presetUrls = field?.presetSource === 'backgrounds' ? normalizeUrlList(BACKGROUNDS) : [];
    if (presetUrls.length) {
      const presetsWrap = h('div', { class: 'stack' });
      presetsWrap.append(
        h('div', { class: 'help', text: t('editor.image.presets', 'Preset images') })
      );
      const grid = h('div', { class: 'row is-wrap is-start' });
      for (const url of presetUrls) {
        grid.append(
          h('button', { class: 'btn btn-secondary editor-img-thumb-btn', onclick: () => onUploadedUrl(url) }, [
            h('img', { src: url, class: 'editor-img-thumb' }),
          ])
        );
      }
      presetsWrap.append(grid);
      wrap.append(presetsWrap);
    }

    // Only show help text if not explicitly hidden
    if (!field?.hideHelp) {
      wrap.append(
        h('div', {
          class: 'help',
          text: uploadsDisabled
            ? flags.sandboxMode
              ? t('editor.image.help.uploadsSandbox', 'Uploads are off in the sandbox. Choose from the library, Unsplash or Giphy.')
              : t('editor.image.help.uploadsDisabled', 'Choose from the library (recommended). Uploads are disabled.')
            : t('editor.image.help.withUploads', 'Choose from the library (recommended) or upload a new image.'),
        }),
        uploadsDisabled
          ? null
          : h('div', {
              class: 'help',
              text: t(
                'editor.image.help.storage',
                'Local uploads are stored in /server/uploads. ImageKit assets stay hosted on ImageKit and are used via URL.'
              ),
            })
      );
    }

    return wrap;
  };
}
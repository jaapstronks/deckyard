/**
 * Title slide background image field renderer
 */
import { t } from '../../../../lib/ui-i18n.js';
import { getBackgroundPresets } from '../../../../lib/theme.js';
import { createAltSetter } from './alt-utils.js';
import { applyAltFromPick, applyPickMeta } from '../../media/apply-pick.js';

/**
 * Create a title background image field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldTitleBgImage(ctx) {
  const {
    h,
    openImagePicker,
    features,
    theme,
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

  return function fieldTitleBgImage(slide, field, onUploadedUrl) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', { class: 'field-label', text: field?.label || 'Background image' })
    );

    const current = slide.content?.[field.key];
    const controls = h('div', { class: 'row is-wrap' });

    if (current) {
      controls.append(
        h('button', {
          class: 'btn btn-danger',
          text: t('common.delete', 'Delete'),
          onclick: () => onUploadedUrl(''),
        })
      );
    }

    // Image picker button (one seam over all configured providers)
    if (hasPicker) {
      controls.append(
        h('button', {
          class: 'btn btn-secondary',
          text: t('editor.image.chooseOrUpload', 'Choose / upload…'),
          onclick: () => {
            const activeLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
            const other = typeof otherLang === 'function' ? otherLang(activeLang) : null;
            const setBgAltForLang = createAltSetter({
              slide,
              pres,
              normalizeLang,
              activeLang,
              fieldKey: 'bgAlt',
            });

            openImagePicker({
              title: t('editor.image.bgLibraryTitle', 'Background images'),
              docId: pres?.id || '',
              allowCaptionCredit: false,
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
                const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
                if (!url) return;
                onUploadedUrl(url);
                slide.content =
                  slide.content && typeof slide.content === 'object' ? slide.content : {};
                applyAltFromPick({
                  picked,
                  activeLang,
                  otherLang: other,
                  setAltForLang: setBgAltForLang,
                });
                applyPickMeta({ picked, content: slide.content, providerIdKey: 'bgImagekitFileId' });
                markDirty?.();
                rerenderEditor?.();
                scheduleUiRefresh?.();
              },
            });
          },
        })
      );
    }

    wrap.append(controls);
    wrap.append(
      h('div', {
        class: 'help',
        text: uploadsDisabled
          ? t('editor.image.bgHelp.uploadsDisabled', 'Choose an existing image from the library. Uploads are disabled.')
          : t('editor.image.bgHelp.withUploads', 'Choose an existing image from the library, or upload a new one.'),
      })
    );

    // Small preview
    if (current) {
      wrap.append(h('img', { src: current, alt: '', class: 'editor-img-preview' }));
    }

    // Preset backgrounds declared by the deck's theme. Labelled as such so it's
    // clear these are the theme's own imagery, not a generic asset dump.
    const presetUrls = getBackgroundPresets(theme);
    if (presetUrls.length) {
      const presetsWrap = h('div', { class: 'stack card-group' });
      presetsWrap.append(
        h('div', {
          class: 'card-group-title',
          text: t('editor.image.themeBackgrounds', 'From this theme'),
        })
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

    return wrap;
  };
}
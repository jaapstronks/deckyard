/**
 * Background image field renderer: the picker for an image field with
 * `presetSource: 'backgrounds'` (the shared `slideBgImage`). A full-slide
 * background is decorative, so a pick stores the URL only - no alt text and
 * no provider id (the legacy `bgAlt`/`bgImagekitFileId` it once wrote are
 * folded away by the read funnel, schema v21 -> v22).
 */
import { t } from '../../../../lib/ui-i18n.js';
import { getBackgroundPresets } from '../../../../lib/theme/theme.js';
import { createImagePickerButtons } from './picker-buttons.js';
import { h } from '../../../../lib/dom/index.js';
import { featureEnabled, getFeatures } from '../../../../lib/state/features.js';

/**
 * Create a background image field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldTitleBgImage(ctx) {
  const { openImagePicker, theme, pres } = ctx;

  return function fieldTitleBgImage(slide, field, onUploadedUrl) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', {
        class: 'field-label',
        text: field?.label || 'Background image',
      }),
    );

    const current = slide.content?.[field.key];
    const controls = h('div', { class: 'row is-wrap' });

    if (current) {
      controls.append(
        h('button', {
          class: 'btn btn-danger',
          text: t('common.delete', 'Delete'),
          onclick: () => onUploadedUrl(''),
        }),
      );
    }

    // Built per click, so the context is current (B579: shared by
    // "Choose image…" and "Upload from computer").
    const pickerOpts = () => {
      return {
        title: t(
          'editor.image.bgLibraryTitle',
          'Library: choose a background image',
        ),
        hint: t('editor.image.bgHint', 'For the background of this slide'),
        docId: pres?.id || '',
        allowCaptionCredit: false,
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
          const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
          if (!url) return;
          onUploadedUrl(url);
        },
      };
    };
    controls.append(
      ...createImagePickerButtons(openImagePicker, pickerOpts, {
        replace: !!current,
      }),
    );

    wrap.append(controls);
    // D295: the upload copy exists where uploads do; the sandbox greys them
    // out with one sentence (D181); an installation without uploads names
    // them nowhere.
    const help = featureEnabled('uploads')
      ? t(
          'editor.image.bgHelp.withUploads',
          'Choose an existing image from the library, or upload your own image for this slide only.',
        )
      : getFeatures()?.sandboxMode
        ? t(
            'editor.image.bgHelp.uploadsSandbox',
            'Uploads are off in the sandbox. Choose from the library, Unsplash or Giphy.',
          )
        : '';
    if (help) wrap.append(h('div', { class: 'help', text: help }));

    // Small preview
    if (current) {
      wrap.append(
        h('img', {
          src: current,
          alt: '',
          class: 'editor-img-preview',
          loading: 'lazy',
        }),
      );
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
            [
              // Lazy + async: in the inspector this strip lives inside a
              // collapsed section, so the thumbnails must not cost a request
              // until the author actually opens it (declutter 2026-07-26).
              h('img', {
                src: url,
                class: 'editor-img-thumb',
                loading: 'lazy',
                decoding: 'async',
              }),
            ],
          ),
        );
      }
      presetsWrap.append(grid);
      wrap.append(presetsWrap);
    }

    return wrap;
  };
}

/**
 * The `images` field renderer — a flat collection of image URLs.
 *
 * No core slide type declares `images` any more (logo-wall moved to `items` in
 * the v7 -> v8 sweep, #938). It stays because `images` is a declared field type
 * in `shared/slide-types/field-types.js` and one of the six the custom-slide-type
 * editor offers, so a DB-backed or file-based custom type can declare it today.
 * That makes this the renderer for *custom* collections, and it is written for
 * that: the partner-logo preset list is one optional preset source, not the
 * subject.
 *
 * The value is a `stringArray` — URLs and nothing else — so there is nowhere on
 * this field to record alt text. The picker therefore does not auto-fill it
 * here; a type that wants per-image alt declares `items` with an `alt`
 * sub-field, which is what logo-wall and gallery now do.
 */
import { t } from '../../../../lib/ui-i18n.js';
import { toast } from '../../../../lib/dom/toast.js';
import { h } from '../../../../lib/dom.js';

/**
 * Create a multiple images field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldImages(ctx) {
  const {
    api,
    openImagePicker,
    readFileAsDataUrl,
    features,
    pres,
    markDirty,
    scheduleUiRefresh,
    rerenderEditor,
  } = ctx;

  const flags = features && typeof features === 'object' ? features : {};
  const uploadsDisabled = !flags.enableUploads;
  const hasPicker =
    typeof openImagePicker === 'function' &&
    (openImagePicker.providers?.length || 0) > 0;

  const normalizeUrl = (x) => {
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object' && typeof x.url === 'string')
      return x.url.trim();
    return '';
  };

  const normalizeUrlList = (arr) =>
    (Array.isArray(arr) ? arr : []).map(normalizeUrl).filter(Boolean);

  return function fieldImages(slide, field, presetUrls, onChange) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', {
        class: 'field-label',
        text: field?.label || t('editor.images.fieldLabel', 'Images'),
      }),
    );

    const maxItems = Number(field?.maxItems || 0) || null;
    const current = Array.isArray(slide.content?.[field.key])
      ? slide.content[field.key]
      : [];
    const set = new Set(current);
    const normalizedPresets = normalizeUrlList(presetUrls);
    const presetSet = new Set(normalizedPresets);

    // Presets — only when a preset source actually supplied some.
    // `presetSource: 'partnerlogos'` is the one source there is; without it the
    // list is empty and a bare "Preset logos" heading is pure chrome. Same
    // guard shape as `single-image.js`'s backgrounds block.
    if (normalizedPresets.length) {
      const presets = h('div', { class: 'stack is-field' });
      presets.append(
        h('div', {
          class: 'help',
          text: t('editor.images.presets.logos', 'Preset logos'),
        }),
      );
      for (const url of normalizedPresets) {
        const row = h('label', { class: 'row' });
        const cb = h('input', { type: 'checkbox' });
        cb.checked = set.has(url);
        cb.addEventListener('change', () => {
          const next = new Set(
            Array.isArray(slide.content?.[field.key])
              ? slide.content[field.key]
              : [],
          );
          if (cb.checked) next.add(url);
          else next.delete(url);
          let arr = Array.from(next);
          if (maxItems) arr = arr.slice(0, maxItems);
          onChange(arr);
        });
        const thumb = h('img', { src: url, class: 'editor-logo-thumb-sm' });
        const name = url.split('/').pop() || url;
        row.append(cb, thumb, h('div', { class: 'help', text: name }));
        presets.append(row);
      }
      wrap.append(presets);
    }

    // Current selection preview + remove
    const selected = h('div', { class: 'stack is-field' });
    selected.append(
      h('div', {
        class: 'help',
        text: t('editor.images.selected', 'Selected images'),
      }),
    );
    if (!current.length) {
      selected.append(
        h('div', {
          class: 'help',
          text: t('editor.images.noneSelected', 'None selected'),
        }),
      );
    } else {
      for (const url of current) {
        const isPreset = presetSet.has(url);
        const row = h('div', { class: 'row' });
        row.append(
          h('img', { src: url, class: 'editor-logo-thumb-md' }),
          h('div', { class: 'help', text: url }),
        );
        if (isPreset) {
          row.append(
            h('div', {
              class: 'help',
              text: t(
                'editor.images.presetHint',
                'Preset (uncheck above to remove)',
              ),
            }),
          );
        } else {
          row.append(
            h('button', {
              class: 'btn btn-danger',
              text: t('common.delete', 'Delete'),
              onclick: () => onChange(current.filter((u) => u !== url)),
            }),
          );
        }
        selected.append(row);
      }
    }
    wrap.append(selected);

    // Add from the image picker (one seam over all configured providers)
    if (hasPicker) {
      const addFromPicker = h('div', { class: 'stack is-field' });
      addFromPicker.append(
        h('div', {
          class: 'help',
          text: t(
            'editor.images.addFromLibrary.help',
            'Add from the shared library',
          ),
        }),
        h('button', {
          class: 'btn btn-secondary',
          text: t('editor.images.addFromLibrary', 'Add from library…'),
          onclick: () => {
            openImagePicker({
              title: t('editor.images.libraryTitle', 'Images'),
              docId: pres?.id || '',
              allowCaptionCredit: false,
              context: {
                presentationTitle:
                  typeof pres?.title === 'string' ? pres.title : '',
                slideId: slide?.id || '',
                slideType: slide?.type || '',
              },
              onPick: (picked) => {
                const url =
                  typeof picked?.url === 'string' ? picked.url.trim() : '';
                if (!url) return;
                const next = Array.isArray(slide.content?.[field.key])
                  ? slide.content[field.key].slice()
                  : [];
                const wasPresent = next.includes(url);
                next.push(url);
                const deduped = Array.from(
                  new Set(
                    next.filter((u) => typeof u === 'string' && u.trim()),
                  ),
                );
                onChange(maxItems ? deduped.slice(0, maxItems) : deduped);

                // Redraw so the new URL shows up in the selection list, which
                // this renderer builds once per render.
                if (!wasPresent) {
                  markDirty?.();
                  rerenderEditor?.();
                  scheduleUiRefresh?.();
                }
              },
            });
          },
        }),
      );
      wrap.append(addFromPicker);
    }

    // Upload an image of your own
    const up = h('div', { class: 'stack is-field' });
    up.append(
      h('div', {
        class: 'help',
        text: uploadsDisabled
          ? flags.sandboxMode
            ? t(
                'editor.images.uploadsSandbox',
                'Uploads are off in the sandbox; use the library, Unsplash or Giphy.',
              )
            : t(
                'editor.images.uploadsDisabled',
                'Uploads are disabled; use the library.',
              )
          : t('editor.images.uploadCustom', 'Upload an image'),
      }),
    );
    if (!uploadsDisabled && api && typeof readFileAsDataUrl === 'function') {
      const input = h('input', {
        type: 'file',
        accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/avif',
        onchange: async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const dataUrl = await readFileAsDataUrl(file);
            const uploaded = await api('/api/images/upload', {
              method: 'POST',
              body: JSON.stringify({ dataUrl, filename: file.name }),
            });
            const url =
              typeof uploaded?.url === 'string' ? uploaded.url.trim() : '';
            if (!url) throw new Error('Upload failed');
            const next = Array.isArray(slide.content?.[field.key])
              ? slide.content[field.key].slice()
              : [];
            next.push(url);
            const deduped = Array.from(
              new Set(next.filter((u) => typeof u === 'string' && u.trim())),
            );
            onChange(maxItems ? deduped.slice(0, maxItems) : deduped);
            // The selection list is built once per render, so an upload only
            // becomes visible after the form is redrawn (the picker path above
            // does the same).
            rerenderEditor?.();
          } catch (e) {
            toast.error(e);
          } finally {
            input.value = '';
          }
        },
      });
      up.append(input);
    }
    wrap.append(up);

    return wrap;
  };
}

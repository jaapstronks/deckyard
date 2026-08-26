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
  const { api, openImagePicker, readFileAsDataUrl, features, pres } = ctx;

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

  /** The list with `url` appended, blanks dropped and duplicates collapsed. */
  const withUrl = (list, url) =>
    Array.from(
      new Set([...list, url].filter((u) => typeof u === 'string' && u.trim())),
    );

  return function fieldImages(slide, field, presetUrls, onChange) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', {
        class: 'field-label',
        text: field?.label || t('editor.images.fieldLabel', 'Images'),
      }),
    );

    const maxItems = Number(field?.maxItems || 0) || null;
    const readValue = () =>
      Array.isArray(slide.content?.[field.key]) ? slide.content[field.key] : [];
    const normalizedPresets = normalizeUrlList(presetUrls);
    const presetSet = new Set(normalizedPresets);

    // Every checkbox by the URL it stands for, so `renderSelected()` can set
    // them from the stored value instead of trusting the click that got here.
    /** @type {Map<string, HTMLInputElement>} */
    const presetBoxes = new Map();

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
        cb.checked = readValue().includes(url);
        cb.addEventListener('change', () => {
          const next = new Set(readValue());
          if (cb.checked) next.add(url);
          else next.delete(url);
          commit(Array.from(next));
        });
        presetBoxes.set(url, cb);
        const thumb = h('img', { src: url, class: 'editor-logo-thumb-sm' });
        const name = url.split('/').pop() || url;
        row.append(cb, thumb, h('div', { class: 'help', text: name }));
        presets.append(row);
      }
      wrap.append(presets);
    }

    // Current selection preview + remove. The rows live in a container of
    // their own so a value change refills *that* and leaves the checkboxes
    // above standing — redrawing the whole field would move focus off the
    // checkbox a keyboard user just toggled (D65).
    const selected = h('div', { class: 'stack is-field' });
    const selectedRows = h('div', { class: 'stack' });
    selected.append(
      h('div', {
        class: 'help',
        text: t('editor.images.selected', 'Selected images'),
      }),
      selectedRows,
    );
    wrap.append(selected);

    /**
     * One row in the selection list: the image, its URL, and the way to drop
     * it — a preset says "uncheck above", anything else gets a Delete button.
     * @param {string} url
     * @returns {HTMLElement}
     */
    function selectedRow(url) {
      const row = h('div', { class: 'row' });
      row.append(
        h('img', { src: url, class: 'editor-logo-thumb-md' }),
        h('div', { class: 'help', text: url }),
      );
      row.append(
        presetSet.has(url)
          ? h('div', {
              class: 'help',
              text: t(
                'editor.images.presetHint',
                'Preset (uncheck above to remove)',
              ),
            })
          : h('button', {
              class: 'btn btn-danger',
              text: t('common.delete', 'Delete'),
              onclick: () => commit(readValue().filter((u) => u !== url)),
            }),
      );
      return row;
    }

    /**
     * Refill the selection list, then bring the checkboxes back in step with
     * it the way `collection-editor.js` updates its count pill: imperatively,
     * at the tail, without rebuilding the control. Reading the *stored* value
     * rather than the intended one is what keeps a `maxItems` clip honest — a
     * checkbox whose URL did not make the cut unchecks itself again.
     */
    function renderSelected() {
      const urls = readValue();
      selectedRows.innerHTML = '';
      if (!urls.length) {
        selectedRows.append(
          h('div', {
            class: 'help',
            text: t('editor.images.noneSelected', 'None selected'),
          }),
        );
      } else {
        for (const url of urls) selectedRows.append(selectedRow(url));
      }
      for (const [url, cb] of presetBoxes) cb.checked = urls.includes(url);
    }

    /**
     * The one way this field writes: clip to `maxItems`, hand the array up
     * (`onChange` marks dirty and schedules the preview refresh), then redraw
     * from what was actually stored.
     * @param {string[]} arr
     */
    function commit(arr) {
      onChange(maxItems ? arr.slice(0, maxItems) : arr);
      renderSelected();
    }

    renderSelected();

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
                commit(withUrl(readValue(), url));
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
            commit(withUrl(readValue(), url));
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

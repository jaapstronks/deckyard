/**
 * Multiple images field renderer (for logos, etc.)
 */
import { t } from '../../../../lib/ui-i18n.js';
import { toast } from '../../../../lib/toast.js';
import { createIndexedAltSetter } from './alt-utils.js';
import { applyAltFromPick } from '../../media/apply-pick.js';

/**
 * Create a multiple images field renderer
 * @param {Object} ctx - Context with dependencies
 * @returns {Function} Field renderer function
 */
export function createFieldImages(ctx) {
  const {
    h,
    api,
    openImagePicker,
    readFileAsDataUrl,
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

  return function fieldImages(slide, field, presetUrls, onChange) {
    const wrap = h('div', { class: 'stack is-field' });
    wrap.append(
      h('div', { class: 'field-label', text: field?.label || t('editor.images.fieldLabel', 'Images') })
    );

    const maxItems = Number(field?.maxItems || 0) || null;
    const current = Array.isArray(slide.content?.[field.key]) ? slide.content[field.key] : [];
    const set = new Set(current);
    const normalizedPresets = normalizeUrlList(presetUrls);
    const presetSet = new Set(normalizedPresets);

    // Presets section
    const presets = h('div', { class: 'stack is-field' });
    presets.append(h('div', { class: 'help', text: t('editor.images.presets.logos', 'Preset logos') }));
    for (const url of normalizedPresets) {
      const row = h('label', { class: 'row' });
      const cb = h('input', { type: 'checkbox' });
      cb.checked = set.has(url);
      cb.addEventListener('change', () => {
        const next = new Set(Array.isArray(slide.content?.[field.key]) ? slide.content[field.key] : []);
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

    // Current selection preview + remove
    const selected = h('div', { class: 'stack is-field' });
    selected.append(h('div', { class: 'help', text: t('editor.images.selectedLogos', 'Selected logos') }));
    if (!current.length) {
      selected.append(h('div', { class: 'help', text: t('editor.images.noneSelected', 'None selected') }));
    } else {
      for (const url of current) {
        const isPreset = presetSet.has(url);
        const row = h('div', { class: 'row' });
        row.append(
          h('img', { src: url, class: 'editor-logo-thumb-md' }),
          h('div', { class: 'help', text: url })
        );
        if (isPreset) {
          row.append(h('div', { class: 'help', text: t('editor.images.presetHint', 'Preset (uncheck above to remove)') }));
        } else {
          row.append(
            h('button', {
              class: 'btn btn-danger',
              text: t('common.delete', 'Delete'),
              onclick: () => onChange(current.filter((u) => u !== url)),
            })
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
        h('div', { class: 'help', text: t('editor.images.addFromLibrary.help', 'Add from the shared library') }),
        h('button', {
          class: 'btn btn-secondary',
          text: t('editor.images.addFromLibrary', 'Add from library…'),
          onclick: () => {
            const activeLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
            const other = typeof otherLang === 'function' ? otherLang(activeLang) : null;
            const setAltForLogoIndex = createIndexedAltSetter({
              slide,
              pres,
              normalizeLang,
              activeLang,
              fieldPrefix: 'logo',
            });

            openImagePicker({
              title: t('editor.images.libraryTitle', 'Images'),
              docId: pres?.id || '',
              allowCaptionCredit: false,
              context: {
                presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
                slideId: slide?.id || '',
                slideType: slide?.type || '',
              },
              onPick: (picked) => {
                const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
                if (!url) return;
                const next = Array.isArray(slide.content?.[field.key]) ? slide.content[field.key].slice() : [];
                const wasPresent = next.includes(url);
                next.push(url);
                const deduped = Array.from(new Set(next.filter((u) => typeof u === 'string' && u.trim())));
                onChange(maxItems ? deduped.slice(0, maxItems) : deduped);

                // Auto-fill alt for newly added logo
                if (!wasPresent) {
                  const idx = deduped.indexOf(url);
                  applyAltFromPick({
                    picked,
                    activeLang,
                    otherLang: other,
                    setAltForLang: (lang, alt) => setAltForLogoIndex(lang, idx, alt),
                  });
                  markDirty?.();
                  rerenderEditor?.();
                  scheduleUiRefresh?.();
                }
              },
            });
          },
        })
      );
      wrap.append(addFromPicker);
    }

    // Upload custom logos
    const up = h('div', { class: 'stack is-field' });
    up.append(
      h('div', {
        class: 'help',
        text: uploadsDisabled
          ? t('editor.images.uploadsDisabled', 'Uploads are disabled; use the library.')
          : t('editor.images.uploadCustom', 'Upload custom logo'),
      })
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
            const url = typeof uploaded?.url === 'string' ? uploaded.url.trim() : '';
            if (!url) throw new Error('Upload failed');
            const next = Array.isArray(slide.content?.[field.key]) ? slide.content[field.key].slice() : [];
            next.push(url);
            const deduped = Array.from(new Set(next.filter((u) => typeof u === 'string' && u.trim())));
            onChange(maxItems ? deduped.slice(0, maxItems) : deduped);
          } catch (e) {
            toast.error(String(e?.message || e));
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
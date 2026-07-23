/**
 * Theme editor: background presets.
 *
 * `theme.backgroundPresets` is the only mechanism for a theme's own background
 * imagery — a title slide created by deck import or by converting a chapter
 * title draws from it, and the per-slide picker groups it first as "From this
 * theme". A theme that declares none gets no automatic background at all, by
 * design.
 *
 * Until now a database theme could only get presets through the API, so a
 * designer working in the browser could upload a logo but never a background.
 * See docs/developer/themes.md.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { uploadImage } from './upload-image.js';

const MAX_PRESETS = 24;

/**
 * Build the background-presets section.
 *
 * @param {Object} opts
 * @param {Object} opts.config - the draft config (mutated in place)
 * @param {Function} opts.onChange - called after any change, to refresh the preview
 * @returns {{ el: HTMLElement }}
 */
export function createBackgroundsSection({ config, onChange }) {
  const el = h('div', { class: 'editor-card stack' });
  el.append(
    h('div', {
      class: 'field-label',
      text: t('settings.themes.config.backgrounds', 'Background images'),
    }),
    h('p', {
      class: 'help',
      text: t(
        'settings.themes.config.backgroundsHint',
        'Your own imagery for title slides. New title slides pick one of these, and the per-slide picker offers them first. Without any, title slides stay flat rather than borrowing imagery that is not yours.'
      ),
    })
  );

  const grid = h('div', { class: 'row is-wrap is-gap-2 theme-bg-presets' });
  const status = h('p', { class: 'help', text: '' });

  /** Current list, always an array so callers never have to guard it. */
  const presets = () =>
    Array.isArray(config.backgroundPresets) ? config.backgroundPresets : [];

  function write(next) {
    if (next.length) config.backgroundPresets = next;
    // Absent rather than an empty array: the schema treats "not configured" and
    // "configured to nothing" the same here, and an empty key is noise.
    else delete config.backgroundPresets;
    render();
    onChange();
  }

  function render() {
    grid.innerHTML = '';
    for (const [index, url] of presets().entries()) {
      const tile = h('div', { class: 'theme-bg-preset' });
      tile.append(
        h('img', {
          src: url,
          alt: '',
          class: 'theme-bg-preset-img',
          // A preset whose file went away should still be removable, so mark
          // the tile rather than dropping it.
          onerror: () => tile.classList.add('is-broken'),
        }),
        h('button', {
          type: 'button',
          class: 'btn btn-danger btn-xs theme-bg-preset-remove',
          text: '×',
          'aria-label': t('settings.themes.config.removeBackground', 'Remove'),
          title: t('settings.themes.config.removeBackground', 'Remove'),
          onclick: () => write(presets().filter((_, i) => i !== index)),
        })
      );
      grid.append(tile);
    }
    if (!presets().length) {
      grid.append(
        h('p', {
          class: 'help',
          text: t('settings.themes.config.noBackgrounds', 'No background images yet.'),
        })
      );
    }
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    class: 'is-hidden',
    onchange: async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (!files.length) return;

      const room = MAX_PRESETS - presets().length;
      if (room <= 0) {
        toast.error(
          t('settings.themes.config.backgroundsFull', 'That is as many background images as a theme can hold.')
        );
        return;
      }

      const accepted = files.slice(0, room);
      if (accepted.length < files.length) {
        // Never drop input silently — say what did not fit.
        toast.error(
          t(
            'settings.themes.config.backgroundsSomeSkipped',
            'Only {count} more images fit; the rest were skipped.',
            { count: String(room) }
          )
        );
      }

      status.textContent = t('settings.themes.config.uploading', 'Uploading…');
      const added = [];
      for (const file of accepted) {
        try {
          const { url } = await uploadImage(file);
          if (url) added.push(url);
        } catch (err) {
          // Report and keep going: one bad file should not lose the others.
          toast.error(String(err?.message || err));
        }
      }
      status.textContent = '';
      if (added.length) write([...presets(), ...added]);
    },
  });

  const addBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('settings.themes.config.addBackground', 'Add images…'),
    onclick: () => fileInput.click(),
  });

  render();
  el.append(grid, h('div', { class: 'row is-gap-2' }, [addBtn, fileInput]), status);

  return { el };
}

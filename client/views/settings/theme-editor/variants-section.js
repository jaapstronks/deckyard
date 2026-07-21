/**
 * Theme editor: named slide background variants.
 *
 * A theme can offer background options beyond the built-in lime/mist. Each
 * variant becomes a `--t-slide-bg-<id>` token plus a generated
 * `.slide.slide-bg-<id>` rule, and appears in the per-slide Background picker
 * on every slide type that has one — no per-type code.
 *
 * Two things shape this editor:
 *
 * - `normalizeSlideBackgrounds` **silently drops** entries with an unsafe or
 *   reserved id. Silent in a renderer is fine; silent in a form is not — you
 *   would name a variant, save, and watch it vanish. So everything it would
 *   drop is rejected here, with a reason.
 * - The id becomes a CSS class *and* is what a slide stores
 *   (`content.background = 'calm'`). Renaming it would orphan every slide using
 *   it, so it is derived from the name once and then fixed.
 *
 * See docs/reference/theme-slide-backgrounds.md.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { createColorPicker } from './color-picker.js';
import {
  SLIDE_BG_ID_RE,
  RESERVED_SLIDE_BG_IDS,
} from '../../../../shared/theme-slide-backgrounds.js';
import { pickTextColorForBg } from '../../../../shared/theme-normalize.js';

const MAX_VARIANTS = 12;

/** Derive a css-class-safe id from a human name. */
export function slugifyVariantId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/**
 * Why this id cannot be used, or '' when it can.
 * @returns {string} an already-translated reason
 */
export function variantIdProblem(id, existingIds) {
  if (!id) {
    return t('settings.themes.config.variantNeedsName', 'Give the variant a name.');
  }
  if (!SLIDE_BG_ID_RE.test(id)) {
    return t(
      'settings.themes.config.variantBadName',
      'A name needs at least one letter or digit.'
    );
  }
  if (RESERVED_SLIDE_BG_IDS.has(id)) {
    return t(
      'settings.themes.config.variantReserved',
      'That name is taken by a built-in background.'
    );
  }
  if (existingIds.includes(id)) {
    return t('settings.themes.config.variantDuplicate', 'You already have a variant with that name.');
  }
  return '';
}

/**
 * Build the background-variants section.
 *
 * @param {Object} opts
 * @param {Object} opts.config - the draft config (mutated in place)
 * @param {Object} opts.colors - the draft's four colours, for contrast poles
 * @param {Function} opts.onChange - called after any change, to refresh the preview
 * @returns {{ el: HTMLElement }}
 */
export function createVariantsSection({ config, colors, onChange }) {
  const el = h('div', { class: 'editor-card stack' });
  el.append(
    h('div', {
      class: 'field-label',
      text: t('settings.themes.config.variants', 'Background options'),
    }),
    h('p', {
      class: 'help',
      text: t(
        'settings.themes.config.variantsHint',
        'Extra background choices on top of the built-in ones. Each appears in the Background picker on every slide, and its text colour follows automatically so a dark option stays readable.'
      ),
    })
  );

  // The two built-in slots come first: they are the options every deck already
  // has, and they are the ones showing as "Color 1"/"Color 2" until named.
  const builtins = h('div', { class: 'stack theme-variant-builtins' });
  builtins.append(
    h('p', {
      class: 'help',
      text: t(
        'settings.themes.config.builtinsHint',
        'Every theme has two built-in backgrounds. They are storage slots, not colours — name them for what yours actually are, or they show as "Color 1" and "Color 2".'
      ),
    })
  );

  // No swatch here on purpose: lime and mist are *derived* (mist from the
  // primary), so anything drawn from the four source colours would be a guess.
  // The live preview two columns over shows what they actually look like.
  for (const slot of ['lime', 'mist']) {
    builtins.append(
      h('div', { class: 'row is-gap-2 is-items-center theme-builtin-row' }, [
        h('input', {
          class: 'input form-input',
          type: 'text',
          maxlength: '40',
          value: config.backgroundLabels?.[slot] || '',
          placeholder:
            slot === 'lime'
              ? t('editor.background.opt1', 'Color 1')
              : t('editor.background.opt2', 'Color 2'),
          'aria-label': t('settings.themes.config.builtinName', 'Name'),
          oninput: (e) => {
            const label = e.target.value.trim();
            if (label) {
              if (!config.backgroundLabels) config.backgroundLabels = {};
              config.backgroundLabels[slot] = label;
            } else if (config.backgroundLabels) {
              delete config.backgroundLabels[slot];
              if (!Object.keys(config.backgroundLabels).length) {
                delete config.backgroundLabels;
              }
            }
            onChange();
          },
        }),
      ])
    );
  }

  const rows = h('div', { class: 'stack theme-variants' });

  const list = () =>
    Array.isArray(config.slideBackgrounds) ? config.slideBackgrounds : [];

  function write(next) {
    if (next.length) config.slideBackgrounds = next;
    else delete config.slideBackgrounds;
    render();
    onChange();
  }

  /** The readable text colour for a background, using the theme's own poles. */
  const autoTextColor = (value) =>
    pickTextColorForBg(value, {
      light: colors?.textLight || '#ffffff',
      dark: colors?.textDark || '#1f2937',
    });

  function update(index, patch) {
    const next = list().map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry
    );
    // Absent means "no override", which is not the same as a stored empty
    // string — normalizeSlideBackgrounds treats the latter as unset anyway,
    // but keeping the stored shape clean keeps the saved config readable.
    if (patch.textColor === '') delete next[index].textColor;
    write(next);
  }

  function renderRow(entry, index) {
    const row = h('div', { class: 'stack theme-variant-row' });

    const head = h('div', { class: 'row is-justify-between is-items-start' }, [
      h('div', { class: 'stack theme-variant-identity' }, [
        h('strong', { text: entry.label || entry.id }),
        // The id is what slides store, so show it — renaming later would
        // orphan every slide already using this variant.
        h('code', { class: 'help', text: entry.id }),
      ]),
      h('button', {
        type: 'button',
        class: 'btn btn-danger btn-xs',
        text: t('settings.themes.config.removeVariant', 'Remove'),
        onclick: () => write(list().filter((_, i) => i !== index)),
      }),
    ]);

    const bgPicker = createColorPicker({
      label: t('settings.themes.config.variantColor', 'Background'),
      value: entry.value,
      onChange: (value) => {
        // The text colour follows the background unless it has been set to
        // something other than what the background implied.
        const wasAuto =
          !entry.textColor || entry.textColor === autoTextColor(entry.value);
        update(index, {
          value,
          ...(wasAuto ? { textColor: autoTextColor(value) } : {}),
        });
      },
    });

    const textPicker = createColorPicker({
      label: t('settings.themes.config.variantTextColor', 'Text on it'),
      value: entry.textColor || autoTextColor(entry.value),
      onChange: (textColor) => update(index, { textColor }),
    });

    row.append(
      head,
      h('div', { class: 'row is-gap-3 is-wrap' }, [bgPicker.el, textPicker.el])
    );
    return row;
  }

  function render() {
    rows.innerHTML = '';
    const entries = list();
    for (const [index, entry] of entries.entries()) {
      rows.append(renderRow(entry, index));
    }
    if (!entries.length) {
      rows.append(
        h('p', {
          class: 'help',
          text: t('settings.themes.config.noVariants', 'No extra backgrounds yet.'),
        })
      );
    }
  }

  const nameInput = h('input', {
    class: 'input form-input',
    type: 'text',
    maxlength: '40',
    placeholder: t('settings.themes.config.variantNamePlaceholder', 'e.g. Calm'),
    'aria-label': t('settings.themes.config.variantName', 'Name'),
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    },
  });

  function add() {
    const label = nameInput.value.trim();
    const id = slugifyVariantId(label);
    const problem = variantIdProblem(
      id,
      list().map((entry) => entry.id)
    );
    if (problem) {
      toast.error(problem);
      nameInput.focus();
      return;
    }
    if (list().length >= MAX_VARIANTS) {
      toast.error(
        t('settings.themes.config.variantsFull', 'That is as many background options as a theme can hold.')
      );
      return;
    }

    // A new variant starts on the theme's soft surface rather than an arbitrary
    // colour, so it looks like part of the theme before you touch it.
    const value = '#e8f0ee';
    nameInput.value = '';
    write([
      ...list(),
      { id, label, value, textColor: autoTextColor(value) },
    ]);
  }

  render();
  el.append(
    builtins,
    h('div', {
      class: 'field-label field-label-sm',
      text: t('settings.themes.config.extraBackgrounds', 'Extra options'),
    }),
    rows,
    h('div', { class: 'row is-gap-2 is-items-start' }, [
      nameInput,
      h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: t('settings.themes.config.addVariant', 'Add'),
        onclick: add,
      }),
    ])
  );

  return { el };
}

/**
 * Theme editor sections over `theme.config`.
 *
 * The four colours and two fonts have had controls since the theme editor
 * existed. Everything the `config` column added — surface scales, typography
 * treatment, override locks — could only be set with `curl`. These are the
 * single-value controls; the list editors (`slideBackgrounds`,
 * `backgroundPresets`, `slideTypes`) are a separate job.
 *
 * Every section reads and writes the same `config` object the editor sends
 * back, and an unset field stays **absent** rather than being written as its
 * default — `validateThemeConfig` distinguishes the two, and the builder leaves
 * its own defaults in place for anything absent.
 *
 * See docs/reference/theme-config.md.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { createSegmented } from '../../../lib/segmented.js';
import {
  RADIUS_SCALES,
  SHADOW_SCALES,
} from '../../../../shared/theme-config-schema.js';
import { LOCKABLE_PROPERTIES } from '../../../../shared/theme-locks.js';
import { createBackgroundsSection } from './backgrounds-section.js';

/** Sentinel for "leave this to the theme builder's own default". */
const UNSET = '__unset__';

/**
 * Read `config[group][key]`, falling back to the unset sentinel.
 */
function readValue(config, group, key) {
  const value = config?.[group]?.[key];
  return typeof value === 'string' && value ? value : UNSET;
}

/**
 * Write `config[group][key]`, deleting the key (and an emptied group) when set
 * back to unset, so the saved config never carries a value the author did not
 * choose.
 */
function writeValue(config, group, key, value) {
  if (value === UNSET) {
    if (config[group]) {
      delete config[group][key];
      if (!Object.keys(config[group]).length) delete config[group];
    }
    return;
  }
  if (!config[group] || typeof config[group] !== 'object') config[group] = {};
  config[group][key] = value;
}

function card(titleText, hintText) {
  const el = h('div', { class: 'editor-card stack' });
  el.append(h('div', { class: 'field-label', text: titleText }));
  if (hintText) el.append(h('p', { class: 'help', text: hintText }));
  return el;
}

/**
 * A labelled segmented control whose first option means "theme default".
 *
 * @param {Object} opts
 * @param {string} opts.label
 * @param {Array<{value: string, label: string}>} opts.options
 * @param {string} opts.value
 * @param {Function} opts.onChange
 */
function choiceRow({ label, options, value, onChange }) {
  const row = h('div', { class: 'stack theme-config-choice' });
  row.append(h('div', { class: 'field-label field-label-sm', text: label }));
  const segmented = createSegmented({
    h,
    segments: [
      { value: UNSET, label: t('settings.themes.config.default', 'Default') },
      ...options,
    ],
    value,
    outlined: true,
    ariaLabel: label,
    onSelect: (v) => onChange(v),
  });
  row.append(segmented.el);
  return row;
}

/**
 * Surfaces: corner rounding and elevation.
 *
 * Both are named scales over the slide design system rather than raw values, so
 * a theme adjusts the feel while the design system keeps the proportions.
 */
export function createSurfacesSection({ config, onChange }) {
  const el = card(
    t('settings.themes.config.surfaces', 'Surfaces'),
    t(
      'settings.themes.config.surfacesHint',
      'How rounded and how raised the shapes on a slide feel. Both scale the design system rather than replacing it.'
    )
  );

  el.append(
    choiceRow({
      label: t('settings.themes.config.radius', 'Corner rounding'),
      value: readValue(config, 'surfaces', 'radius'),
      options: Object.keys(RADIUS_SCALES).map((key) => ({
        value: key,
        label: t(`settings.themes.config.radius.${key}`, key),
      })),
      onChange: (v) => {
        writeValue(config, 'surfaces', 'radius', v);
        onChange();
      },
    }),
    choiceRow({
      label: t('settings.themes.config.shadow', 'Elevation'),
      value: readValue(config, 'surfaces', 'shadow'),
      options: Object.keys(SHADOW_SCALES).map((key) => ({
        value: key,
        label: t(`settings.themes.config.shadow.${key}`, key),
      })),
      onChange: (v) => {
        writeValue(config, 'surfaces', 'shadow', v);
        onChange();
      },
    })
  );

  return { el };
}

const HEADING_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
const HEADING_WEIGHTS = ['300', '400', '500', '600', '700', '800'];

/** Typography treatment: how headings are cased and weighted. */
export function createTypographySection({ config, onChange }) {
  const el = card(
    t('settings.themes.config.typography', 'Heading treatment'),
    t(
      'settings.themes.config.typographyHint',
      'Applies to headings across every slide type. The fonts themselves are set above.'
    )
  );

  el.append(
    choiceRow({
      label: t('settings.themes.config.headingTransform', 'Capitalisation'),
      value: readValue(config, 'typography', 'headingTransform'),
      options: HEADING_TRANSFORMS.map((key) => ({
        value: key,
        label: t(`settings.themes.config.transform.${key}`, key),
      })),
      onChange: (v) => {
        writeValue(config, 'typography', 'headingTransform', v);
        onChange();
      },
    }),
    choiceRow({
      label: t('settings.themes.config.headingWeight', 'Weight'),
      value: readValue(config, 'typography', 'headingWeight'),
      options: HEADING_WEIGHTS.map((w) => ({ value: w, label: w })),
      onChange: (v) => {
        writeValue(config, 'typography', 'headingWeight', v);
        onChange();
      },
    })
  );

  return { el };
}

const LOCK_LABELS = {
  background: ['settings.themes.config.lock.background', 'Slide background'],
  logo: ['settings.themes.config.lock.logo', 'Corner logo'],
};

/**
 * Override locks: which brand properties a slide may not override.
 *
 * A checkbox rather than a segmented control — `open` is the default and the
 * question is genuinely binary ("may a slide change this?"), so a two-state
 * control with a "default" option would be three ways of saying two things.
 */
export function createLocksSection({ config, onChange }) {
  const el = card(
    t('settings.themes.config.locks', 'Locked by the theme'),
    t(
      'settings.themes.config.locksHint',
      'A locked property is not editable per slide, and an override an existing slide already carries is ignored when it renders. Unlocking gives every slide its own value back.'
    )
  );

  for (const prop of LOCKABLE_PROPERTIES) {
    const [key, fallback] = LOCK_LABELS[prop] || [
      `settings.themes.config.lock.${prop}`,
      prop,
    ];
    const id = `theme-lock-${prop}`;
    const input = h('input', {
      type: 'checkbox',
      id,
      ...(config?.locks?.[prop] === 'locked' ? { checked: true } : {}),
      onchange: (e) => {
        const locked = !!e.target.checked;
        if (locked) {
          if (!config.locks || typeof config.locks !== 'object') config.locks = {};
          config.locks[prop] = 'locked';
        } else if (config.locks) {
          delete config.locks[prop];
          if (!Object.keys(config.locks).length) delete config.locks;
        }
        onChange();
      },
    });
    el.append(
      h('div', { class: 'row is-gap-2 is-items-start theme-config-lock' }, [
        input,
        h('label', { for: id, text: t(key, fallback) }),
      ])
    );
  }

  return { el };
}

/**
 * Build every config section, in the order they belong on the form.
 *
 * @param {Object} opts
 * @param {Object} opts.config - the draft's config (mutated in place)
 * @param {Function} opts.onChange - called after any change, to refresh the preview
 * @returns {HTMLElement[]}
 */
export function createConfigSections({ config, onChange }) {
  return [
    createSurfacesSection({ config, onChange }).el,
    createTypographySection({ config, onChange }).el,
    createBackgroundsSection({ config, onChange }).el,
    createLocksSection({ config, onChange }).el,
  ];
}

/**
 * Enum options are copy or they are tokens — never both (B145).
 *
 * The registry used to stamp `labelKey`/`titleKey`/`ariaLabelKey` on EVERY enum
 * option. A bare-string option (`options: ['contain', 'cover']`) normalizes to
 * `label === value`, so the "English default" it minted was the storage token:
 * 234 keys whose English was a CSS keyword, hand-translated into eleven locales
 * (`contain` → fr `contenir`, "to hold"). The rule now is that an option earns
 * a key only for copy it actually declares (shared/ui-i18n-keys.js).
 *
 * Two ends of the same rule are pinned here:
 *  1. the MINT — a bare string, or an object whose label repeats its value,
 *     produces no option key at all, in the synthetic case and across the live
 *     registry;
 *  2. the LOCALE FILES — no shipped `slideType.*.option.<id>.<slot>` value is
 *     the key segment `<id>` verbatim, which is what a machine token looks like
 *     once it has been written down as copy.
 *
 * The locale half is a real gate rather than a restatement of the mint rule: it
 * also catches a token typed straight into a locale file by hand (four Dutch
 * ones survived that way until this test existed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { addUiI18nKeysToSlideType } from '../shared/ui-i18n-keys.js';
import { optionCopy } from '../client/views/editor/fields/option-copy.js';
import { loadLocale } from '../scripts/lib/i18n-fs.js';
import { LOCALE_IDS } from '../scripts/lib/i18n-locales.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');

const OPTION_KEY_RE = /\.option\.([^.]+)\.(label|title|ariaLabel)$/;

/**
 * The locale-file half of the gate, as a function so the test can also prove it
 * FAILS on a token — a gate nobody has seen fail is a gate nobody trusts.
 * @param {Record<string, string>} dict - one locale's flat key → string map
 * @returns {string[]} offending keys
 */
function tokensWrittenAsCopy(dict) {
  const bad = [];
  for (const [key, value] of Object.entries(dict)) {
    if (!key.startsWith('slideType.')) continue;
    const m = OPTION_KEY_RE.exec(key);
    if (m && value === m[1]) bad.push(key);
  }
  return bad;
}

/** Every option of every field (and item field) of one composed definition. */
function* optionsOf(fields) {
  for (const f of Array.isArray(fields) ? fields : []) {
    for (const o of Array.isArray(f?.options) ? f.options : []) yield [f, o];
    if (Array.isArray(f?.itemFields)) yield* optionsOf(f.itemFields);
    if (Array.isArray(f?.fields)) yield* optionsOf(f.fields);
  }
}

test('a bare-string option mints no i18n key', () => {
  const def = addUiI18nKeysToSlideType('acme-token-slide', {
    label: 'Token',
    fields: [
      { key: 'fit', type: 'enum', label: 'Fit', options: ['contain', 'cover'] },
    ],
  });
  for (const [, opt] of optionsOf(def.fields)) {
    assert.equal(opt.labelKey, undefined, `${opt.value} minted a labelKey`);
    assert.equal(opt.titleKey, undefined, `${opt.value} minted a titleKey`);
    assert.equal(opt.ariaLabelKey, undefined, `${opt.value} minted an ariaKey`);
  }
});

test('an option whose label repeats its value mints no i18n key', () => {
  const def = addUiI18nKeysToSlideType('acme-token-slide', {
    label: 'Token',
    fields: [
      {
        key: 'fit',
        type: 'enum',
        label: 'Fit',
        options: [{ value: 'contain', label: 'contain', title: 'contain' }],
      },
    ],
  });
  const [[, opt]] = [...optionsOf(def.fields)];
  assert.equal(opt.labelKey, undefined);
  assert.equal(opt.titleKey, undefined);
});

test('declared copy mints a label key, and only the slots that speak', () => {
  const def = addUiI18nKeysToSlideType('acme-copy-slide', {
    label: 'Copy',
    fields: [
      {
        key: 'fit',
        type: 'enum',
        label: 'Fit',
        options: [
          { value: 'contain', label: 'Fit (no crop)' },
          { value: 'cover', label: 'Fill (crop)', title: 'Crops the image' },
        ],
      },
    ],
  });
  const [contain, cover] = [...optionsOf(def.fields)].map(([, o]) => o);
  assert.equal(
    contain.labelKey,
    'slideType.acme-copy-slide.field.fit.option.contain.label',
  );
  // No title of its own: the UI falls back to the translated label, so a
  // second key for the same text is never minted.
  assert.equal(contain.titleKey, undefined);
  assert.equal(
    cover.titleKey,
    'slideType.acme-copy-slide.field.fit.option.cover.title',
  );
});

test('no live registry option mints a key for its own storage token', () => {
  const offenders = [];
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    for (const [field, opt] of optionsOf(def?.fields)) {
      const mints = !!(opt?.labelKey || opt?.titleKey || opt?.ariaLabelKey);
      if (mints && opt.label === opt.value)
        offenders.push(`${type}.${field.key} → ${opt.value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `options minting a key for their storage token:\n  ${offenders.join('\n  ')}`,
  );
});

test('no locale writes a storage token down as option copy', async () => {
  for (const locale of LOCALE_IDS) {
    const dict = await loadLocale(i18nDir, locale);
    assert.deepEqual(
      tokensWrittenAsCopy(dict),
      [],
      `${locale}/ ships machine tokens as option copy`,
    );
  }
});

test('the locale gate actually fires on a token', () => {
  const bad = tokensWrittenAsCopy({
    'slideType.acme-slide.field.fit.option.contain.label': 'contain',
    'slideType.acme-slide.field.fit.option.cover.label': 'Fill (crop)',
  });
  assert.deepEqual(bad, [
    'slideType.acme-slide.field.fit.option.contain.label',
  ]);
});

// --- the reader side: what the editor actually renders ------------------

test('optionCopy translates the minted label and falls back for the rest', () => {
  const opt = optionCopy({
    value: 'contain',
    label: 'Fit (no crop)',
    labelKey: 'slideType.acme.field.fit.option.contain.label',
  });
  // No locale is loaded in the test process, so `t` returns the English
  // default — the point here is the chain, not the translation.
  assert.equal(opt.label, 'Fit (no crop)');
  assert.equal(opt.title, 'Fit (no crop)');
  assert.equal(opt.ariaLabel, 'Fit (no crop)');
});

test('optionCopy keeps a runtime option own title, and names it by its label', () => {
  // The `image-fit` widget composes its options itself, already translated,
  // so they carry no keys: a title it declares is copy, not a fallback.
  const opt = optionCopy({
    value: '',
    label: 'Default · Fill (crop)',
    title: 'Follow the slide type default',
  });
  assert.equal(opt.title, 'Follow the slide type default');
  assert.equal(opt.ariaLabel, 'Default · Fill (crop)');
});

test('optionCopy leaves a bare-string option as its own token', () => {
  const opt = optionCopy('16:9');
  assert.deepEqual(
    { label: opt.label, title: opt.title, ariaLabel: opt.ariaLabel },
    { label: '16:9', title: '16:9', ariaLabel: '16:9' },
  );
});

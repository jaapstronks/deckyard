/**
 * The theme record carries every theme losslessly (B437, D208).
 *
 * Ten themes — the six core file themes and the four CIIIC-fork themes — are
 * written as records under `tests/fixtures/theme-records/`. Each goes through
 * the same path a database theme renders on (`buildThemeConfig` →
 * `normalizeTheme` → `themeVarsCssText`) and has to come out with the `--t-*`
 * tokens its file form produces. What does not reach the tokens is compared as
 * the rendered theme field it is (logos, alt text, grounds, slide-type
 * curation).
 *
 * The fields D208 lets lapse are not compared: `textSwatches`, the `{en, nl}`
 * background labels, `embedFonts` (the families are managed fonts here, see
 * `managed-fonts.json`), `hiddenSlideTypes` (folded into `slideTypes.exclude`),
 * `slides.*` and `sampleEmbedUrl`.
 *
 * The fork's file forms are copies under `fork-files/` (ciiic-slides,
 * 2026-09-24, `sampleEmbedUrl` removed): the fork is not on this machine's
 * test path, and the comparison needs both sides.
 *
 * Run with: node --test tests/theme-record-parity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThemeConfig } from '../server/utils/theme-builder.js';
import { themeVarsCssText } from '../server/utils/themes.js';
import { normalizeTheme } from '../shared/theme-normalize.js';
import {
  checkThemeConfig,
  validateThemeColors,
} from '../shared/theme-config-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixtures = path.join(here, 'fixtures', 'theme-records');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const managedFonts = readJson(path.join(fixtures, 'managed-fonts.json'));

const coreIds = fs
  .readdirSync(path.join(repoRoot, 'themes'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();
const forkIds = fs
  .readdirSync(path.join(fixtures, 'fork-files'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const themes = [
  ...coreIds.map((id) => ({
    id,
    file: readJson(path.join(repoRoot, 'themes', `${id}.json`)),
  })),
  ...forkIds.map((id) => ({
    id,
    file: readJson(path.join(fixtures, 'fork-files', `${id}.json`)),
  })),
].map((t) => ({ ...t, record: readJson(path.join(fixtures, `${t.id}.json`)) }));

/**
 * Tokens a record may add that its file form leaves to the stylesheet: the
 * record then pins the stylesheet's own fallback, so the slide paints the same.
 * clicknl sets no dark ground and renders on `var(--t-slide-bg-dark, #212121)`
 * (client/styles/theme.css); the record's derivation always emits one.
 */
const STYLESHEET_FALLBACKS = { '--t-slide-bg-dark': '#212121' };

/**
 * The emitted CSS, split into the `--t-*` declarations (order is not part of
 * the contract) and the generated rule blocks after them.
 */
function emitted(theme) {
  const css = themeVarsCssText(theme);
  const vars = {};
  for (const m of css.matchAll(/^ {2}(--t-[a-z0-9-]+): (.*);$/gim)) {
    vars[m[1]] = m[2];
  }
  const rules = css
    .split('\n')
    .filter((line) => !/^ {2}--t-/.test(line))
    .join('\n');
  return { vars, rules };
}

const fromFile = (file) => normalizeTheme(file);
const fromRecord = (record) =>
  normalizeTheme(
    buildThemeConfig({ ...record, id: record.slug }, { managedFonts }),
  );

test('every core theme has a record fixture, and there are ten themes', () => {
  assert.deepEqual(coreIds.length, 6);
  assert.deepEqual(forkIds, [
    'ciiic',
    'ciiic-international',
    'clicknl',
    'dreamslides',
  ]);
  for (const id of coreIds) {
    assert.ok(
      fs.existsSync(path.join(fixtures, `${id}.json`)),
      `${id}: no record fixture`,
    );
  }
});

for (const { id, file, record } of themes) {
  test(`${id}: the record passes the write gate and loses nothing`, () => {
    const colors = validateThemeColors(record.colors);
    assert.ok(colors.ok, `${id}: colors refused (${colors.field})`);
    assert.deepEqual(colors.colors, record.colors);

    const config = checkThemeConfig(record.config);
    assert.ok(config.ok, `${id}: config refused (${config.field})`);
    const { version, ...stored } = config.config;
    assert.equal(version, 1);
    assert.deepEqual(stored, record.config);
  });

  test(`${id}: the record renders the same --t-* tokens as the file`, () => {
    const want = emitted(fromFile(file));
    const got = emitted(fromRecord(record));

    for (const [key, value] of Object.entries(want.vars)) {
      assert.equal(got.vars[key], value, `${id}: ${key}`);
    }
    for (const key of Object.keys(got.vars)) {
      if (key in want.vars) continue;
      assert.equal(
        got.vars[key],
        STYLESHEET_FALLBACKS[key],
        `${id}: ${key} is emitted by the record only`,
      );
    }
    assert.equal(got.rules, want.rules, `${id}: generated background rules`);
  });

  test(`${id}: the record carries the theme's logos, grounds and curation`, () => {
    const want = fromFile(file);
    const got = fromRecord(record);

    for (const key of [
      'logo',
      'logoAlt',
      'payoffLogo',
      'payoffAlt',
      'logoOnDark',
      'logoOnLight',
    ]) {
      assert.equal(got.assets[key], want.assets[key], `${id}: assets.${key}`);
    }
    assert.deepEqual(got.brandColors, want.brandColors);
    assert.deepEqual(got.slideBackgrounds, want.slideBackgrounds);
    assert.deepEqual(got.backgroundPresets, want.backgroundPresets ?? []);
    assert.deepEqual(got.slideTypes, want.slideTypes);
    assert.deepEqual(got.gradient, want.gradient);
    for (const key of [
      'label',
      'defaultTitleSlide',
      'defaultBackground',
      'titleLayout',
      'textColorLight',
      'textColorDark',
    ]) {
      assert.equal(got[key], want[key], `${id}: ${key}`);
    }
  });
}

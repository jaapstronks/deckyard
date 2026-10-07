/**
 * i18n placeholder gate — `t()` interpolates `{var}`, never `{{var}}`.
 *
 * `interpolate()` in `client/lib/ui-i18n.js` replaces `{name}`; a value written
 * as `{{name}}` keeps its outer braces, so the UI showed `Device {fe4682ff}…`
 * and `Slide {1}` on the analytics page (B357). This guard fails on any `{{`
 * in a locale file, except the keys that document Handlebars syntax for
 * custom slide types and so must show the double braces literally.
 *
 * Run with: node --test tests/i18n-single-brace-placeholders.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');

/** Keys whose copy documents Handlebars (`{{#each}}`, `{{esc field}}`). */
const HANDLEBARS_DOC_KEYS = new Set([
  'settings.slideTypes.help.index',
  'settings.slideTypes.help.this',
  'settings.slideTypes.help.var',
]);

/** @returns {string[]} every locale JSON file under client/i18n/<locale>/ */
function localeFiles() {
  return fs
    .readdirSync(i18nDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      fs
        .readdirSync(path.join(i18nDir, d.name))
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(i18nDir, d.name, f)),
    );
}

describe('i18n placeholders use single braces', () => {
  it('finds locale files to scan', () => {
    assert.ok(localeFiles().length > 0);
  });

  it('has no {{ outside the Handlebars help keys', () => {
    const offenders = [];
    for (const file of localeFiles()) {
      const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value !== 'string' || !value.includes('{{')) continue;
        if (HANDLEBARS_DOC_KEYS.has(key)) continue;
        offenders.push(`${path.relative(repoRoot, file)}: ${key}`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `t() interpolates {var}, not {{var}}:\n${offenders.join('\n')}`,
    );
  });
});

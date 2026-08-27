/**
 * The scaffolder — gap 1b of `briefs/forker-slide-type-toolkit.md`.
 *
 * `npm run new:slide-type -- <name>` promises a type that is valid on creation.
 * The script proves that at runtime by validating what it wrote; these tests
 * keep the promise honest in CI, where nobody runs the command: the generated
 * module must import, validate clean, and actually render.
 *
 * Run with: node --test tests/new-slide-type-scaffold.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIELD_TYPE_NAMES } from '../shared/slide-types/field-types.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from '../shared/slide-types/registry.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';
import {
  SCAFFOLDABLE_FIELD_TYPES,
  cssSource,
  moduleSource,
  parseFields,
} from '../scripts/new-slide-type.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Write a generated module where its `../../shared/…` import resolves — two
 * levels below the repo root, the depth `custom/slide-types/` sits at — and
 * import it back.
 *
 * @param {string} name
 * @param {string} source
 * @returns {Promise<unknown>} the module's default export
 */
async function importGenerated(name, source) {
  const tmp = mkdtempSync(join(REPO_ROOT, '.fork-fixtures-'));
  try {
    const dir = join(tmp, 'slide-types');
    mkdirSync(dir);
    const file = join(dir, `${name}.js`);
    writeFileSync(file, source);
    const mod = await import(pathToFileURL(file).href);
    return mod.default;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('the default scaffold validates clean and renders', async () => {
  const { fields, errors } = parseFields('heading:string,body:markdown');
  assert.deepEqual(errors, []);

  const def = await importGenerated(
    'acme-hero-slide',
    moduleSource({
      name: 'acme-hero-slide',
      label: 'Acme hero',
      fields,
      themeId: null,
      namespace: null,
    }),
  );

  const report = validateSlideTypeDefinition(def, 'acme-hero-slide', {
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);

  const html = def.renderHtml({ heading: 'Hi', body: 'There' });
  assert.match(html, /class="slide slide-acme-hero"/);
  assert.match(html, /data-inline-field="heading"/);
  assert.match(html, /Hi/);
});

test('the scaffold escapes content rather than interpolating it raw', async () => {
  const { fields } = parseFields('heading:string');
  const def = await importGenerated(
    'esc-slide',
    moduleSource({
      name: 'esc-slide',
      label: 'Esc',
      fields,
      themeId: null,
      namespace: null,
    }),
  );
  const html = def.renderHtml({ heading: '<script>alert(1)</script>' });
  assert.ok(
    !html.includes('<script>'),
    'the payload must not survive as markup',
  );
  assert.match(html, /&lt;script&gt;/);
});

test('the scaffoldable types are a subset of the declared vocabulary', () => {
  const unknown = SCAFFOLDABLE_FIELD_TYPES.filter(
    (t) => !FIELD_TYPE_NAMES.includes(t),
  );
  assert.deepEqual(
    unknown,
    [],
    'the scaffolder offers a field type field-types.js does not declare',
  );
});

test('every scaffoldable field type produces a valid definition', async () => {
  const spec = SCAFFOLDABLE_FIELD_TYPES.map((t, i) => `f${i}${t}:${t}`).join(
    ',',
  );
  const { fields, errors } = parseFields(spec);
  assert.deepEqual(errors, []);
  assert.equal(fields.length, SCAFFOLDABLE_FIELD_TYPES.length);

  const def = await importGenerated(
    'wide-slide',
    moduleSource({
      name: 'wide-slide',
      label: 'Wide',
      fields,
      themeId: 'acme-theme',
      namespace: 'acme',
    }),
  );
  const report = validateSlideTypeDefinition(def, 'wide-slide', {
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(def.themeId, 'acme-theme');
  assert.equal(def.namespace, 'acme');
  // A number default must be 0, not '' — an empty string fails number validation.
  assert.equal(def.defaults.f3number, 0);
  assert.equal(def.defaults.f0boolean, false);
});

test('parseFields refuses what the scaffold cannot write', () => {
  assert.match(
    parseFields('a:strng').errors.join(' '),
    /not a type this scaffolder can write/,
  );
  assert.match(
    parseFields('a:string,a:markdown').errors.join(' '),
    /duplicate/,
  );
  assert.match(
    parseFields('slideBgImage:image').errors.join(' '),
    /global slide field/,
  );
  assert.match(
    parseFields('not a key:string').errors.join(' '),
    /not a usable field key/,
  );
  assert.match(parseFields('').errors.join(' '), /no fields given/);
});

test('the CSS stub nests every selector under the type root', () => {
  const css = cssSource('acme-hero-slide', 'Acme hero');
  const selectors = css
    .split('\n')
    .filter((line) => line.trim().endsWith('{'))
    .map((line) => line.trim());
  assert.ok(selectors.length > 0, 'the stub must contain rules');
  for (const sel of selectors) {
    assert.ok(
      sel.startsWith('.slide-acme-hero '),
      `"${sel}" is not scoped to the type root`,
    );
  }
});

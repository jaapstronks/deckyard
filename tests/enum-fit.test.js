/**
 * Inspector enums fit their column (B457).
 *
 * The renderer picks segmented or dropdown from the declaration
 * (client/views/editor/fields/enum-fit.js). This gate walks every enum field
 * of every built-in slide type, in English and Dutch, and fails on a
 * declaration whose labels do not fit the narrowest inspector column even as
 * a dropdown, or whose options cannot be told apart. Without it, whether a
 * new field fits is something somebody has to check in a browser.
 *
 * Run with: node --test tests/enum-fit.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');
const { normalizeOption } = await import('../shared/ui-i18n-keys.js');
const { enumControl, INSPECTOR_MIN_COLUMN_PX } =
  await import('../client/views/editor/fields/enum-fit.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { imageFitOptions } =
  await import('../client/views/editor/fields/image-fit.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readLocale(lang) {
  const dir = path.join(ROOT, 'client/i18n', lang);
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) {
      Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f))));
    }
  }
  return out;
}

const LOCALES = { en: readLocale('en'), nl: readLocale('nl') };

/** Every visible enum field, top-level and per item, with a readable path. */
function enumFields() {
  const out = [];
  const visit = (typeName, field, prefix) => {
    if (field?.type === 'enum' && !field.hidden) {
      out.push({ where: `${typeName} › ${prefix}${field.key}`, field });
    }
    for (const sub of field?.itemFields || []) {
      visit(typeName, sub, `${prefix}${field.key}[].`);
    }
  };
  for (const [name, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
    for (const field of def.fields || []) visit(name, field, '');
  }
  return out;
}

/** The option copy the inspector shows in `lang`. */
function resolvedOptions(field, lang) {
  const dict = LOCALES[lang];
  return (field.options || []).map((raw) => {
    const opt = normalizeOption(raw);
    const label = (opt.labelKey && dict[opt.labelKey]) || opt.label;
    return { ...opt, label };
  });
}

test('the gate sees the enum fields of the built-in types', () => {
  assert.ok(enumFields().length > 30, 'walks the registry');
});

test('every built-in enum fits the narrowest inspector column (en, nl)', () => {
  const failures = [];
  for (const { where, field } of enumFields()) {
    for (const lang of Object.keys(LOCALES)) {
      const options = resolvedOptions(field, lang);
      const fit = enumControl(options);
      if (fit.fits) continue;
      const longest = options.reduce((a, b) =>
        String(b.label).length > String(a.label).length ? b : a,
      );
      failures.push(
        `${where} [${lang}]: "${longest.label}" needs ~${fit.widthPx}px as a ` +
          `dropdown, the column has ${INSPECTOR_MIN_COLUMN_PX}px. Shorten ` +
          'the label to a name and move the explanation to the option `title`.',
      );
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('no two options of a built-in enum share a label (en, nl)', () => {
  const failures = [];
  for (const { where, field } of enumFields()) {
    for (const lang of Object.keys(LOCALES)) {
      const seen = new Set();
      for (const { label } of resolvedOptions(field, lang)) {
        if (seen.has(label)) {
          failures.push(
            `${where} [${lang}]: two options read "${label}". Give each ` +
              'option its own name; put what it resolves to in `title`.',
          );
        }
        seen.add(label);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the image-fit widget is one segmented row with three distinct labels', () => {
  const options = imageFitOptions({ typeDefault: 'cover' });
  const labels = options.map((o) => o.label);
  assert.equal(new Set(labels).size, labels.length, labels.join(' | '));
  assert.equal(enumControl(options).control, 'segmented');
  assert.match(options[0].title, /Fill/);
});

test('the decision follows the labels, not the option count', () => {
  const short = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => ({
    label,
  }));
  assert.equal(enumControl(short).control, 'segmented', 'seven short ones');
  const long = [
    { label: 'Meaningful (needs alt text)' },
    { label: 'Decorative (no alt text)' },
  ];
  assert.equal(enumControl(long).control, 'select', 'two long ones');
  const icons = Array.from({ length: 4 }, (_, i) => ({
    label: `A long spoken name ${i}`,
    icon: 'side-left',
  }));
  assert.equal(enumControl(icons).control, 'segmented', 'icons are narrow');
});

test('the renderer draws what the decision says', () => {
  const { fieldEnum } = createFieldRenderers();
  const seg = fieldEnum(
    {
      key: 'x',
      label: 'X',
      options: [
        { value: 'a', label: 'One' },
        { value: 'b', label: 'Two', title: 'The second' },
      ],
    },
    'a',
    () => {},
  );
  assert.ok(seg.querySelector('.sb-segmented'), 'segmented');
  assert.equal(
    seg.querySelector('[data-value="b"]').getAttribute('title'),
    'The second',
  );

  const sel = fieldEnum(
    {
      key: 'y',
      label: 'Y',
      options: [
        { value: 'a', label: 'Horizontal (2 steps)' },
        { value: 'b', label: 'Quadrants (4 steps)' },
        { value: 'c', label: 'Vertical (2 steps)' },
      ],
    },
    'a',
    () => {},
  );
  assert.ok(sel.querySelector('select'), 'dropdown');
  assert.ok(!sel.querySelector('.sb-segmented'));
});

test('an option glyph comes from the option, not from the field key', () => {
  const { fieldEnum } = createFieldRenderers();
  const el = fieldEnum(
    {
      key: 'anything',
      label: 'Side',
      options: [
        { value: 'left', label: 'Left', icon: 'side-left' },
        { value: 'right', label: 'Right' },
      ],
    },
    'left',
    () => {},
  );
  assert.ok(el.querySelector('[data-value="left"] .sb-icon-side-left'));
  assert.equal(el.querySelector('[data-value="right"]').textContent, 'Right');
  assert.equal(
    el.querySelector('[data-value="left"]').getAttribute('aria-label'),
    'Left',
  );
});

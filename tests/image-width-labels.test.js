/**
 * One vocabulary for the image width (D337, B706).
 *
 * The layout switcher and the inspector name the same three splits: 37%, 50%
 * and 63%, small to large, each with the split sketch. Before this the
 * switcher said "Image 1/3 · 1/2 · 2/3" and the inspector "50% · 37% · 63%",
 * so an author translated between fractions, percentages and an order that
 * matched neither. The stored values (`narrow`/`half`/`wide`) are the contract
 * existing decks rely on and stay as they are: this pins labels and order,
 * never a third value set (33/50/67 would shift every deck).
 *
 * Run with: node --test tests/image-width-labels.test.js
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
const { IMAGE_WIDTH_FIELD } = await import('../shared/slide-types/helpers.js');
const { SLIDE_TYPE_PRESETS } =
  await import('../client/views/editor/slide-type-picker/data.js');
const { enumControl, segmentedRowPx } =
  await import('../client/views/editor/fields/enum-fit.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [
  { value: 'narrow', pct: 37 },
  { value: 'half', pct: 50 },
  { value: 'wide', pct: 63 },
];
const VARIANT_KEY = {
  narrow: 'editor.layoutVariant.splitNarrow',
  half: 'editor.layoutVariant.splitHalf',
  wide: 'editor.layoutVariant.splitWide',
};
const IMAGE_WORD = { en: 'Image', nl: 'Beeld' };

function readEditorLocale(lang) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'client/i18n', lang, 'editor.json')),
  );
}
const LOCALES = { en: readEditorLocale('en'), nl: readEditorLocale('nl') };

test('inspector: imageWidth offers narrow, half, wide in that order with the percentage as label', () => {
  assert.deepEqual(
    IMAGE_WIDTH_FIELD.options.map((o) => o.value),
    WIDTHS.map((w) => w.value),
    'stored values are the contract and stay narrow/half/wide, small to large',
  );
  for (const [i, opt] of IMAGE_WIDTH_FIELD.options.entries()) {
    const { pct } = WIDTHS[i];
    assert.equal(opt.label, `${pct}%`, `${opt.value} fallback label`);
    assert.equal(opt.icon, `split-${pct}`, `${opt.value} draws the split`);
    assert.equal(
      opt.labelBeside,
      true,
      `${opt.value} keeps the number visible`,
    );
    for (const lang of Object.keys(LOCALES)) {
      assert.equal(
        LOCALES[lang][opt.labelKey],
        `${pct}%`,
        `${lang} ${opt.labelKey}`,
      );
    }
  }
});

test('switcher: every split variant says "<Image> <pct>%" and sets the matching imageWidth', () => {
  const seen = [];
  for (const [typeName, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
    for (const variant of def.layoutVariants || []) {
      const value = variant.set?.imageWidth;
      if (!value) continue;
      const width = WIDTHS.find((w) => w.value === value);
      assert.ok(width, `${typeName}/${variant.id}: known imageWidth ${value}`);
      assert.equal(
        variant.schematic?.split,
        width.pct,
        `${typeName}/${variant.id} sketch`,
      );
      assert.equal(
        variant.label,
        `Image ${width.pct}%`,
        `${typeName}/${variant.id} fallback label`,
      );
      assert.equal(
        variant.labelKey,
        VARIANT_KEY[value],
        `${typeName}/${variant.id} key`,
      );
      for (const [lang, word] of Object.entries(IMAGE_WORD)) {
        assert.equal(
          LOCALES[lang][variant.labelKey],
          `${word} ${width.pct}%`,
          `${lang} ${variant.labelKey}`,
        );
      }
      seen.push(`${typeName}/${variant.id}`);
    }
  }
  assert.ok(
    seen.includes('image-text-slide/split-narrow') &&
      seen.includes('image-text-slide/split-half') &&
      seen.includes('image-text-slide/split-wide'),
    `image-text declares all three splits (${seen.join(', ')})`,
  );
});

test('switcher: image-text lists the splits small to large', () => {
  const ids = CORE_SLIDE_TYPE_DEFS['image-text-slide'].layoutVariants
    .filter((v) => v.set?.imageWidth)
    .map((v) => v.set.imageWidth);
  assert.deepEqual(
    ids,
    WIDTHS.map((w) => w.value),
  );
});

test('picker preset: the wide image preset uses the same name', () => {
  const preset = SLIDE_TYPE_PRESETS['image-text-slide'].find(
    (p) => p.content?.imageWidth,
  );
  assert.ok(preset, 'image-text has an imageWidth preset');
  assert.equal(preset.content.imageWidth, 'wide');
  assert.equal(preset.label, 'Image 63%');
  for (const [lang, word] of Object.entries(IMAGE_WORD)) {
    assert.equal(LOCALES[lang][preset.labelKey], `${word} 63%`, lang);
  }
});

test('nl: the vocabulary says "Beeld" for both image fields', () => {
  assert.equal(
    LOCALES.nl['editor.slideField.imageWidth.label'],
    'Beeldbreedte',
  );
  assert.equal(LOCALES.nl['editor.slideField.imageSide.label'], 'Beeldpositie');
});

test('inspector: the glyph-beside-label row still fits the column as one segmented control', () => {
  const options = IMAGE_WIDTH_FIELD.options.map((o) => ({
    ...o,
    label: LOCALES.en[o.labelKey],
  }));
  const fit = enumControl(options);
  assert.equal(fit.control, 'segmented');
  assert.equal(fit.size, 'wide', 'same size intent as the label-only row had');
  const glyphOnly = segmentedRowPx(
    options.map((o) => ({ ...o, labelBeside: false })),
  );
  const labelOnly = segmentedRowPx(options.map((o) => ({ ...o, icon: '' })));
  assert.ok(
    fit.widthPx > glyphOnly && fit.widthPx > labelOnly,
    'a glyph beside its label is counted as both',
  );
});

test('inspector: a labelBeside option renders the sketch and the label, glyph-only options the sketch alone', () => {
  const { fieldEnum } = createFieldRenderers({});
  const el = fieldEnum(IMAGE_WIDTH_FIELD, 'half', () => {});
  const buttons = [...el.querySelectorAll('.sb-segmented-btn')];
  assert.deepEqual(
    buttons.map((b) => b.dataset.value),
    WIDTHS.map((w) => w.value),
  );
  for (const [i, btn] of buttons.entries()) {
    const { pct } = WIDTHS[i];
    assert.ok(btn.classList.contains('has-icon-beside'));
    assert.ok(
      btn.querySelector(`.sb-icon.sb-icon-split-${pct}.is-beside`),
      `${pct}% sketch`,
    );
    assert.equal(btn.textContent.trim(), `${pct}%`, `${pct}% label visible`);
    assert.equal(btn.getAttribute('aria-pressed'), String(pct === 50));
  }
  const sideOnly = fieldEnum(
    {
      key: 'imageSide',
      label: 'Image position',
      options: [{ value: 'left', label: 'Left', icon: 'side-left' }],
    },
    'left',
    () => {},
  );
  const btn = sideOnly.querySelector('.sb-segmented-btn');
  assert.ok(btn.querySelector('.sb-icon-side-left'));
  assert.ok(!btn.querySelector('.is-beside'));
  assert.equal(btn.textContent.trim(), '', 'glyph replaces the label');
});

// The AI prompt offers each slide type the grounds its picker offers (B244):
// the type's `background` options joined with the theme's variants, never one
// fixed list for every type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildThemeContextSection } from '../server/utils/ai/prompts/base/refine-slides.js';

/** Parse the section's `- a, b: type1, type2` lines into type → offer. */
function offersByType(section) {
  const out = {};
  for (const line of section.split('\n')) {
    const m = /^- (.+): (.+)$/.exec(line);
    if (!m) continue;
    for (const type of m[2].split(', ')) out[type] = m[1].split(', ');
  }
  return out;
}

test('a type without dark is not offered dark; countdown keeps its own seven', () => {
  const offers = offersByType(
    buildThemeContextSection({ slideBackgrounds: [] }),
  );
  assert.deepEqual(offers['content-slide'], ['lime', 'mist']);
  assert.ok(!offers['list-slide'].includes('dark'));
  assert.deepEqual(offers['countdown-slide'], [
    'lime',
    'mist',
    'dark',
    'accent',
    'brand-1',
    'brand-2',
    'custom',
  ]);
});

test('a theme variant is offered to every type with a background field', () => {
  const offers = offersByType(
    buildThemeContextSection({
      slideBackgrounds: [{ id: 'night', label: 'Night' }],
    }),
  );
  assert.deepEqual(offers['content-slide'], ['lime', 'mist', 'night']);
  assert.equal(offers['countdown-slide'].at(-1), 'night');
});

test('disabled types are left out, custom types read their own field', () => {
  const offers = offersByType(
    buildThemeContextSection(
      { slideBackgrounds: [] },
      ['countdown-slide'],
      [
        {
          slug: 'promo',
          fields: [
            {
              key: 'background',
              type: 'enum',
              options: [{ value: 'mist' }, { value: 'accent' }],
            },
          ],
        },
      ],
    ),
  );
  assert.equal(offers['countdown-slide'], undefined);
  assert.deepEqual(offers['custom-promo'], ['mist', 'accent']);
});

test('no fixed lime/mist/dark trio left in the AI theme context', () => {
  for (const file of [
    'server/routes/api/ai/shared.js',
    'server/utils/ai/prompts/base/refine-slides.js',
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!src.includes('--t-slide-bg-dark'), `${file} reads a fixed slot`);
    assert.ok(!/lime, mist, dark/.test(src), `${file} names the fixed trio`);
    assert.ok(
      !src.includes('backgroundOptions'),
      `${file} keeps the flat list`,
    );
  }
});

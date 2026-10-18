// The AI prompt offers each slide type the grounds its picker offers (B244):
// the type's `background` options joined with the theme's variants, never one
// fixed list for every type; a type without the field is named (B765).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPhase2SystemPrompt,
  buildThemeContextSection,
} from '../server/utils/ai/prompts/base/refine-slides.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from '../shared/slide-types/registry.js';

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

test('types without a background field are named, so the model leaves it out (B765)', () => {
  const section = buildThemeContextSection({ slideBackgrounds: [] });
  const line = section
    .split('\n')
    .find((l) => l.startsWith('These types have no background'));
  assert.ok(line, 'no line naming the types without a background');
  assert.ok(line.includes('icon-card-grid-slide'));
  assert.ok(line.includes('text-blocks-slide'));
  assert.ok(!line.includes('list-slide'), 'list-slide offers a background');
});

test('the length contract leaves out the global fields every type carries (B765)', () => {
  const prompt = buildPhase2SystemPrompt({
    lang: 'en',
    themeContext: { slideBackgrounds: [] },
  });
  for (const key of GLOBAL_SLIDE_FIELD_KEYS) {
    assert.ok(!prompt.includes(`${key}:`), `${key} is offered as a cap`);
  }
  assert.match(prompt, /list-slide: title: \d+/);
});

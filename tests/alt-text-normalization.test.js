import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT_TEXT_CONSTRAINTS,
  normalizeFieldContent,
  truncateFieldText,
} from '../shared/slide-types/field-normalization.js';
import { validateFieldValue } from '../shared/slide-types/field-types.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { normalizeSlides } from '../server/storage/presentations/slides.js';
import { normalizeSlideContent } from '../shared/slide-types/normalize-content.js';

const long =
  'Een bezoeker bekijkt een tentoonstelling met interactieve installaties. '
    .repeat(5)
    .slice(0, 299);

test('descriptive text clips at a word boundary within UTF-16 limits', () => {
  const result = truncateFieldText(long, 180);
  assert.ok(result.length <= 180);
  assert.match(result, /…$/);
  assert.ok(long.startsWith(result.slice(0, -1)));
  assert.equal(truncateFieldText(result, 180), result);
  assert.equal(truncateFieldText('🖼'.repeat(100), 180), '🖼'.repeat(89) + '…');
  assert.equal(truncateFieldText('a'.repeat(300), 180), 'a'.repeat(179) + '…');
});

test('only explicitly declared overflow truncates, without changing input', () => {
  const fields = [
    { key: 'alt', type: 'string', ...ALT_TEXT_CONSTRAINTS },
    { key: 'caption', type: 'string', maxLength: 180 },
  ];
  const source = { alt: long, caption: long };
  const result = normalizeFieldContent(fields, source);
  assert.equal(source.alt.length, 299);
  assert.equal(result.alt, truncateFieldText(long, 180));
  assert.equal(result.caption, long);
  assert.deepEqual(validateFieldValue(long, fields[0]), []);
  assert.equal(validateFieldValue(long, fields[1]).length, 1);
  assert.equal(validateFieldValue(4, fields[0]).length, 1);
});

test('every declared core alt shares the same limit on editor and storage folds', () => {
  let count = 0;
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const seed = (fields) =>
      Object.fromEntries(
        (fields || []).flatMap((f) => {
          if (f.type === 'items') return [[f.key, [seed(f.itemFields)]]];
          if (f.key === 'alt' || f.key.endsWith('Alt')) {
            count++;
            assert.equal(f.maxLength, 180, `${type}.${f.key}`);
            assert.equal(f.overflow, 'truncate');
            return [[f.key, long]];
          }
          return [];
        }),
      );
    const content = seed(def.fields);
    const stored = normalizeSlides([{ id: 's', type, content }])[0].content;
    const edited = structuredClone(content);
    normalizeSlideContent(type, def, edited);
    const check = (fields, value) => {
      for (const f of fields || []) {
        if (f.type === 'items') check(f.itemFields, value[f.key][0]);
        else if (f.key === 'alt' || f.key.endsWith('Alt'))
          assert.equal(value[f.key], truncateFieldText(long, 180));
      }
    };
    check(def.fields, stored);
    check(def.fields, edited);
  }
  assert.equal(count, 8);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSlideTypesPrompt } from '../server/utils/openai/slide-types-prompt.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { getOfferedSlideTypes } from '../server/utils/ai/slide-catalog/index.js';

/**
 * The "Content schema:" lines of one type's section in the generator prompt.
 * @param {string} prompt
 * @param {string} type
 * @returns {string[]}
 */
function schemaLines(prompt, type) {
  const lines = prompt.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`=== ${type} `));
  assert.ok(start >= 0, `${type} has a section in the prompt`);
  const schemaAt = lines.indexOf('Content schema:', start);
  const out = [];
  for (let i = schemaAt + 1; i < lines.length && lines[i].startsWith('- '); i++)
    out.push(lines[i]);
  return out;
}

test('B453: an essential field that is not required is marked in the generator prompt', () => {
  const field = SLIDE_TYPES['image-slide'].fields.find(
    (f) => f.key === 'image',
  );
  assert.equal(field.essential, true);
  assert.notEqual(field.required, true);

  const lines = schemaLines(buildSlideTypesPrompt(), 'image-slide');
  assert.ok(
    lines.includes('- image: string (optional, essential)'),
    lines.join('\n'),
  );
  // A field that is not essential carries no mark.
  assert.ok(lines.includes('- caption: string (optional)'), lines.join('\n'));
});

test('B453: an essential list is marked for its first entry', () => {
  const lines = schemaLines(buildSlideTypesPrompt(), 'list-slide');
  const items = lines.find((l) => l.startsWith('- items: array'));
  assert.ok(items?.endsWith('(essential: first entry)'), items);
});

test('B453: the prompt tells the generator to fill essential text fields', () => {
  assert.match(
    buildSlideTypesPrompt(),
    /Fill every text field marked "essential"/,
  );
});

test('B590: an essential image stays empty rather than invented', () => {
  // An empty essential picture is what makes a slide incomplete; a stock
  // photo or an invented URL would hide that from the author.
  assert.match(
    buildSlideTypesPrompt(),
    /Image fields are the exception: never invent an image URL/,
  );
});

test('one-shot prompts use exactly the core types in the offered catalog', () => {
  const disabledSlideTypes = ['quote-slide'];
  const prompt = buildSlideTypesPrompt({ disabledSlideTypes });
  const offered = [...prompt.matchAll(/^=== ([\w-]+) - /gm)].map((m) => m[1]);
  assert.deepEqual(offered, getOfferedSlideTypes(disabledSlideTypes));
  assert.ok(!offered.includes('follow-invite-slide'));
});

/**
 * The agent-facing content schema refuses a link value the field-type
 * validator refuses (D131): a `url` or `email` is a string to JSON, but its
 * value becomes an `href`, so the MCP write path answers in the same words.
 *
 * Run with: node --test tests/content-schema-links.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSlideContent } from '../server/utils/ai/schemas/content-schema.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

test('an end slide with a bare domain or a non-address is refused, field by field', () => {
  const def = SLIDE_TYPES['end-slide'];
  const content = structuredClone(def.defaults);
  const bad = validateSlideContent(def, {
    ...content,
    contactUrl: 'example.com',
    contactEmail: 'robin',
  });
  assert.equal(bad.valid, false);
  assert.deepEqual(
    bad.issues.map((i) => [i.path.join('.'), i.message]).sort(),
    [
      ['contactEmail', 'must be an email address'],
      [
        'contactUrl',
        'must be an http(s), mailto, or root-relative URL, or a slide jump (#slide:<id>, #N)',
      ],
    ],
  );
  const good = validateSlideContent(def, {
    ...content,
    contactUrl: 'https://example.com',
    contactEmail: 'robin@example.com',
    social1Url: '',
  });
  assert.equal(good.valid, true);
});

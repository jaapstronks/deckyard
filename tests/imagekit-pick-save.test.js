/**
 * An ImageKit pick in any single-image field saves (DY-770, D162).
 *
 * The editor keeps the picked file's ImageKit id beside the URL as
 * provenance: `applyPickMeta` writes `content.imagekitFileId` for every
 * top-level single-image field, `slideBgImage` included, so on every type.
 * v1.91.0 (D359) refused every top-level key a type does not declare, and no
 * type declared this one, so the next save of a slide with a fresh pick was
 * refused with `unknown_field`. The key is now declared for every type
 * (`PROVENANCE_SLIDE_CONTENT_KEYS`), which also keeps migration 102 from
 * stripping it: that migration removes exactly what `undeclaredContentKeys`
 * returns.
 *
 * Pinned through the real write route: `applyPickMeta` mutates the content,
 * `assertValidSlideFields` judges it as the save does (`previousSlide` set).
 *
 * Run with: node --test tests/imagekit-pick-save.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { undeclaredContentKeys } from '../shared/slide-types/declared-keys.js';
import { validateSlideFields } from '../shared/slide-types/presentation.js';
import { applyPickMeta } from '../client/views/editor/media/apply-pick.js';

const PICK = { url: '/media/own-copy.jpg', providerId: 'ik-file-1' };

/** Every [type, key] whose top-level field is a single image. */
function singleImageFields() {
  const out = [];
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    for (const field of def.fields || []) {
      if (field?.type === 'image') out.push([name, field.key]);
    }
  }
  return out;
}

test('every type has at least one single-image field (slideBgImage)', () => {
  const types = new Set(singleImageFields().map(([name]) => name));
  for (const name of Object.keys(SLIDE_TYPES)) {
    assert.ok(types.has(name), `${name} has a single-image field`);
  }
});

test('an ImageKit pick in each single-image field passes the save', () => {
  for (const [name, key] of singleImageFields()) {
    const def = SLIDE_TYPES[name];
    const before = {
      id: 's1',
      type: name,
      content: structuredClone(def.defaults || {}),
    };
    const after = structuredClone(before);
    after.content[key] = PICK.url;
    applyPickMeta({
      picked: PICK,
      content: after.content,
      providerIdKey: 'imagekitFileId',
    });
    assert.equal(after.content.imagekitFileId, PICK.providerId);

    const refused = validateSlideFields(after, {
      slideTypes: SLIDE_TYPES,
      previousSlide: before,
    }).filter((p) => p.code === 'unknown_field');
    assert.deepEqual(refused, [], `${name}.${key}: pick then save`);
  }
});

test('migration 102 keeps the provenance key on every type', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    assert.deepEqual(
      undeclaredContentKeys(def, { imagekitFileId: 'ik-file-1' }),
      [],
      name,
    );
  }
});

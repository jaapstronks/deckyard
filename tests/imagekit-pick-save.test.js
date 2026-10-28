/**
 * An ImageKit pick in a single-image field saves (DY-770, D162).
 *
 * The editor keeps the picked file's ImageKit id beside the URL as
 * provenance: `applyPickMeta` writes `content.imagekitFileId` for a top-level
 * single-image field that takes a library pick (`single-image.js`, and
 * `pick-missing-picture.js` for the same fields). The background has its own
 * picker (`title-bg-image.js`) that writes the URL only. v1.91.0 (D359)
 * refused every top-level key a type does not declare, and no type declared
 * this one, so the next save of a slide with a fresh pick was refused with
 * `unknown_field`. The key is now declared on exactly the types with such a
 * field (`nonFieldContentKeys`), which also keeps migration 102 from
 * stripping it there: that migration removes what `undeclaredContentKeys`
 * returns.
 *
 * Pinned through the real write route: `applyPickMeta` mutates the content,
 * `validateSlideFields` judges it as the save does (`previousSlide` set).
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

/** Every [type, key] whose top-level field takes a library image pick. */
function pickFields() {
  const out = [];
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    for (const field of def.fields || []) {
      if (field?.type === 'image' && field.presetSource !== 'backgrounds') {
        out.push([name, field.key]);
      }
    }
  }
  return out;
}

const PICK_TYPES = new Set(pickFields().map(([name]) => name));

test('the image slides take a library pick', () => {
  assert.ok(PICK_TYPES.has('image-slide'));
  assert.ok(PICK_TYPES.has('image-text-slide'));
});

test('an ImageKit pick in each pick field passes the save', () => {
  for (const [name, key] of pickFields()) {
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

test('migration 102 keeps the provenance key where a pick writes it, and only there', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    assert.deepEqual(
      undeclaredContentKeys(def, { imagekitFileId: 'ik-file-1' }),
      PICK_TYPES.has(name) ? [] : ['imagekitFileId'],
      name,
    );
  }
});

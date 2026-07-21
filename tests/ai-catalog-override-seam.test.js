/**
 * OSS catalog seam: fork override of a *core* slide type's AI copy.
 *
 * The `custom/slide-types/*.js` loader already *adds* new types; this covers the
 * "override" half — `custom/ai/catalog.js` replacing a core type's
 * description/bestFor/notFor while the core schema/allowedIcons survive.
 *
 *  - loadCustomCatalogOverrides loads a fork file, keeps only object-valued
 *    entries for known types, strips unrecognised fields, and stays
 *    silent-and-empty when the file is absent.
 *  - mergeCustomAiCatalog overlays a partial onto the matching core entry
 *    (override) and sets a brand-new entry as-is (add).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  getCoreSlideCatalog,
  mergeCustomAiCatalog,
  SLIDE_TYPE_CATALOG,
} from '../server/utils/ai/slide-catalog/definitions.js';
import { loadCustomCatalogOverrides } from '../server/utils/ai/slide-catalog/custom-catalog-loader.js';

test('loadCustomCatalogOverrides: absent file resolves to an empty map', async () => {
  const none = await loadCustomCatalogOverrides({ file: '/no/such/custom/ai/catalog.js' });
  assert.deepEqual(none, {});
});

test('loadCustomCatalogOverrides: known type kept + fields filtered, unknowns/non-objects dropped', async () => {
  const file = fileURLToPath(new URL('./fixtures/custom-ai-catalog.fixture.js', import.meta.url));
  const knownTypes = new Set(Object.keys(getCoreSlideCatalog()));
  const loaded = await loadCustomCatalogOverrides({ file, knownTypes });

  assert.deepEqual(Object.keys(loaded), ['content-slide'], 'only the valid known override survives');
  // Unrecognised field is stripped; only overridable fields remain.
  assert.deepEqual(loaded['content-slide'], {
    description: 'FORK content description',
    bestFor: ['fork use'],
  });
});

test('mergeCustomAiCatalog: overlays a partial onto the core entry (keeps core schema)', () => {
  const core = getCoreSlideCatalog();
  const coreContent = core['content-slide'];
  assert.ok(coreContent && coreContent.schema, 'precondition: core content-slide has a schema');

  try {
    mergeCustomAiCatalog({
      'content-slide': { description: 'FORK content description' },
    });
    const merged = SLIDE_TYPE_CATALOG['content-slide'];
    assert.equal(merged.description, 'FORK content description', 'description overridden');
    assert.deepEqual(merged.schema, coreContent.schema, 'core schema survives the override');
    assert.deepEqual(merged.bestFor, coreContent.bestFor, 'un-overridden fields keep core copy');
    // The core catalog object itself is not mutated.
    assert.notEqual(core['content-slide'].description, 'FORK content description');
  } finally {
    mergeCustomAiCatalog({}); // reset SLIDE_TYPE_CATALOG back to pure core
  }
});

test('mergeCustomAiCatalog: sets a brand-new type as-is (add)', () => {
  try {
    const newEntry = {
      category: 'content',
      description: 'a fork-only type',
      bestFor: ['x'],
      notFor: [],
      schema: { type: 'object' },
      isCustom: true,
    };
    mergeCustomAiCatalog({ 'fork-only-slide': newEntry });
    assert.deepEqual(SLIDE_TYPE_CATALOG['fork-only-slide'], newEntry);
    assert.ok(!('fork-only-slide' in getCoreSlideCatalog()), 'core catalog untouched');
  } finally {
    mergeCustomAiCatalog({});
  }
});

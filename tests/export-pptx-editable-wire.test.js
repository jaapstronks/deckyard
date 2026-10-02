/**
 * What the editable PowerPoint tells the editor, before and after the export
 * (B586, D141).
 *
 * Before: the inspector says "this slide is an image in the editable
 * PowerPoint" for a type the export photographs. The editor holds the
 * `/api/slide-types` response, not the registry, so that hint can only read the
 * `fidelity` facet if the response carries it, resolved, for every type. After:
 * the export names the slides that became pictures in a response header, since
 * the file has no channel of its own for a message.
 *
 * Run with: node --test tests/export-pptx-editable-wire.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  exportFidelity,
  needsNativeComposition,
  resolvedFidelities,
} from '../shared/slide-types/fidelity.js';
import { IMAGE_SLIDES_HEADER } from '../shared/export-headers.js';
import { imageSlidesHeaders } from '../server/export/pptx.js';
import { handleSlideTypes } from '../server/routes/api/slide-types.js';

/** Drive the route the way the server does and hand back the parsed body. */
async function fetchMeta() {
  let body = '';
  const res = {
    writeHead() {},
    end(chunk) {
      body = chunk;
    },
  };
  await handleSlideTypes({
    req: { method: 'GET' },
    res,
    url: new URL('http://localhost/api/slide-types'),
    authedUser: null,
  });
  return JSON.parse(body);
}

test('every registered type is served the fidelity the export will use', async () => {
  const meta = await fetchMeta();
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    assert.deepEqual(
      meta[name]?.fidelity,
      { pptx: exportFidelity(def, 'pptx') },
      `${name}: fidelity`,
    );
    // The editor asks the same predicate the export dispatches on, of what it
    // holds; the answer has to survive the JSON trip unchanged.
    assert.equal(
      needsNativeComposition(meta[name], 'pptx'),
      needsNativeComposition(def, 'pptx'),
      `${name}: the wire and the registry disagree on the hint`,
    );
  }
});

test('a type with nowhere to declare is served the raster the export uses', () => {
  assert.deepEqual(resolvedFidelities(null), { pptx: 'raster' });
  assert.deepEqual(resolvedFidelities({ fidelity: { pptx: 'shiny' } }), {
    pptx: 'raster',
  });
});

test('the image slides travel as one comma-separated header, or not at all', () => {
  assert.deepEqual(imageSlidesHeaders([3, 7]), {
    [IMAGE_SLIDES_HEADER]: '3,7',
  });
  assert.deepEqual(imageSlidesHeaders([]), {});
});

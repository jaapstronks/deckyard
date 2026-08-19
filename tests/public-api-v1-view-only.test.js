/**
 * B62 vondst 12 — the public-API v1 presentation payload exposes `isViewOnly`.
 *
 * `GET /api/v1/presentations?viewOnly=true` filters the list on `isViewOnly`,
 * but before B62 no response payload carried that field: a consumer could
 * filter on a property it could never see. The sanitizer now emits it, so the
 * documented filter reads a value the payload also returns.
 *
 * Unit-level against the exported sanitizer (storage-free).
 *
 * Run with: node --test tests/public-api-v1-view-only.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { sanitizePresentation } =
  await import('../server/routes/public-api/v1/presentations.js');

test('sanitizePresentation exposes isViewOnly=true for a view-only deck', () => {
  const out = sanitizePresentation({
    id: 'd1',
    title: 'T',
    visibility: 'organization',
    isViewOnly: true,
  });
  assert.equal(out.isViewOnly, true);
});

test('sanitizePresentation exposes isViewOnly=false for an editable deck', () => {
  const out = sanitizePresentation({
    id: 'd2',
    title: 'T',
    visibility: 'organization',
    isViewOnly: false,
  });
  assert.equal(out.isViewOnly, false);
});

test('sanitizePresentation defaults a missing isViewOnly to false (never undefined)', () => {
  const out = sanitizePresentation({
    id: 'd3',
    title: 'T',
    visibility: 'private',
  });
  assert.equal(
    out.isViewOnly,
    false,
    'the field is always present as a boolean',
  );
});

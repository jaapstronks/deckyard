/**
 * The identity fields a version snapshot must not carry (T10, PR D).
 *
 * The database half — that the stored snapshot is clean and that restore still
 * works, including for the identity-bearing rows written before this change —
 * lives in `tests/pg/version-snapshot-identity.pgtest.js`. This file pins the
 * pure part: the field list itself, and that stripping never touches the
 * caller's object.
 *
 * That second property is not cosmetic. Every caller hands
 * `createPresentationVersion` the live presentation object it just read from
 * `getPresentation`, which may be a cache entry
 * (`server/storage/presentations/cache.js`) and is used again afterwards — the
 * restore route reads it for the pre-restore snapshot and then answers the
 * request from it. A mutating strip would erase the owner from a cached deck.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAPSHOT_IDENTITY_FIELDS,
  stripIdentityForSnapshot,
} from '../server/storage/presentations/snapshot-identity.js';
import { mapPresentationRow } from '../server/storage/presentations/index.js';

/** A presentation object in the shape `mapPresentationRow` produces. */
function presentation() {
  return mapPresentationRow({
    id: 'deck-1',
    organization_id: 'org-1',
    title: 'Deck',
    description: 'A deck',
    theme: 'midnight',
    lang: 'nl',
    visibility: 'private',
    revision: 7,
    owner_user_id: 'user-owner',
    owner_email: 'owner@example.com',
    created_by_user_id: 'user-creator',
    created_by: 'creator@example.com',
    updated_by_user_id: 'user-editor',
    updated_by: 'editor@example.com',
    trashed_by: 'trasher@example.com',
    settings: { a: 1 },
    i18n: { nl: {} },
    slides: [{ id: 's1', type: 'title-slide', content: {} }],
  });
}

test('every identity field a presentation carries is on the strip list', () => {
  // The list is the contract, so it must not silently miss a field that
  // `mapPresentationRow` adds later. Anything that reads as a person belongs
  // on it; `organizationId` is tenancy, not identity, and stays (see the
  // module doc).
  const identityish = Object.keys(presentation()).filter((key) =>
    /^(owner|createdBy|updatedBy|trashedBy)/.test(key),
  );

  assert.deepEqual(
    identityish.sort(),
    [...SNAPSHOT_IDENTITY_FIELDS].sort(),
    'a presentation grew an identity field that snapshots would still embed',
  );
});

test('stripping removes exactly the identity fields', () => {
  const stripped = stripIdentityForSnapshot(presentation());

  for (const field of SNAPSHOT_IDENTITY_FIELDS) {
    assert.equal(
      field in stripped,
      false,
      `${field} must not be in the snapshot`,
    );
  }

  // Everything a restore actually consumes survives.
  assert.equal(stripped.title, 'Deck');
  assert.equal(stripped.description, 'A deck');
  assert.equal(stripped.revision, 7);
  assert.deepEqual(stripped.settings, { a: 1 });
  assert.deepEqual(stripped.i18n, { nl: {} });
  assert.equal(stripped.slides.length, 1);
  // Tenancy and presentation metadata are not identity.
  assert.equal(stripped.organizationId, 'org-1');
  assert.equal(stripped.theme, 'midnight');
});

test("stripping copies and never mutates the caller's presentation", () => {
  const pres = presentation();
  const before = JSON.stringify(pres);

  const stripped = stripIdentityForSnapshot(pres);

  assert.notEqual(stripped, pres, 'a copy, not the same object');
  assert.equal(JSON.stringify(pres), before, 'the live deck is untouched');
  assert.equal(pres.ownerEmail, 'owner@example.com');
});

test('a non-object passes through unchanged', () => {
  assert.equal(stripIdentityForSnapshot(null), null);
  assert.equal(stripIdentityForSnapshot(undefined), undefined);
  assert.equal(stripIdentityForSnapshot('deck'), 'deck');
});

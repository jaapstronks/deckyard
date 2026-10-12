import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { testScope } from './helpers/storage-scope.js';
import { updatePublishedSlug } from '../server/storage/published.js';
import { errorToResponse } from '../server/utils/errors.js';

const scope = testScope(process.cwd());

test('publish rename refuses invalid input with a field and leaves storage untouched', async () => {
  const db = createFakeDb({
    published_presentations: [
      {
        id: 'abcd1234',
        presentation_id: 'deck',
        organization_id: scope.organizationId,
        title: 'Title',
        slug: 'original',
      },
    ],
  });
  __setTestDb(db);
  try {
    for (const slug of [
      '',
      ' Two Words ',
      'café',
      '-slug',
      'slug-',
      'a'.repeat(81),
      null,
      123,
    ]) {
      await assert.rejects(
        updatePublishedSlug(scope, 'abcd1234', slug),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(errorToResponse(err).details.field, 'slug');
          return true;
        },
      );
      assert.equal(db.__tables.published_presentations[0].slug, 'original');
    }
    const result = await updatePublishedSlug(scope, 'abcd1234', 'new-slug');
    assert.equal(result.slug, 'new-slug');
    assert.equal(db.__tables.published_presentations[0].slug, 'new-slug');
  } finally {
    __setTestDb(null);
  }
});

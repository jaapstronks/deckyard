import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STORAGE_MODE = 'postgres';
process.env.MULTI_ORG_ENABLED = 'true';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { getPopularPresentations } =
  await import('../server/routes/api/presentations/popular.js');

// The popularity query uses aggregate callback joins, which the in-memory
// double deliberately does not implement. Supply its projected candidates,
// keeping collaborator authorization and all subsequent reads real.
test('popular keeps a private published deck for its collaborator in the request organization', async () => {
  const organizationId = 'popular-org-beta';
  const email = 'popular-reader@example.test';
  const candidates = ['popular-shared', 'popular-unshared'].map((id) => ({
    id,
    title: id,
    visibility: 'private',
    owner_user_id: 'another-user',
    slides: [],
  }));
  const db = createFakeDb({
    presentations: candidates.map((row) => ({
      ...row,
      organization_id: organizationId,
    })),
    presentation_collaborators: [
      {
        presentation_id: 'popular-shared',
        organization_id: organizationId,
        user_email: email,
        permission: 'view',
        revoked_at: null,
      },
    ],
  });
  const selectFrom = db.selectFrom.bind(db);
  db.selectFrom = (table) => {
    if (table !== 'presentations as p') return selectFrom(table);
    const query = new Proxy(
      {},
      {
        get(_target, method) {
          if (method === 'execute') return async () => candidates;
          if (method === 'where') {
            return (...args) => {
              if (args[0] === 'p.organization_id') {
                assert.equal(args[2], organizationId);
              }
              return query;
            };
          }
          return () => query;
        },
      },
    );
    return query;
  };
  __setTestDb(db);
  try {
    const result = await getPopularPresentations({
      organizationId,
      user: { id: 'popular-reader', email, organizationId },
    });
    assert.deepEqual(
      result.map((deck) => deck.id),
      ['popular-shared'],
    );
  } finally {
    __setTestDb(null);
  }
});

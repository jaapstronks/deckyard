/**
 * Integration tests for MCP per-deck access enforcement
 * (loadPresentationChecked), against the Postgres adapter on the in-memory
 * database double (tests/helpers/fake-db.js).
 *
 * Regression guard: MCP mutating tools (update_slide, add_slide, remove_slide,
 * reorder_slides, convert_slide, iterate_presentation, append_slides,
 * compress_presentation) fetched any deck by id and wrote it without an
 * owner/collaborator check. All by-id tools now route through
 * loadPresentationChecked.
 *
 * Run with: node --test tests/mcp/mcp-presentation-access.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { testScope } from '../helpers/storage-scope.js';
import { userRows } from '../helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../../server/storage/lifecycle.js');
const { loadPresentationChecked } =
  await import('../../server/mcp/presentation-access.js');
const { createPresentation, updatePresentation } =
  await import('../../server/storage/presentations/index.js');

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

describe('loadPresentationChecked', () => {
  let privateId;
  let organizationId;
  let viewOnlyId;

  before(async () => {
    __setTestDb(
      createFakeDb({
        organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
        // Both people need a `users` row: a deck's owner id is resolved from
        // the address at create, and ownership is decided on that id alone
        // (shared/identity-match.js).
        users: userRows(OWNER, OTHER),
      }),
    );
    await initializeStorage();

    const privateDeck = await createPresentation(testScope(), {
      title: 'Private deck',
      ownerEmail: OWNER,
    });
    privateId = privateDeck.id;

    const organizationDeck = await createPresentation(testScope(), {
      title: 'Organization deck',
      ownerEmail: OWNER,
    });
    organizationId = organizationDeck.id;
    await updatePresentation(
      testScope(),
      organizationId,
      {
        ...organizationDeck,
        visibility: 'organization',
      },
      { allowVisibilityChange: true },
    );

    const viewOnlyDeck = await createPresentation(testScope(), {
      title: 'View-only organization deck',
      ownerEmail: OWNER,
    });
    viewOnlyId = viewOnlyDeck.id;
    await updatePresentation(
      testScope(),
      viewOnlyId,
      {
        ...viewOnlyDeck,
        visibility: 'organization',
        isViewOnly: true,
      },
      { allowVisibilityChange: true, allowViewOnlyChange: true },
    );
  });

  after(async () => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  it('throws "not found" (404) for a nonexistent deck', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), 'nope-does-not-exist', OWNER),
      { name: 'NotFoundError', statusCode: 404 },
    );
  });

  it('lets the owner read and write their private deck', async () => {
    const read = await loadPresentationChecked(testScope(), privateId, OWNER);
    assert.equal(read.id, privateId);
    const write = await loadPresentationChecked(testScope(), privateId, OWNER, {
      access: 'write',
    });
    assert.equal(write.id, privateId);
  });

  // D255: an unreadable deck is 403, an absent one 404, as on the other two
  // contracts; the merged "not found or not accessible" answer is gone.
  it('refuses a private deck to another user (read) with 403', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), privateId, OTHER),
      { name: 'ForbiddenError', statusCode: 403 },
    );
  });

  it('blocks another user from writing a private deck', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), privateId, OTHER, {
        access: 'write',
      }),
      { name: 'ForbiddenError', statusCode: 403 },
    );
  });

  it('allows read and write on an organization deck for any organization user', async () => {
    const read = await loadPresentationChecked(
      testScope(),
      organizationId,
      OTHER,
    );
    assert.equal(read.id, organizationId);
    const write = await loadPresentationChecked(
      testScope(),
      organizationId,
      OTHER,
      { access: 'write' },
    );
    assert.equal(write.id, organizationId);
  });

  it('view-only organization decks are readable but not writable by non-owners', async () => {
    const read = await loadPresentationChecked(testScope(), viewOnlyId, OTHER);
    assert.equal(read.id, viewOnlyId);
    await assert.rejects(
      loadPresentationChecked(testScope(), viewOnlyId, OTHER, {
        access: 'write',
      }),
      /read-only access/,
    );
  });

  it('delete access is owner-only', async () => {
    const own = await loadPresentationChecked(
      testScope(),
      organizationId,
      OWNER,
      { access: 'delete' },
    );
    assert.equal(own.id, organizationId);
    await assert.rejects(
      loadPresentationChecked(testScope(), organizationId, OTHER, {
        access: 'delete',
      }),
      /Only the presentation owner can delete it/,
    );
  });

  it('grants everything when no owner is configured (trusted local stdio)', async () => {
    for (const access of ['read', 'write', 'delete', 'manage', 'comment']) {
      const pres = await loadPresentationChecked(testScope(), privateId, null, {
        access,
      });
      assert.equal(pres.id, privateId, access);
    }
  });

  it('still answers 404 for an absent deck without an owner', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), 'nope-does-not-exist', null),
      { name: 'NotFoundError' },
    );
  });
});

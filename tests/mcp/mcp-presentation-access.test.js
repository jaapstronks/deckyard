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

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../../server/storage/adapters/index.js'
);
const { loadPresentationChecked } = await import('../../server/mcp/presentation-access.js');
const {
  createPresentation,
  updatePresentation,
} = await import('../../server/storage/presentations/index.js');

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

describe('loadPresentationChecked', () => {
  let privateId;
  let workspaceId;
  let viewOnlyId;

  before(async () => {
    __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
    await initializeStorage();

    const privateDeck = await createPresentation(testScope(), {
      title: 'Private deck',
      ownerEmail: OWNER,
    });
    privateId = privateDeck.id;

    const workspaceDeck = await createPresentation(testScope(), {
      title: 'Workspace deck',
      ownerEmail: OWNER,
    });
    workspaceId = workspaceDeck.id;
    await updatePresentation(testScope(), workspaceId, {
      ...workspaceDeck,
      scope: 'workspace',
    }, { allowScopeChange: true });

    const viewOnlyDeck = await createPresentation(testScope(), {
      title: 'View-only workspace deck',
      ownerEmail: OWNER,
    });
    viewOnlyId = viewOnlyDeck.id;
    await updatePresentation(testScope(), viewOnlyId, {
      ...viewOnlyDeck,
      scope: 'workspace',
      isViewOnly: true,
    }, { allowScopeChange: true, allowViewOnlyChange: true });
  });

  after(async () => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  it('throws "not found" for a nonexistent deck', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), 'nope-does-not-exist', OWNER),
      /Presentation not found: nope-does-not-exist/
    );
  });

  it('lets the owner read and write their private deck', async () => {
    const read = await loadPresentationChecked(testScope(), privateId, OWNER);
    assert.equal(read.id, privateId);
    const write = await loadPresentationChecked(testScope(), privateId, OWNER, { access: 'write' });
    assert.equal(write.id, privateId);
  });

  it('hides a private deck from another user (read), without leaking existence', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), privateId, OTHER),
      /not found or not accessible/
    );
  });

  it('blocks another user from writing a private deck', async () => {
    await assert.rejects(
      loadPresentationChecked(testScope(), privateId, OTHER, { access: 'write' }),
      /not found or not accessible/
    );
  });

  it('allows read and write on a workspace deck for any workspace user', async () => {
    const read = await loadPresentationChecked(testScope(), workspaceId, OTHER);
    assert.equal(read.id, workspaceId);
    const write = await loadPresentationChecked(testScope(), workspaceId, OTHER, { access: 'write' });
    assert.equal(write.id, workspaceId);
  });

  it('view-only workspace decks are readable but not writable by non-owners', async () => {
    const read = await loadPresentationChecked(testScope(), viewOnlyId, OTHER);
    assert.equal(read.id, viewOnlyId);
    await assert.rejects(
      loadPresentationChecked(testScope(), viewOnlyId, OTHER, { access: 'write' }),
      /read-only access/
    );
  });

  it('delete access is owner-only', async () => {
    const own = await loadPresentationChecked(testScope(), workspaceId, OWNER, { access: 'delete' });
    assert.equal(own.id, workspaceId);
    await assert.rejects(
      loadPresentationChecked(testScope(), workspaceId, OTHER, { access: 'delete' }),
      /Only the presentation owner can delete it/
    );
  });

  it('skips per-deck checks when no owner is configured (trusted local stdio)', async () => {
    const read = await loadPresentationChecked(testScope(), privateId, null);
    assert.equal(read.id, privateId);
    const write = await loadPresentationChecked(testScope(), privateId, null, { access: 'write' });
    assert.equal(write.id, privateId);
  });
});

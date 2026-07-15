/**
 * Integration tests for MCP per-deck access enforcement
 * (loadPresentationChecked), using file-mode storage in a temp repoRoot.
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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadPresentationChecked } from '../../server/mcp/presentation-access.js';
import {
  createPresentation,
  updatePresentation,
} from '../../server/storage/presentations.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

describe('loadPresentationChecked (file-mode storage)', () => {
  let tempRoot;
  let privateId;
  let workspaceId;
  let viewOnlyId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-authz-test-'));

    const privateDeck = await createPresentation(tempRoot, {
      title: 'Private deck',
      ownerEmail: OWNER,
    });
    privateId = privateDeck.id;

    const workspaceDeck = await createPresentation(tempRoot, {
      title: 'Workspace deck',
      ownerEmail: OWNER,
    });
    workspaceId = workspaceDeck.id;
    await updatePresentation(tempRoot, workspaceId, {
      ...workspaceDeck,
      scope: 'workspace',
    }, { allowScopeChange: true });

    const viewOnlyDeck = await createPresentation(tempRoot, {
      title: 'View-only workspace deck',
      ownerEmail: OWNER,
    });
    viewOnlyId = viewOnlyDeck.id;
    await updatePresentation(tempRoot, viewOnlyId, {
      ...viewOnlyDeck,
      scope: 'workspace',
      isViewOnly: true,
    }, { allowScopeChange: true });
  });

  after(async () => {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('throws "not found" for a nonexistent deck', async () => {
    await assert.rejects(
      loadPresentationChecked(tempRoot, 'nope-does-not-exist', OWNER),
      /Presentation not found: nope-does-not-exist/
    );
  });

  it('lets the owner read and write their private deck', async () => {
    const read = await loadPresentationChecked(tempRoot, privateId, OWNER);
    assert.equal(read.id, privateId);
    const write = await loadPresentationChecked(tempRoot, privateId, OWNER, { access: 'write' });
    assert.equal(write.id, privateId);
  });

  it('hides a private deck from another user (read), without leaking existence', async () => {
    await assert.rejects(
      loadPresentationChecked(tempRoot, privateId, OTHER),
      /not found or not accessible/
    );
  });

  it('blocks another user from writing a private deck', async () => {
    await assert.rejects(
      loadPresentationChecked(tempRoot, privateId, OTHER, { access: 'write' }),
      /not found or not accessible/
    );
  });

  it('allows read and write on a workspace deck for any workspace user', async () => {
    const read = await loadPresentationChecked(tempRoot, workspaceId, OTHER);
    assert.equal(read.id, workspaceId);
    const write = await loadPresentationChecked(tempRoot, workspaceId, OTHER, { access: 'write' });
    assert.equal(write.id, workspaceId);
  });

  it('view-only workspace decks are readable but not writable by non-owners', async () => {
    const read = await loadPresentationChecked(tempRoot, viewOnlyId, OTHER);
    assert.equal(read.id, viewOnlyId);
    await assert.rejects(
      loadPresentationChecked(tempRoot, viewOnlyId, OTHER, { access: 'write' }),
      /read-only access/
    );
  });

  it('delete access is owner-only', async () => {
    const own = await loadPresentationChecked(tempRoot, workspaceId, OWNER, { access: 'delete' });
    assert.equal(own.id, workspaceId);
    await assert.rejects(
      loadPresentationChecked(tempRoot, workspaceId, OTHER, { access: 'delete' }),
      /Only the presentation owner can delete it/
    );
  });

  it('skips per-deck checks when no owner is configured (trusted local stdio)', async () => {
    const read = await loadPresentationChecked(tempRoot, privateId, null);
    assert.equal(read.id, privateId);
    const write = await loadPresentationChecked(tempRoot, privateId, null, { access: 'write' });
    assert.equal(write.id, privateId);
  });
});

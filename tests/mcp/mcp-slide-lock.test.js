/**
 * Integration tests: MCP write tools pass the acting owner to
 * updatePresentation so the slide-lock policy can tell authors from
 * non-authors.
 *
 * Regression guard for the PR #27 follow-up: MCP tools called
 * updatePresentation without actorEmail, so the policy failed closed and
 * author-locked slides were read-only via MCP even for the author.
 * Expected behavior:
 * - the author (API-key session) can edit/remove their own locked slide
 * - a non-author with write access (workspace deck) still gets a 423
 * - a trusted local session (no owner configured) is not blocked, matching
 *   how per-deck access checks are skipped for it
 *
 * MCP tools use the baked-in repoRoot (server/config/paths.js), so storage
 * is redirected to a temp dir via the DATA_DIR override. node --test runs
 * each test file in its own process, so the env change does not leak.
 *
 * Run with: node --test tests/mcp/mcp-slide-lock.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';
import { repoRoot } from '../../server/config/paths.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../../server/storage/presentations.js';

const OWNER = 'owner@example.com';
const OTHER = 'collab@example.com';
const LOCKED_ID = '11111111-1111-4111-8111-111111111111';
const FREE_ID = '22222222-2222-4222-8222-222222222222';

describe('MCP tools — slide-lock enforcement with acting owner', () => {
  let tempDataDir;
  let server;
  let deckId;

  /** Call an MCP tool handler as a given session owner (null = trusted local). */
  const callTool = (name, args, ownerEmail = null) =>
    server.tools.get(name).handler(args, ownerEmail ? { ownerEmail } : undefined);

  /** Fresh read of the stored deck (bypasses any stale in-memory copies). */
  const loadStored = () => getPresentation(repoRoot, deckId);

  before(async () => {
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-slide-lock-test-'));
    process.env.DATA_DIR = tempDataDir;

    server = new McpServer();
    registerTools(server, {});

    const created = await createPresentation(repoRoot, {
      title: 'MCP lock deck',
      ownerEmail: OWNER,
      lang: 'nl',
    });
    deckId = created.id;

    // Workspace scope so the non-author has write access and reaches the
    // slide-lock policy instead of failing the per-deck access check.
    await updatePresentation(repoRoot, deckId, {
      ...created,
      scope: 'workspace',
    }, { allowScopeChange: true, actorEmail: OWNER });
  });

  after(async () => {
    delete process.env.DATA_DIR;
    if (tempDataDir) await fs.rm(tempDataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Reset to a known two-slide state: slide 0 author-locked, slide 1 free.
    const doc = structuredClone(await loadStored());
    const base = structuredClone(doc.slides[0]);
    doc.slides = [
      { ...structuredClone(base), id: LOCKED_ID, lockedByAuthor: true },
      { ...structuredClone(base), id: FREE_ID, lockedByAuthor: false },
    ];
    await updatePresentation(repoRoot, deckId, doc, { actorEmail: OWNER });
  });

  it('lets the author edit their own author-locked slide (the PR #27 follow-up)', async () => {
    const result = await callTool('update_slide', {
      presentationId: deckId,
      slideIndex: 0,
      content: { title: 'Door auteur via MCP' },
    }, OWNER);
    assert.equal(result.updated, true);

    const stored = await loadStored();
    assert.equal(
      stored.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Door auteur via MCP'
    );
  });

  it('still rejects a non-author editing an author-locked slide with 423', async () => {
    await assert.rejects(
      callTool('update_slide', {
        presentationId: deckId,
        slideIndex: 0,
        content: { title: 'Gehackt via MCP' },
      }, OTHER),
      (e) => e.statusCode === 423 && e.details?.lockKind === 'author' && e.details?.slideId === LOCKED_ID
    );

    // Nothing was written
    const stored = await loadStored();
    assert.notEqual(
      stored.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Gehackt via MCP'
    );
  });

  it('lets a non-author edit the unlocked slide next to a locked one', async () => {
    const result = await callTool('update_slide', {
      presentationId: deckId,
      slideIndex: 1,
      content: { title: 'Door collaborator' },
    }, OTHER);
    assert.equal(result.updated, true);

    const stored = await loadStored();
    assert.equal(
      stored.slides.find((s) => s.id === FREE_ID).content.title,
      'Door collaborator'
    );
  });

  it('rejects a non-author removing an author-locked slide with 423', async () => {
    await assert.rejects(
      callTool('remove_slide', { presentationId: deckId, slideIndex: 0 }, OTHER),
      (e) => e.statusCode === 423 && e.details?.lockKind === 'author'
    );

    const stored = await loadStored();
    assert.equal(stored.slides.length, 2);
  });

  it('lets the author remove their own author-locked slide', async () => {
    const result = await callTool('remove_slide', {
      presentationId: deckId,
      slideIndex: 0,
    }, OWNER);
    assert.equal(result.removed, true);

    const stored = await loadStored();
    assert.equal(stored.slides.length, 1);
    assert.equal(stored.slides[0].id, FREE_ID);
  });

  it('lets a non-author reorder slides (no content change)', async () => {
    const result = await callTool('reorder_slides', {
      presentationId: deckId,
      fromIndex: 0,
      toIndex: 1,
    }, OTHER);
    assert.equal(result.moved, true);

    const stored = await loadStored();
    assert.equal(stored.slides[0].id, FREE_ID);
  });

  it('does not block a trusted local session (no owner configured) on a locked slide', async () => {
    const result = await callTool('update_slide', {
      presentationId: deckId,
      slideIndex: 0,
      content: { title: 'Lokale stdio-sessie' },
    }, null);
    assert.equal(result.updated, true);

    const stored = await loadStored();
    assert.equal(
      stored.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Lokale stdio-sessie'
    );
  });
});

/**
 * Integration tests for the public API's per-deck access check
 * (getPresentationWithAccess), using file-mode storage in a temp repoRoot.
 *
 * Regression guard: the public API used canAccessPresentation
 * (owner/workspace only, no read/write distinction), so any workspace-scoped
 * deck was writable by every API key and collaborators were ignored. It now
 * uses the same collaborator-aware canRead/canWritePresentation checks as the
 * editor routes.
 *
 * Run with: node --test tests/public-api-authz.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getPresentationWithAccess } from '../server/routes/public-api/v1/middleware.js';
import {
  createPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

/** Minimal ctx with a response stub that records status + JSON body. */
function makeCtx(repoRoot, ownerEmail) {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
  return {
    repoRoot,
    res,
    apiKey: { id: 'test-key', tier: 'free', ownerEmail },
  };
}

describe('getPresentationWithAccess (file-mode storage)', () => {
  let tempRoot;
  let privateId;
  let viewOnlyId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'public-api-authz-test-'));

    const privateDeck = await createPresentation(tempRoot, {
      title: 'Private deck',
      ownerEmail: OWNER,
    });
    privateId = privateDeck.id;

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

  it('404s for a nonexistent deck', async () => {
    const ctx = makeCtx(tempRoot, OWNER);
    const { ok } = await getPresentationWithAccess(ctx, 'nope-does-not-exist');
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 404);
  });

  it('lets the key owner read and write their private deck', async () => {
    const read = await getPresentationWithAccess(makeCtx(tempRoot, OWNER), privateId);
    assert.equal(read.ok, true);
    assert.equal(read.pres.id, privateId);

    const write = await getPresentationWithAccess(
      makeCtx(tempRoot, OWNER), privateId, { access: 'write' }
    );
    assert.equal(write.ok, true);
  });

  it("403s another key's read of a private deck", async () => {
    const ctx = makeCtx(tempRoot, OTHER);
    const { ok } = await getPresentationWithAccess(ctx, privateId);
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
  });

  it("403s another key's write of a private deck", async () => {
    const ctx = makeCtx(tempRoot, OTHER);
    const { ok } = await getPresentationWithAccess(ctx, privateId, { access: 'write' });
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
  });

  it('view-only workspace deck: read ok, write 403 for non-owner keys', async () => {
    const read = await getPresentationWithAccess(makeCtx(tempRoot, OTHER), viewOnlyId);
    assert.equal(read.ok, true);

    const ctx = makeCtx(tempRoot, OTHER);
    const { ok } = await getPresentationWithAccess(ctx, viewOnlyId, { access: 'write' });
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
    assert.match(ctx.res.body.error, /read-only/);
  });
});

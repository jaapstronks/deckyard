/**
 * End-to-end test for collab live edits (phase 2, step 2): a real Hocuspocus
 * mount with COLLAB_LIVE_EDITS=true, two headless clients over the actual
 * WebSocket endpoint, concurrent edits converging, and the debounced
 * onStoreDocument persisting back to the deck JSON.
 *
 * Run with: node --test tests/collab-live-edits.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Enable collab + live edits before the mount reads the flags. Auth stays in
// its dev default (disabled → anonymous admin), same as the presence test.
process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { maybeAttachCollab, shutdownCollab } = await import('../server/collab/mount.js');
const { createPresentation, getPresentation } = await import(
  '../server/storage/presentations.js'
);
const { getYDocState } = await import('../server/storage/presentations/ydoc-state.js');
const { createPresenceSession } = await import('../client/lib/collab/presence-session.js');

/** Poll until `fn()` is truthy or the timeout elapses. */
async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

test('live edits: bootstrap, concurrent edits converge, JSON persists', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-live-edits-'));
  const pres = await createPresentation(repoRoot, {
    title: 'Live edits deck',
    ownerEmail: 'anonymous',
    lang: 'nl',
  });

  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, { repoRoot });
  assert.ok(hocuspocus, 'collab should mount');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/collab`;

  const alice = createPresenceSession({
    presentationId: pres.id,
    user: { email: 'alice@example.com', name: 'Alice' },
    url,
  });
  const bob = createPresenceSession({
    presentationId: pres.id,
    user: { email: 'bob@example.com', name: 'Bob' },
    url,
  });
  t.after(async () => {
    alice.destroy();
    bob.destroy();
    await shutdownCollab();
    await new Promise((resolve) => server.close(resolve));
    rmSync(repoRoot, { recursive: true, force: true });
  });

  const docA = alice._provider.document;
  const docB = bob._provider.document;

  // Server-side bootstrap syncs to both clients.
  await waitFor(() => docA.getMap('meta').get('extra') && docB.getMap('meta').get('extra'));
  assert.equal(docA.getMap('meta').get('title').get('nl').toString(), 'Live edits deck');

  // Concurrent edits: Alice prepends to the deck title, Bob edits the first
  // slide's title text. Both must converge on both clients.
  const titleA = docA.getMap('meta').get('title').get('nl');
  titleA.insert(0, 'Onze ');

  const slideTitleB = docB.getArray('slides').get(0).get('content').get('title').get('nl');
  slideTitleB.delete(0, slideTitleB.length);
  slideTitleB.insert(0, 'Door Bob bewerkt');

  await waitFor(
    () =>
      docB.getMap('meta').get('title').get('nl').toString() === 'Onze Live edits deck' &&
      docA.getArray('slides').get(0).get('content').get('title').get('nl').toString() ===
        'Door Bob bewerkt'
  );

  // The debounced store (2s) serializes back to the deck JSON.
  const updated = await waitFor(async () => {
    const p = await getPresentation(repoRoot, pres.id);
    return p?.title === 'Onze Live edits deck' && p?.slides?.[0]?.content?.title === 'Door Bob bewerkt'
      ? p
      : null;
  });
  assert.ok(updated.revision > pres.revision, 'facade bumped the revision');

  const bin = await getYDocState(repoRoot, pres.id);
  assert.ok(bin instanceof Uint8Array && bin.length > 0, 'doc binary stored');
});

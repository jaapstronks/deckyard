import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Enable the collab feature before the mount module reads it. Auth stays in
// its dev default (disabled → anonymous admin), except in the 401 subtest.
process.env.COLLAB_ENABLED = 'true';
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { maybeAttachCollab, shutdownCollab } = await import(
  '../server/collab/mount.js'
);
const { createPresentation } = await import(
  '../server/storage/presentations.js'
);
const { createPresenceSession } = await import(
  '../client/lib/collab/presence-session.js'
);

/** Poll until `fn()` is truthy or the timeout elapses. */
async function waitFor(fn, { timeout = 5000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function startCollabServer(repoRoot) {
  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, { repoRoot });
  assert.ok(hocuspocus, 'collab should mount when COLLAB_ENABLED=true');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `ws://127.0.0.1:${port}/collab` };
}

test('presence: two clients on the same deck see each other', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-collab-'));
  const pres = await createPresentation(repoRoot, {
    title: 'Collab test deck',
    ownerEmail: 'anonymous',
  });
  assert.ok(pres?.id, 'presentation should be created');

  const { server, url } = await startCollabServer(repoRoot);

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
  });

  // Both sides converge on seeing exactly one peer.
  await waitFor(
    () => alice.getPeers().length === 1 && bob.getPeers().length === 1
  );
  assert.equal(alice.getPeers()[0].user.email, 'bob@example.com');
  assert.equal(bob.getPeers()[0].user.name, 'Alice');
  assert.ok(bob.getPeers()[0].user.color, 'peers carry a presence color');

  // View + focus state propagates.
  alice.setViewSlide('slide-123');
  await waitFor(() => bob.getPeers()[0]?.view?.slideId === 'slide-123');

  alice.setFocusField('slide-123', 'items.0.title');
  await waitFor(
    () => bob.getPeers()[0]?.focus?.fieldPath === 'items.0.title'
  );

  // Disconnect cleans up presence for the remaining peer (no stale entries).
  bob.destroy();
  await waitFor(() => alice.getPeers().length === 0);
});

test('presence: unknown document is rejected', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-collab-'));
  const { server, url } = await startCollabServer(repoRoot);

  const session = createPresenceSession({
    presentationId: 'no-such-presentation',
    user: { email: 'alice@example.com', name: 'Alice' },
    url,
  });
  // Destroy the (reconnect-looping) client before closing the server, or
  // server.close() waits forever on the live socket.
  t.after(async () => {
    session.destroy();
    await shutdownCollab();
    await new Promise((resolve) => server.close(resolve));
  });

  // The server refuses the document (authorizeDocument throws 404): the
  // connection must never reach Connected-and-stay; peers stay empty.
  let becameConnected = false;
  session.onConnectionChange((connected) => {
    if (connected) becameConnected = true;
  });
  await new Promise((r) => setTimeout(r, 750));
  assert.equal(session.getPeers().length, 0);
  assert.equal(
    becameConnected && session._provider.isAuthenticated === true,
    false,
    'unauthorized document must not authenticate'
  );
});

test('presence: upgrade without a session is rejected when auth is on', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-collab-'));
  process.env.AUTH_ENABLED = 'true';
  process.env.AUTH_SECRET = 'test-secret-for-collab-auth';
  t.after(() => {
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_SECRET;
  });

  const { server, url } = await startCollabServer(repoRoot);

  // Raw WebSocket (no cookie): the upgrade must be refused with an HTTP error.
  let ws;
  const failure = await new Promise((resolve) => {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve('open'));
    ws.addEventListener('error', () => resolve('error'));
  });
  t.after(async () => {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    await shutdownCollab();
    await new Promise((resolve) => server.close(resolve));
  });
  assert.equal(failure, 'error', 'cookieless upgrade should be rejected');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sessions } from '../server/storage/live-sessions/state.js';
import { notifyDeckUpdatedForPresentation } from '../server/storage/live-sessions/sse.js';

/** The presenter scope the routes would pass (see server/storage/scope.js). */
function testScope(repoRoot) {
  return {
    repoRoot,
    organizationId: '00000000-0000-0000-0000-0000000000aa',
    actorEmail: null,
  };
}

function fakeSseClient() {
  const chunks = [];
  return {
    writable: true,
    writableEnded: false,
    write(message) {
      chunks.push(message);
      return true;
    },
    on() {},
    text: () => chunks.join(''),
  };
}

function seedSession(sessionId, presentationId, repoRoot) {
  const s = {
    sessionId,
    presentationId,
    organizationId: testScope(repoRoot).organizationId,
    state: { slideId: '', slideIndex: 0, updatedAt: Date.now() },
    clients: new Set(),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  sessions.set(sessionId, s);
  return s;
}

test.afterEach(() => sessions.clear());

test('notifyDeckUpdatedForPresentation broadcasts deckUpdated to session clients', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-deck-updated-'));
  const presentationId = 'pres-deck-updated-test';

  const session = seedSession('deck-updated-session', presentationId, repoRoot);
  const client = fakeSseClient();
  session.clients.add(client);

  const result = await notifyDeckUpdatedForPresentation(
    testScope(repoRoot),
    presentationId,
    {
      reason: 'test_mutation',
    },
  );
  assert.equal(result.ok, true);

  // The underlying broadcast is fire-and-forget; allow it to flush.
  await new Promise((resolve) => setTimeout(resolve, 25));

  const written = client.text();
  assert.match(written, /event: deckUpdated/);
  assert.match(written, /pres-deck-updated-test/);
  assert.match(written, /test_mutation/);
});

test('notifyDeckUpdatedForPresentation is a no-op without a live session', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-deck-updated-'));
  const result = await notifyDeckUpdatedForPresentation(
    testScope(repoRoot),
    'no-such-presentation',
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_live_session');
});

test('notifyDeckUpdatedForPresentation ignores sessions without clients', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-deck-updated-'));
  const presentationId = 'pres-no-clients-test';
  seedSession('no-clients-session', presentationId, repoRoot);

  const result = await notifyDeckUpdatedForPresentation(
    testScope(repoRoot),
    presentationId,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_live_session');
});

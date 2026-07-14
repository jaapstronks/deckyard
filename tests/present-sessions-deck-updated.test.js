import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPresentSession,
  getPresentSession,
} from '../server/storage/present-sessions/sessions.js';
import { notifyDeckUpdatedForPresentation } from '../server/storage/present-sessions/sse.js';

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

test('notifyDeckUpdatedForPresentation broadcasts deckUpdated to session clients', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-deck-updated-'));
  const presentationId = 'pres-deck-updated-test';

  const created = await createPresentSession(repoRoot, { presentationId });
  assert.ok(created?.sessionId, 'session should be created');

  const session = await getPresentSession(repoRoot, created.sessionId);
  const client = fakeSseClient();
  session.clients.add(client);

  const result = await notifyDeckUpdatedForPresentation(repoRoot, presentationId, {
    reason: 'test_mutation',
  });
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
  const result = await notifyDeckUpdatedForPresentation(repoRoot, 'no-such-presentation');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_live_session');
});

test('notifyDeckUpdatedForPresentation ignores sessions without clients', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-deck-updated-'));
  const presentationId = 'pres-no-clients-test';
  await createPresentSession(repoRoot, { presentationId });

  const result = await notifyDeckUpdatedForPresentation(repoRoot, presentationId);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_live_session');
});

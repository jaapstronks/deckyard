/**
 * writeUserSettings notification-merge semantics: a partial write (e.g. an
 * API consumer PUTting one preference) must not reset the other stored
 * opt-outs — per-key for emailByType, and the channel booleans.
 *
 * Run with: node --test tests/user-settings-notifications.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point storage at a scratch data dir before the module resolves paths.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-settings-'));
process.env.DATA_DIR = tmp;

const { readUserSettings, writeUserSettings } = await import('../server/storage/settings.js');

const repoRoot = tmp;
const email = 'merge@example.com';

describe('writeUserSettings notification merge', () => {
  it('a partial emailByType write keeps other stored opt-outs', async () => {
    await writeUserSettings(repoRoot, email, {
      notifications: { emailByType: { comment_reply: false } },
    });
    let s = await readUserSettings(repoRoot, email);
    assert.strictEqual(s.notifications.emailByType.comment_reply, false);

    await writeUserSettings(repoRoot, email, {
      notifications: { emailByType: { comment_created: false } },
    });
    s = await readUserSettings(repoRoot, email);
    assert.strictEqual(s.notifications.emailByType.comment_created, false);
    assert.strictEqual(s.notifications.emailByType.comment_reply, false);
    assert.strictEqual(s.notifications.emailByType.comment_mention, true);
  });

  it('a partial notifications write keeps channel opt-outs and defaultLevel', async () => {
    await writeUserSettings(repoRoot, email, {
      notifications: { emailEnabled: false, defaultLevel: 'watching' },
    });
    await writeUserSettings(repoRoot, email, {
      notifications: { slackEnabled: false },
    });
    const s = await readUserSettings(repoRoot, email);
    assert.strictEqual(s.notifications.emailEnabled, false);
    assert.strictEqual(s.notifications.slackEnabled, false);
    assert.strictEqual(s.notifications.defaultLevel, 'watching');
  });
});

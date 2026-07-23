/**
 * Regression tests for the gated theme switch.
 *
 * The shared write path hard-locks `theme` so a stray save can never flip a
 * deck's branding. The one sanctioned exception is the permission-checked
 * /change-theme route, which opts in with `allowThemeChange: true`. These tests
 * pin both halves: the default lock stays, and the flag lets a real switch
 * through (file-mode storage, which exercises server/storage/presentations/crud/write.js).
 *
 * Run with: node --test tests/change-theme-gated.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';

const OWNER = 'owner@example.com';

describe('updatePresentation — gated theme switch (file mode)', () => {
  let tempRoot;
  let deckId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'change-theme-gated-'));
    const created = await createPresentation(tempRoot, {
      title: 'Theme lock',
      ownerEmail: OWNER,
      lang: 'nl',
      theme: 'deckyard',
    });
    deckId = created.id;
    assert.equal(created.theme, 'deckyard', 'fixture should start on the deckyard theme');
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps the theme locked on a normal save (no allowThemeChange)', async () => {
    const doc = structuredClone(await getPresentation(tempRoot, deckId));
    doc.theme = 'midnight'; // a would-be switch coming in on the body
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      actorEmail: OWNER,
    });
    assert.equal(updated.theme, 'deckyard', 'default write path must ignore a theme change');

    const stored = await getPresentation(tempRoot, deckId);
    assert.equal(stored.theme, 'deckyard', 'nothing was persisted');
  });

  it('switches the theme when allowThemeChange is set (the /change-theme route)', async () => {
    const doc = structuredClone(await getPresentation(tempRoot, deckId));
    doc.theme = 'midnight';
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      actorEmail: OWNER,
      allowThemeChange: true,
    });
    assert.equal(updated.theme, 'midnight', 'gated write path must apply the new theme');

    const stored = await getPresentation(tempRoot, deckId);
    assert.equal(stored.theme, 'midnight', 'the switch was persisted');
  });

  it('leaves the theme untouched when the flag is set but no theme is provided', async () => {
    // The deck is now on 'midnight' from the previous test.
    const doc = structuredClone(await getPresentation(tempRoot, deckId));
    delete doc.theme;
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      actorEmail: OWNER,
      allowThemeChange: true,
    });
    assert.equal(updated.theme, 'midnight', 'a missing body theme falls back to the stored one');
  });
});

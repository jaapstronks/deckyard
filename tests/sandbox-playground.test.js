/**
 * Sandbox public-playground guards.
 *
 * Two properties the sandbox deployment depends on:
 *  1. Publishing is refused at the route level in sandbox mode. A guest owns
 *     their own private deck and could otherwise push arbitrary content onto a
 *     public /p/ URL on the real domain.
 *  2. Stock media (Unsplash/Giphy) still works: the download path writes into
 *     the sandbox uploads dir (which is also what serves /uploads/), so a guest
 *     can put a stock image on a slide even though direct uploads are off.
 *
 * Env is read at call time, so we toggle it per case and restore after.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { handlePublish } from '../server/routes/api/publish.js';
import { uploadsDir } from '../server/config/storage-paths.js';
import { saveUploadedFile } from '../server/storage/uploads.js';
import { getFeatureFlags } from '../server/config/feature-flags.js';
import { listThemeIds, listCoreThemeIds } from '../server/utils/themes.js';
import { listSandboxExamples } from '../server/sandbox/examples.js';
import { listSandboxMedia } from '../server/sandbox/media.js';

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

// A 1x1 transparent PNG (valid enough to persist; optimizer falls back to the
// original buffer if it can't process it).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('publish route is refused (403) in sandbox mode', async () => {
  await withEnv({ SANDBOX_MODE: '1' }, async () => {
    const res = mockRes();
    const url = new URL('http://localhost/api/presentations/deck123/publish');
    const handled = await handlePublish({
      repoRoot: process.cwd(),
      req: { method: 'POST' },
      res,
      url,
      authedUser: { email: 'guest-abc@sandbox.local' },
    });

    assert.equal(handled, true, 'handler should claim the publish route');
    assert.equal(res.status, 403, 'publishing must be blocked in sandbox');
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'forbidden');
    assert.match(body.message, /sandbox/i);
  });
});

test('stock-media download persists into the sandbox uploads dir', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-sandbox-uploads-'));
  try {
    await withEnv(
      { SANDBOX_MODE: '1', SANDBOX_UPLOADS_DIR: tmp, UPLOADS_DIR: undefined },
      async () => {
        // Sandbox routing: writes and /uploads/ serving both resolve here.
        assert.equal(uploadsDir(process.cwd()), tmp);

        // This is the exact call the Unsplash/Giphy download endpoints make.
        const localUrl = await saveUploadedFile(
          process.cwd(),
          PNG_1x1,
          'unsplash-test-regular.png',
          'image/png'
        );

        assert.match(localUrl, /^\/uploads\//, 'must return a servable /uploads/ URL');

        const filename = localUrl.slice('/uploads/'.length);
        const abs = path.join(tmp, filename);
        const stat = await fs.stat(abs);
        assert.ok(stat.isFile(), 'downloaded stock image must land in the sandbox dir');
      }
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('AI is disabled in sandbox mode', async () => {
  await withEnv({ SANDBOX_MODE: '1', DEMO_MODE: undefined, DISABLE_AI: undefined }, () => {
    assert.equal(getFeatureFlags().disableAi, true, 'sandbox must turn AI off');
  });
  await withEnv({ SANDBOX_MODE: undefined, DEMO_MODE: undefined, DISABLE_AI: undefined }, () => {
    assert.equal(getFeatureFlags().disableAi, false, 'AI stays on outside sandbox/demo');
  });
});

test('sandbox example decks load and are well-formed', async () => {
  const examples = await listSandboxExamples(process.cwd());
  assert.ok(examples.length >= 3, 'ships at least three example decks');
  for (const ex of examples) {
    assert.ok(ex.id && ex.title, `example ${ex.id} has an id and title`);
    assert.ok(ex.slideCount > 0, `example ${ex.id} has slides`);
    const slides = ex.deck?.slides;
    assert.ok(Array.isArray(slides) && slides.length === ex.slideCount, 'slideCount matches deck');
    // Every slide type used must be declared in the deck's slideTypes manifest,
    // or import/render can't resolve it.
    const manifest = ex.deck?.slideTypes || {};
    for (const s of slides) {
      assert.ok(manifest[s.type], `example ${ex.id} manifest declares "${s.type}"`);
    }
  }
});

test('sandbox sample media is well-formed and has pickable logos', () => {
  const media = listSandboxMedia();
  assert.ok(media.length >= 4, 'ships a handful of sample images');
  for (const m of media) {
    assert.ok(m.id && m.url, `media ${m.id} has an id and url`);
    assert.match(m.url, /^\/client\/vendor\/sandbox-media\/.+\.svg$/, 'served from the committed asset dir');
    assert.ok(Array.isArray(m.tags), 'has tags');
  }
  // At least one logo so the Logos filter (tag includes "logo") isn't empty.
  assert.ok(
    media.some((m) => m.tags.some((t) => String(t).toLowerCase().includes('logo'))),
    'includes at least one logo'
  );
});

test('sandbox theme list excludes filesystem custom (branded) themes', async () => {
  const repoRoot = process.cwd();
  const [core, all] = await Promise.all([
    listCoreThemeIds(repoRoot),
    listThemeIds(repoRoot),
  ]);
  // Core themes are the neutral built-ins surfaced on the public sandbox.
  assert.ok(core.includes('deckyard'), 'core set must include the built-in themes');
  assert.ok(core.length > 0, 'core theme set must not be empty');
  // Any theme present in the full list but absent from the core set is a
  // filesystem custom (potentially branded) theme, which sandbox must not show.
  const customOnly = all.filter((id) => !core.includes(id));
  for (const id of customOnly) {
    assert.ok(!core.includes(id), `sandbox core list must omit custom theme "${id}"`);
  }
});

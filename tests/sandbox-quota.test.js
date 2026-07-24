import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertSandboxQuotaForCreate,
  getSandboxUsageForOwner,
  SandboxQuotaError,
} from '../server/storage/presentations/sandbox-quota.js';

/**
 * Sandbox launch-hardening #3 (acceptance): a guest at their per-guest deck
 * quota is refused a new deck with a typed 4xx, instead of being allowed to
 * keep filling the shared volume.
 */

const OWNER = 'guest-aaaa1111-2222-3333-4444-555566667777@sandbox.local';
const OTHER = 'guest-bbbb1111-2222-3333-4444-555566667777@sandbox.local';

async function withSandboxDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-quota-'));
  const prevData = process.env.DATA_DIR;
  const prevMode = process.env.SANDBOX_MODE;
  const prevMax = process.env.SANDBOX_MAX_DECKS_PER_GUEST;
  process.env.DATA_DIR = dir;
  process.env.SANDBOX_MODE = '1';
  try {
    await fs.mkdir(path.join(dir, 'presentations'), { recursive: true });
    await fn(dir);
  } finally {
    if (prevData == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevData;
    if (prevMode == null) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevMode;
    if (prevMax == null) delete process.env.SANDBOX_MAX_DECKS_PER_GUEST;
    else process.env.SANDBOX_MAX_DECKS_PER_GUEST = prevMax;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeDeck(dir, id, ownerEmail) {
  await fs.writeFile(
    path.join(dir, 'presentations', `${id}.json`),
    JSON.stringify({ id, ownerEmail, slides: [] })
  );
}

test('counts only the owner’s decks', async () => {
  await withSandboxDir(async (dir) => {
    await writeDeck(dir, 'a', OWNER);
    await writeDeck(dir, 'b', OWNER);
    await writeDeck(dir, 'c', OTHER);
    const usage = await getSandboxUsageForOwner('/unused', OWNER);
    assert.equal(usage.deckCount, 2);
    assert.ok(usage.totalBytes > 0);
  });
});

test('under the cap, create is allowed', async () => {
  await withSandboxDir(async (dir) => {
    process.env.SANDBOX_MAX_DECKS_PER_GUEST = '3';
    await writeDeck(dir, 'a', OWNER);
    await writeDeck(dir, 'b', OWNER);
    // 2 owned, cap 3 → one more is allowed (no throw).
    await assertSandboxQuotaForCreate('/unused', OWNER);
  });
});

test('at the cap, create is refused with a typed 4xx', async () => {
  await withSandboxDir(async (dir) => {
    process.env.SANDBOX_MAX_DECKS_PER_GUEST = '2';
    await writeDeck(dir, 'a', OWNER);
    await writeDeck(dir, 'b', OWNER);
    await assert.rejects(
      () => assertSandboxQuotaForCreate('/unused', OWNER),
      (err) => {
        assert.ok(err instanceof SandboxQuotaError);
        assert.equal(err.statusCode, 429);
        assert.equal(err.code, 'sandbox_quota_exceeded');
        return true;
      }
    );
  });
});

test('another guest is unaffected by this guest’s decks', async () => {
  await withSandboxDir(async (dir) => {
    process.env.SANDBOX_MAX_DECKS_PER_GUEST = '2';
    await writeDeck(dir, 'a', OWNER);
    await writeDeck(dir, 'b', OWNER);
    // OTHER owns nothing → still allowed even though OWNER is at the cap.
    await assertSandboxQuotaForCreate('/unused', OTHER);
  });
});

test('no-op when sandbox mode is off', async () => {
  const prevMode = process.env.SANDBOX_MODE;
  delete process.env.SANDBOX_MODE;
  try {
    // Even with a (hypothetical) full disk, non-sandbox never throws.
    await assertSandboxQuotaForCreate('/unused', OWNER);
  } finally {
    if (prevMode == null) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevMode;
  }
});

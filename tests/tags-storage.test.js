/**
 * Tags storage: the file-adapter tag methods behind the storage facade.
 *
 * Drives server/storage/tags.js against an initialized file adapter — the same
 * path the running server uses in default OSS (file) mode. This is the surface
 * that used to 500 on a default install (the file adapter shipped no tag
 * methods), so it covers the round-trip the editor and list views depend on:
 * - set/get tags for a presentation
 * - bulk fetch (list views)
 * - org-wide list with usage counts
 * - create + delete (delete removes the tag from every link)
 * - prefix search
 *
 * Run with: node --test tests/tags-storage.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(os.tmpdir(), `deckyard-tags-${crypto.randomUUID()}`);
process.env.DATA_DIR = path.join(repoRoot, 'data');

const { initializeStorage, closeStorage } = await import('../server/storage/adapters/index.js');
const {
  listTags,
  getTagsForPresentation,
  getTagsForPresentations,
  setTagsForPresentation,
  createTag,
  deleteTag,
  searchTags,
} = await import('../server/storage/tags.js');

before(async () => {
  await fs.mkdir(process.env.DATA_DIR, { recursive: true });
  await initializeStorage(repoRoot);
});

after(async () => {
  await closeStorage();
  await fs.rm(repoRoot, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('tags storage (file adapter)', () => {
  it('reads back empty on a fresh store instead of throwing', async () => {
    assert.deepStrictEqual(await listTags(), []);
    assert.deepStrictEqual(await getTagsForPresentation('nope'), []);
    const map = await getTagsForPresentations(['a', 'b']);
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 0);
  });

  it('sets and gets tags for a presentation (sorted, deduped)', async () => {
    const set = await setTagsForPresentation('p1', ['Sales', 'sales', 'Q3', '']);
    // 'sales' is a case-insensitive dup of 'Sales'; blank is dropped.
    assert.deepStrictEqual(set.map((t) => t.name).sort(), ['Q3', 'Sales']);

    const got = await getTagsForPresentation('p1');
    assert.deepStrictEqual(got.map((t) => t.name), ['Q3', 'Sales']); // name-sorted
    assert.ok(got.every((t) => typeof t.id === 'string' && t.id.length > 0));
  });

  it('shares a tag id across presentations by name', async () => {
    await setTagsForPresentation('p2', ['Sales', 'Marketing']);
    const p1 = await getTagsForPresentation('p1');
    const p2 = await getTagsForPresentation('p2');
    const salesP1 = p1.find((t) => t.name === 'Sales');
    const salesP2 = p2.find((t) => t.name === 'Sales');
    assert.strictEqual(salesP1.id, salesP2.id, 'same name → same id');
  });

  it('bulk-fetches tags for a list of presentations', async () => {
    const map = await getTagsForPresentations(['p1', 'p2', 'missing']);
    assert.deepStrictEqual(map.get('p1').map((t) => t.name), ['Q3', 'Sales']);
    assert.deepStrictEqual(map.get('p2').map((t) => t.name), ['Marketing', 'Sales']);
    assert.strictEqual(map.has('missing'), false);
  });

  it('lists all tags with usage counts', async () => {
    const all = await listTags();
    const byName = Object.fromEntries(all.map((t) => [t.name, t.count]));
    assert.strictEqual(byName.Sales, 2); // p1 + p2
    assert.strictEqual(byName.Q3, 1);
    assert.strictEqual(byName.Marketing, 1);
  });

  it('replaces (not merges) tags on a subsequent set', async () => {
    await setTagsForPresentation('p1', ['Q3']);
    const got = await getTagsForPresentation('p1');
    assert.deepStrictEqual(got.map((t) => t.name), ['Q3']);
    // Sales count drops to 1 (only p2 now).
    const all = await listTags();
    assert.strictEqual(all.find((t) => t.name === 'Sales').count, 1);
  });

  it('clears tags when set to an empty list', async () => {
    await setTagsForPresentation('p1', []);
    assert.deepStrictEqual(await getTagsForPresentation('p1'), []);
  });

  it('creates a standalone tag and finds it via prefix search', async () => {
    const created = await createTag('Engineering');
    assert.strictEqual(created.name, 'Engineering');
    const hits = await searchTags('eng');
    assert.ok(hits.some((t) => t.name === 'Engineering'));
    // Unused tag has a zero count.
    assert.strictEqual(hits.find((t) => t.name === 'Engineering').count, 0);
  });

  it('deletes a tag and strips it from every presentation link', async () => {
    await setTagsForPresentation('p3', ['Marketing', 'Sales']);
    const salesId = (await getTagsForPresentation('p3')).find((t) => t.name === 'Sales').id;
    assert.strictEqual(await deleteTag(salesId), true);

    assert.deepStrictEqual(
      (await getTagsForPresentation('p2')).map((t) => t.name),
      ['Marketing']
    );
    assert.deepStrictEqual(
      (await getTagsForPresentation('p3')).map((t) => t.name),
      ['Marketing']
    );
    assert.ok(!(await listTags()).some((t) => t.name === 'Sales'));
    assert.strictEqual(await deleteTag(salesId), false, 'second delete is a no-op');
  });
});

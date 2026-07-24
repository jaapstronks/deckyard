/**
 * Tests for presentation version pruning logic.
 * Run with: node --test tests/versions-pruning.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  getReasonPriority,
  startOfDayUtc,
  startOfWeekUtc,
  selectBestSnapshot,
  createPresentationVersion,
  listPresentationVersions,
  prunePresentationVersions,
} from '../server/storage/presentations/versions.js';

// ============================================================================
// Unit Tests: getReasonPriority
// ============================================================================

describe('getReasonPriority', () => {
  it('returns correct priorities for known reasons', () => {
    assert.strictEqual(getReasonPriority('session_end'), 1);
    assert.strictEqual(getReasonPriority('manual'), 2);
    assert.strictEqual(getReasonPriority('restore'), 3);
    assert.strictEqual(getReasonPriority('pre_restore'), 4);
    assert.strictEqual(getReasonPriority('pre_merge'), 5);
    assert.strictEqual(getReasonPriority('autosave'), 6);
    assert.strictEqual(getReasonPriority('snapshot'), 7);
  });

  it('returns fallback priority for unknown reasons', () => {
    assert.strictEqual(getReasonPriority('unknown'), 99);
    assert.strictEqual(getReasonPriority(''), 99);
    assert.strictEqual(getReasonPriority(null), 99);
    assert.strictEqual(getReasonPriority(undefined), 99);
  });

  it('session_end has higher priority than autosave', () => {
    assert.ok(getReasonPriority('session_end') < getReasonPriority('autosave'));
  });
});

// ============================================================================
// Unit Tests: startOfDayUtc
// ============================================================================

describe('startOfDayUtc', () => {
  it('returns start of day for a midday timestamp', () => {
    // 2024-01-15 14:30:00 UTC
    const timestamp = Date.UTC(2024, 0, 15, 14, 30, 0);
    const result = startOfDayUtc(timestamp);
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('returns same value for start of day input', () => {
    const timestamp = Date.UTC(2024, 0, 15, 0, 0, 0);
    const result = startOfDayUtc(timestamp);
    assert.strictEqual(result, timestamp);
  });

  it('handles end of day timestamp', () => {
    // 2024-01-15 23:59:59.999 UTC
    const timestamp = Date.UTC(2024, 0, 15, 23, 59, 59, 999);
    const result = startOfDayUtc(timestamp);
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('handles month boundaries', () => {
    // 2024-02-01 03:00:00 UTC
    const timestamp = Date.UTC(2024, 1, 1, 3, 0, 0);
    const result = startOfDayUtc(timestamp);
    const expected = Date.UTC(2024, 1, 1, 0, 0, 0);
    assert.strictEqual(result, expected);
  });
});

// ============================================================================
// Unit Tests: startOfWeekUtc
// ============================================================================

describe('startOfWeekUtc', () => {
  it('returns Monday for a Wednesday timestamp', () => {
    // 2024-01-17 is Wednesday
    const timestamp = Date.UTC(2024, 0, 17, 14, 30, 0);
    const result = startOfWeekUtc(timestamp);
    // 2024-01-15 is Monday
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('returns same Monday for a Monday timestamp', () => {
    // 2024-01-15 is Monday
    const timestamp = Date.UTC(2024, 0, 15, 10, 0, 0);
    const result = startOfWeekUtc(timestamp);
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('returns previous Monday for a Sunday timestamp', () => {
    // 2024-01-21 is Sunday
    const timestamp = Date.UTC(2024, 0, 21, 20, 0, 0);
    const result = startOfWeekUtc(timestamp);
    // 2024-01-15 is the Monday of that week
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('handles week spanning month boundary', () => {
    // 2024-02-01 is Thursday
    const timestamp = Date.UTC(2024, 1, 1, 12, 0, 0);
    const result = startOfWeekUtc(timestamp);
    // 2024-01-29 is Monday
    const expected = Date.UTC(2024, 0, 29, 0, 0, 0);
    assert.strictEqual(result, expected);
  });

  it('handles Saturday correctly', () => {
    // 2024-01-20 is Saturday
    const timestamp = Date.UTC(2024, 0, 20, 15, 0, 0);
    const result = startOfWeekUtc(timestamp);
    // 2024-01-15 is Monday
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    assert.strictEqual(result, expected);
  });
});

// ============================================================================
// Unit Tests: selectBestSnapshot
// ============================================================================

describe('selectBestSnapshot', () => {
  it('returns null for empty array', () => {
    assert.strictEqual(selectBestSnapshot([]), null);
  });

  it('returns null for null input', () => {
    assert.strictEqual(selectBestSnapshot(null), null);
  });

  it('returns single snapshot when only one exists', () => {
    const snapshots = [{ reason: 'autosave', createdMs: 1000 }];
    const result = selectBestSnapshot(snapshots);
    assert.deepStrictEqual(result, snapshots[0]);
  });

  it('selects session_end over autosave', () => {
    const snapshots = [
      { id: 'a', reason: 'autosave', createdMs: 2000 },
      { id: 'b', reason: 'session_end', createdMs: 1000 },
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'b');
  });

  it('selects manual over autosave', () => {
    const snapshots = [
      { id: 'a', reason: 'autosave', createdMs: 2000 },
      { id: 'b', reason: 'manual', createdMs: 1000 },
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'b');
  });

  it('selects session_end over manual', () => {
    const snapshots = [
      { id: 'a', reason: 'manual', createdMs: 2000 },
      { id: 'b', reason: 'session_end', createdMs: 1000 },
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'b');
  });

  it('selects more recent snapshot when reasons are equal', () => {
    const snapshots = [
      { id: 'a', reason: 'autosave', createdMs: 1000 },
      { id: 'b', reason: 'autosave', createdMs: 2000 },
      { id: 'c', reason: 'autosave', createdMs: 1500 },
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'b');
  });

  it('prioritizes reason over recency', () => {
    const snapshots = [
      { id: 'a', reason: 'autosave', createdMs: 3000 },  // newer but lower priority
      { id: 'b', reason: 'session_end', createdMs: 1000 }, // older but higher priority
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'b');
  });

  it('handles all reason types correctly', () => {
    const snapshots = [
      { id: 'snapshot', reason: 'snapshot', createdMs: 6000 },
      { id: 'autosave', reason: 'autosave', createdMs: 5000 },
      { id: 'pre_restore', reason: 'pre_restore', createdMs: 4000 },
      { id: 'restore', reason: 'restore', createdMs: 3000 },
      { id: 'manual', reason: 'manual', createdMs: 2000 },
      { id: 'session_end', reason: 'session_end', createdMs: 1000 },
    ];
    const result = selectBestSnapshot(snapshots);
    assert.strictEqual(result.id, 'session_end');
  });
});

// ============================================================================
// Integration Tests: prunePresentationVersions
// ============================================================================

describe('prunePresentationVersions', () => {
  let tempDir;

  // Helper to create a version file directly
  // Note: dataDir(repoRoot) resolves to repoRoot/server/data by default
  async function createVersionFile(repoRoot, presentationId, { id, created, reason, label = '' }) {
    const dir = path.join(repoRoot, 'server', 'data', 'presentation-versions', presentationId);
    await fs.mkdir(dir, { recursive: true });
    const snap = {
      id,
      presentationId,
      created,
      reason,
      label,
      revision: 1,
      title: 'Test',
      presentation: {},
    };
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(snap, null, 2));
    return snap;
  }

  // Helper to get remaining version IDs
  async function getVersionIds(repoRoot, presentationId) {
    const versions = await listPresentationVersions(repoRoot, presentationId);
    return versions.map((v) => v.id).sort();
  }

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'versions-test-'));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps all snapshots from last 24 hours', async () => {
    const testDir = path.join(tempDir, 'test-24h');
    const presId = 'pres-24h';
    const now = Date.now();

    // Create snapshots at various times within 24h
    await createVersionFile(testDir, presId, {
      id: 'recent-1',
      created: new Date(now - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
      reason: 'autosave',
    });
    await createVersionFile(testDir, presId, {
      id: 'recent-2',
      created: new Date(now - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
      reason: 'autosave',
    });
    await createVersionFile(testDir, presId, {
      id: 'recent-3',
      created: new Date(now - 23 * 60 * 60 * 1000).toISOString(), // 23 hours ago
      reason: 'autosave',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    assert.deepStrictEqual(remaining, ['recent-1', 'recent-2', 'recent-3']);
  });

  it('keeps only best snapshot per day for days 1-7', async () => {
    const testDir = path.join(tempDir, 'test-daily');
    const presId = 'pres-daily';
    const now = Date.now();

    // Create multiple snapshots 3 days ago (same day)
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'day3-autosave-1',
      created: new Date(threeDaysAgo).toISOString(),
      reason: 'autosave',
    });
    await createVersionFile(testDir, presId, {
      id: 'day3-autosave-2',
      created: new Date(threeDaysAgo + 60000).toISOString(), // 1 min later
      reason: 'autosave',
    });
    await createVersionFile(testDir, presId, {
      id: 'day3-session-end',
      created: new Date(threeDaysAgo + 30000).toISOString(), // between the two
      reason: 'session_end',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    // Should keep session_end (higher priority) over autosaves
    assert.deepStrictEqual(remaining, ['day3-session-end']);
  });

  it('keeps only best snapshot per week for weeks 1-4', async () => {
    const testDir = path.join(tempDir, 'test-weekly');
    const presId = 'pres-weekly';
    const now = Date.now();

    // Create multiple snapshots 2 weeks ago (same week)
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'week2-autosave',
      created: new Date(twoWeeksAgo).toISOString(),
      reason: 'autosave',
    });
    await createVersionFile(testDir, presId, {
      id: 'week2-session-end',
      created: new Date(twoWeeksAgo + 60000).toISOString(),
      reason: 'session_end',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    assert.deepStrictEqual(remaining, ['week2-session-end']);
  });

  it('never prunes manual snapshots', async () => {
    const testDir = path.join(tempDir, 'test-manual');
    const presId = 'pres-manual';
    const now = Date.now();

    // Create a manual snapshot from 5 weeks ago (would be pruned if not manual)
    const fiveWeeksAgo = now - 35 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'old-manual',
      created: new Date(fiveWeeksAgo).toISOString(),
      reason: 'manual',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    assert.deepStrictEqual(remaining, ['old-manual']);
  });

  it('never prunes labeled snapshots', async () => {
    const testDir = path.join(tempDir, 'test-labeled');
    const presId = 'pres-labeled';
    const now = Date.now();

    // Create a labeled autosave from 5 weeks ago
    const fiveWeeksAgo = now - 35 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'old-labeled',
      created: new Date(fiveWeeksAgo).toISOString(),
      reason: 'autosave',
      label: 'Important checkpoint',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    assert.deepStrictEqual(remaining, ['old-labeled']);
  });

  it('prunes snapshots older than 4 weeks (except manual/labeled)', async () => {
    const testDir = path.join(tempDir, 'test-old');
    const presId = 'pres-old';
    const now = Date.now();

    // Create an autosave from 6 weeks ago
    const sixWeeksAgo = now - 42 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'very-old-autosave',
      created: new Date(sixWeeksAgo).toISOString(),
      reason: 'autosave',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    assert.deepStrictEqual(remaining, []);
  });

  it('handles mixed ages correctly', async () => {
    const testDir = path.join(tempDir, 'test-mixed');
    const presId = 'pres-mixed';
    const now = Date.now();

    // Recent (keep all)
    await createVersionFile(testDir, presId, {
      id: 'recent',
      created: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      reason: 'autosave',
    });

    // 3 days ago (keep best per day)
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'day3-best',
      created: new Date(threeDaysAgo).toISOString(),
      reason: 'session_end',
    });
    await createVersionFile(testDir, presId, {
      id: 'day3-other',
      created: new Date(threeDaysAgo + 60000).toISOString(),
      reason: 'autosave',
    });

    // 2 weeks ago (keep best per week)
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'week2-best',
      created: new Date(twoWeeksAgo).toISOString(),
      reason: 'session_end',
    });

    // 6 weeks ago (prune unless manual)
    const sixWeeksAgo = now - 42 * 24 * 60 * 60 * 1000;
    await createVersionFile(testDir, presId, {
      id: 'old-manual',
      created: new Date(sixWeeksAgo).toISOString(),
      reason: 'manual',
    });
    await createVersionFile(testDir, presId, {
      id: 'old-autosave',
      created: new Date(sixWeeksAgo + 60000).toISOString(),
      reason: 'autosave',
    });

    await prunePresentationVersions(testDir, presId);

    const remaining = await getVersionIds(testDir, presId);
    // Should keep: recent, day3-best, week2-best, old-manual
    // Should prune: day3-other, old-autosave
    assert.deepStrictEqual(remaining, ['day3-best', 'old-manual', 'recent', 'week2-best']);
  });

  it('handles empty presentation ID gracefully', async () => {
    const testDir = path.join(tempDir, 'test-empty-id');
    // Should not throw
    await prunePresentationVersions(testDir, '');
    await prunePresentationVersions(testDir, null);
  });

  it('handles non-existent directory gracefully', async () => {
    const testDir = path.join(tempDir, 'non-existent');
    // Should not throw
    await prunePresentationVersions(testDir, 'some-id');
  });
});

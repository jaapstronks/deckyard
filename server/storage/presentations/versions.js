import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../../config/storage-paths.js';

function versionsDir(repoRoot, presentationId) {
  return path.join(
    dataDir(repoRoot),
    'presentation-versions',
    String(presentationId || '')
  );
}

function safeId(s) {
  return String(s || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

async function writeJsonAtomic(dir, filename, obj) {
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${filename}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, path.join(dir, filename));
}

export async function listPresentationVersions(repoRoot, presentationId) {
  const id = safeId(presentationId);
  if (!id) return [];
  const dir = versionsDir(repoRoot, id);
  try {
    const files = await fs.readdir(dir);
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(dir, f);
      let raw = '';
      try {
        raw = await fs.readFile(full, 'utf8');
      } catch {
        continue;
      }
      let obj = null;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      if (String(obj.presentationId || '') !== id) continue;
      // Calculate slide count from stored presentation data
      const slides = obj.presentation?.slides;
      const slideCount = Array.isArray(slides) ? slides.length : null;
      out.push({
        id: obj.id,
        created: obj.created,
        createdBy: obj.createdBy || null,
        reason: obj.reason || 'snapshot',
        label: obj.label || '',
        revision: obj.revision || null,
        title: obj.title || '',
        slideCount,
      });
    }
    out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return out;
  } catch {
    return [];
  }
}

export async function getPresentationVersion(repoRoot, presentationId, versionId) {
  const pid = safeId(presentationId);
  const vid = safeId(versionId);
  if (!pid || !vid) return null;
  const dir = versionsDir(repoRoot, pid);
  const full = path.join(dir, `${vid}.json`);
  try {
    const raw = await fs.readFile(full, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (String(obj.presentationId || '') !== pid) return null;
    if (String(obj.id || '') !== vid) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function createPresentationVersion(
  repoRoot,
  presentationId,
  pres,
  { actorEmail = null, reason = 'snapshot', label = '' } = {}
) {
  const pid = safeId(presentationId);
  if (!pid) return null;
  const id = crypto.randomUUID();
  const created = nowIso();
  const snap = {
    id,
    presentationId: pid,
    created,
    createdBy: actorEmail || null,
    reason: String(reason || 'snapshot'),
    label: String(label || ''),
    revision: pres?.revision ?? null,
    title: typeof pres?.title === 'string' ? pres.title : '',
    presentation: pres && typeof pres === 'object' ? pres : null,
  };
  const dir = versionsDir(repoRoot, pid);
  await writeJsonAtomic(dir, `${id}.json`, snap);
  return snap;
}

// Tiered retention configuration
const RETENTION = {
  RECENT_HOURS: 24,        // Keep all snapshots from last 24 hours
  DAILY_DAYS: 7,           // Keep 1 snapshot per day for days 1-7
  WEEKLY_WEEKS: 4,         // Keep 1 snapshot per week for weeks 1-4
};

// Priority for selecting best snapshot when multiple exist in same time bucket
// Lower number = higher priority
const REASON_PRIORITY = {
  session_end: 1,
  manual: 2,
  restore: 3,
  pre_restore: 4,
  pre_merge: 5,
  autosave: 6,
  snapshot: 7,
};

// Fallback priority for unknown reasons (lowest priority)
const REASON_PRIORITY_FALLBACK = 99;

/**
 * Get the priority value for a snapshot reason.
 * Lower number = higher priority.
 * @param {string} reason - Snapshot reason
 * @returns {number} Priority value
 */
export function getReasonPriority(reason) {
  return REASON_PRIORITY[reason] || REASON_PRIORITY_FALLBACK;
}

/**
 * Get the start of the day (UTC) for a given timestamp.
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {number} Unix timestamp for start of day (UTC)
 */
export function startOfDayUtc(timestamp) {
  const d = new Date(timestamp);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get the start of the week (UTC, Monday) for a given timestamp.
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {number} Unix timestamp for start of week (Monday, UTC)
 */
export function startOfWeekUtc(timestamp) {
  const d = new Date(timestamp);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0, Sunday = 6
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Select the best snapshot from a list for retention.
 * Prefers: session_end > manual > restore > pre_restore > autosave > snapshot
 * For ties in reason, prefers the most recent.
 * @param {Array} snapshots - Array of snapshot objects with reason and createdMs properties
 * @returns {Object|null} The best snapshot or null if empty
 */
export function selectBestSnapshot(snapshots) {
  if (!snapshots || snapshots.length === 0) return null;
  return snapshots.reduce((best, current) => {
    const bestPriority = getReasonPriority(best.reason);
    const currentPriority = getReasonPriority(current.reason);
    if (currentPriority < bestPriority) return current;
    if (currentPriority === bestPriority && current.createdMs > best.createdMs) return current;
    return best;
  });
}

/**
 * Prune presentation versions using tiered retention:
 * - Keep all snapshots from last 24 hours
 * - Keep 1 snapshot per day for days 1-7
 * - Keep 1 snapshot per week for weeks 1-4
 * - Never prune manual snapshots
 */
export async function prunePresentationVersions(repoRoot, presentationId) {
  const pid = safeId(presentationId);
  if (!pid) return;
  const dir = versionsDir(repoRoot, pid);

  // Read all version files
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  // Load metadata for all versions
  const versions = [];
  for (const f of jsonFiles) {
    const full = path.join(dir, f);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') continue;
      if (String(obj.presentationId || '') !== pid) continue;
      const createdMs = obj.created ? new Date(obj.created).getTime() : 0;
      versions.push({
        file: f,
        id: obj.id,
        reason: obj.reason || 'snapshot',
        createdMs,
        label: obj.label || '',
      });
    } catch {
      continue;
    }
  }

  if (versions.length === 0) return;

  const now = Date.now();
  const recentCutoff = now - RETENTION.RECENT_HOURS * 60 * 60 * 1000;
  const dailyCutoff = now - RETENTION.DAILY_DAYS * 24 * 60 * 60 * 1000;
  const weeklyCutoff = now - RETENTION.WEEKLY_WEEKS * 7 * 24 * 60 * 60 * 1000;

  const toKeep = new Set();
  const dailyBuckets = new Map(); // startOfDay -> [versions]
  const weeklyBuckets = new Map(); // startOfWeek -> [versions]

  for (const v of versions) {
    // Always keep manual snapshots and labeled snapshots
    if (v.reason === 'manual' || v.label) {
      toKeep.add(v.file);
      continue;
    }

    // Keep all snapshots from last 24 hours
    if (v.createdMs >= recentCutoff) {
      toKeep.add(v.file);
      continue;
    }

    // Group by day for daily retention (days 1-7)
    if (v.createdMs >= dailyCutoff) {
      const dayKey = startOfDayUtc(v.createdMs);
      if (!dailyBuckets.has(dayKey)) {
        dailyBuckets.set(dayKey, []);
      }
      dailyBuckets.get(dayKey).push(v);
      continue;
    }

    // Group by week for weekly retention (weeks 1-4)
    if (v.createdMs >= weeklyCutoff) {
      const weekKey = startOfWeekUtc(v.createdMs);
      if (!weeklyBuckets.has(weekKey)) {
        weeklyBuckets.set(weekKey, []);
      }
      weeklyBuckets.get(weekKey).push(v);
      continue;
    }

    // Older than 4 weeks: don't add to keep set (will be deleted)
  }

  // Select best snapshot from each daily bucket
  for (const [, bucketVersions] of dailyBuckets) {
    const best = selectBestSnapshot(bucketVersions);
    if (best) toKeep.add(best.file);
  }

  // Select best snapshot from each weekly bucket
  for (const [, bucketVersions] of weeklyBuckets) {
    const best = selectBestSnapshot(bucketVersions);
    if (best) toKeep.add(best.file);
  }

  // Delete versions not in keep set
  for (const v of versions) {
    if (!toKeep.has(v.file)) {
      try {
        await fs.unlink(path.join(dir, v.file));
      } catch {
        // ignore deletion errors
      }
    }
  }
}

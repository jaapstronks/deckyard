import { isDatabaseAvailable } from '../db/client.js';
import * as dbLocks from '../storage/presentation-locks-db.js';
import { norm } from './normalize.js';

const LOCK_TTL_MS = 2 * 60 * 1000;

// Feature flag to use database locks when available
// Set USE_DB_LOCKS=true to enable persistent locks
function useDbLocks() {
  return process.env.USE_DB_LOCKS === 'true' && isDatabaseAvailable();
}

// In-process advisory locks. This is intentionally ephemeral:
// - avoids extra dependencies
// - TTL makes stale locks self-heal
// - optimistic concurrency remains the real safety net
// When USE_DB_LOCKS is enabled, these are bypassed in favor of DB storage.
const locks = new Map(); // presentationId -> lock

function nowMs() {
  return Date.now();
}

function cleanupExpired() {
  const t = nowMs();
  for (const [pid, lock] of locks.entries()) {
    if (!lock) {
      locks.delete(pid);
      continue;
    }
    if (Number(lock.expiresAtMs || 0) <= t) {
      locks.delete(pid);
    }
  }
}

export async function getPresentationLock(presentationId, ctx) {
  if (useDbLocks()) {
    return dbLocks.getPresentationLock(presentationId, ctx);
  }
  cleanupExpired();
  const pid = norm(presentationId);
  if (!pid) return null;
  const lock = locks.get(pid);
  if (!lock) return null;
  return {
    presentationId: pid,
    holderEmail: lock.holderEmail || null,
    holderName: lock.holderName || null,
    acquiredAt: lock.acquiredAt,
    refreshedAt: lock.refreshedAt,
    expiresAt: lock.expiresAt,
  };
}

export async function acquirePresentationLock(presentationId, { email, name } = {}, ctx) {
  if (useDbLocks()) {
    return dbLocks.acquirePresentationLock(presentationId, { email, name }, ctx);
  }
  cleanupExpired();
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  const holderName = norm(name);
  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  const existing = locks.get(pid);
  const t = nowMs();
  if (existing && existing.holderEmail && existing.holderEmail !== holderEmail) {
    return {
      ok: false,
      reason: 'held',
      lock: await getPresentationLock(pid),
    };
  }

  const isoNow = new Date(t).toISOString();
  const expiresAtMs = t + LOCK_TTL_MS;
  const lock = existing
    ? {
        ...existing,
        holderEmail,
        holderName: holderName || existing.holderName || holderEmail,
        refreshedAt: isoNow,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
      }
    : {
        holderEmail,
        holderName: holderName || holderEmail,
        acquiredAt: isoNow,
        refreshedAt: isoNow,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
      };
  locks.set(pid, lock);
  return { ok: true, lock: await getPresentationLock(pid) };
}

export async function refreshPresentationLock(presentationId, { email } = {}, ctx) {
  if (useDbLocks()) {
    return dbLocks.refreshPresentationLock(presentationId, { email }, ctx);
  }
  cleanupExpired();
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  if (!pid || !holderEmail) return { ok: false, reason: 'invalid' };
  const existing = locks.get(pid);
  if (!existing) return { ok: false, reason: 'missing' };
  if (existing.holderEmail !== holderEmail)
    return { ok: false, reason: 'held', lock: await getPresentationLock(pid) };

  const t = nowMs();
  const isoNow = new Date(t).toISOString();
  const expiresAtMs = t + LOCK_TTL_MS;
  existing.refreshedAt = isoNow;
  existing.expiresAt = new Date(expiresAtMs).toISOString();
  existing.expiresAtMs = expiresAtMs;
  locks.set(pid, existing);
  return { ok: true, lock: await getPresentationLock(pid) };
}

export async function releasePresentationLock(presentationId, { email } = {}, ctx) {
  if (useDbLocks()) {
    return dbLocks.releasePresentationLock(presentationId, { email }, ctx);
  }
  cleanupExpired();
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  if (!pid || !holderEmail) return { ok: false, reason: 'invalid' };
  const existing = locks.get(pid);
  if (!existing) return { ok: true, released: false };
  if (existing.holderEmail !== holderEmail)
    return { ok: false, reason: 'held', lock: await getPresentationLock(pid) };
  locks.delete(pid);
  return { ok: true, released: true };
}

// Re-export DB lock functions for new features
export const forceReleasePresentationLock = dbLocks.forceReleasePresentationLock;
export const createLockRequest = dbLocks.createLockRequest;
export const listPendingLockRequests = dbLocks.listPendingLockRequests;
export const getLockRequest = dbLocks.getLockRequest;
export const acceptLockRequest = dbLocks.acceptLockRequest;
export const rejectLockRequest = dbLocks.rejectLockRequest;
export const getUserLockRequestStatus = dbLocks.getUserLockRequestStatus;
export const cleanupExpiredLocks = dbLocks.cleanupExpiredLocks;
export const cleanupOldLockRequests = dbLocks.cleanupOldLockRequests;

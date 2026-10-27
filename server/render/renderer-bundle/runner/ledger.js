import {
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { PATHS, trustedPath, isInternalId } from './paths.js';

/** Persist-before-ack, including the parent rename. A write failure closes
 * readiness and never starts a producer. This module has no recovery defaults. */
export function saveLedger(ledger) {
  const temporary = `${PATHS.register}.next`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(ledger)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, PATHS.register);
  const parent = openSync(path.dirname(PATHS.register), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

/** Missing/corrupt registration is an operator fault, never an empty registry. */
export function loadLedger(installation) {
  trustedPath(PATHS.register, 0o600);
  const v = JSON.parse(readFileSync(PATHS.register, 'utf8'));
  if (
    v.schema !== 'deckyard.renderer-runner.ledger/1' ||
    v.installation !== installation ||
    !Array.isArray(v.jobs) ||
    !Object.hasOwn(v, 'instance') ||
    !isInternalId(v.generation)
  )
    throw new Error('runner ledger invalid');
  const phases = [
    'RESERVED',
    'PREPARING',
    'RUNNING',
    'TERMINATING',
    'PRODUCERS_STOPPED',
    'CLEANING',
    'CLEANED',
  ];
  if (
    v.instance !== null &&
    (!isInternalId(v.instance.id) ||
      !isInternalId(v.instance.invocation) ||
      v.instance.cgroup !== '/system.slice/deckyard-render-broker.service' ||
      typeof v.instance.healthReady !== 'boolean')
  )
    throw new Error('runner instance invalid');
  const seen = new Set();
  for (const job of v.jobs) {
    if (
      !isInternalId(job.id) ||
      seen.has(job.id) ||
      !phases.includes(job.phase) ||
      !isInternalId(job.instance) ||
      !isInternalId(job.generation) ||
      !Number.isFinite(job.reservedAt) ||
      job.reservedAt < 0 ||
      typeof job.cancelled !== 'boolean' ||
      typeof job.preflight !== 'boolean'
    )
      throw new Error('runner ledger invalid');
    seen.add(job.id);
  }
  return v;
}

/** Cancellation also wins after normal QUIESCENT entered TERMINATING. Preserve
 * its first cleanup deadline and never move a terminal phase backwards. */
export function revokeRecord(job, code, monotonicTime) {
  if (!job || job.phase === 'CLEANED' || job.cancelled) return false;
  job.code = code;
  job.cancelled = true;
  job.revokedAt ??= monotonicTime;
  if (['RESERVED', 'PREPARING', 'RUNNING'].includes(job.phase))
    job.phase = 'TERMINATING';
  return true;
}

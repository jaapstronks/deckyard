/**
 * What a failed background job may tell the person who asked for it.
 *
 * A job's own record of a failure is `failedReason`: the message of whatever
 * the worker threw — `Unknown export type: …`, an `ENOENT` carrying a server
 * path. That is a server-side fact, not display text, and the API doctrine
 * spends exactly one field on display text: `message`
 * (`docs/reference/api-error-format.md`). So a failed job answers the question
 * every other contract asks of a thrown error, through the same predicate:
 * {@link isInternalFailure}. An `AppError` was written for the caller whatever
 * its status, so its sentence travels; any other throw is ours and the job
 * says nothing, the way a 500 stays generic (B646).
 *
 * The sentence cannot ride in the job record — BullMQ keeps the thrown message
 * and nothing else — so the worker records it here the way it records a
 * result: in memory, for the status route to read back. Workers and routes
 * share a process (`server.js` starts both), which is the condition the export
 * download already depends on. No record means no sentence, which is the
 * answer an internal failure gets anyway.
 *
 * @module server/jobs/queue/job-failure
 */

import { isInternalFailure } from '../../utils/errors.js';

/** key(`<queue>:<jobId>`) → `{ message, storedAt }`. */
const failures = new Map();

/** As long as a stored export result stays downloadable. */
const FAILURE_TTL_MS = 60 * 60 * 1000;

/**
 * The display sentence a thrown error leaves behind, or `null` when it leaves
 * none. The whole rule, so a caller never string-matches a raw reason.
 *
 * @param {unknown} err - What the worker threw.
 * @returns {string|null} Text safe to show, or `null`.
 */
export function jobFailureMessage(err) {
  if (!err || isInternalFailure(err)) return null;
  const message = /** @type {{message?: unknown}} */ (err).message;
  return typeof message === 'string' && message ? message : null;
}

/**
 * @param {string} queueName
 * @param {string|number} jobId
 * @returns {string}
 */
function failureKey(queueName, jobId) {
  return `${queueName}:${jobId}`;
}

/**
 * The sentence recorded for a failed job, if it left one.
 *
 * @param {string} queueName - Queue name.
 * @param {string|number} jobId - Job id, without the queue prefix.
 * @returns {string|null} Display text, or `null`.
 */
export function getJobFailureMessage(queueName, jobId) {
  const key = failureKey(queueName, jobId);
  const entry = failures.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > FAILURE_TTL_MS) {
    failures.delete(key);
    return null;
  }
  return entry.message;
}

/**
 * Wrap a worker's processor so every failure it leaves behind is recorded,
 * and a retry that succeeds clears what the earlier attempt left. The
 * original error is rethrown untouched: BullMQ's own `failedReason` stays the
 * raw text an operator reads, and the retry and backoff it drives are
 * unchanged.
 *
 * @template T
 * @param {string} queueName - Queue name.
 * @param {(job: Object) => Promise<T>} processor - The worker's processor.
 * @returns {(job: Object) => Promise<T>} The same processor, recording.
 */
export function withRecordedFailures(queueName, processor) {
  return async (job) => {
    const jobId = job?.id;
    try {
      const result = await processor(job);
      if (jobId != null) failures.delete(failureKey(queueName, jobId));
      return result;
    } catch (err) {
      if (jobId != null) recordJobFailure(queueName, jobId, err);
      throw err;
    }
  };
}

/**
 * Record (or, with nothing to say, erase) the sentence for a failed attempt.
 *
 * @param {string} queueName
 * @param {string|number} jobId
 * @param {unknown} err
 */
function recordJobFailure(queueName, jobId, err) {
  const key = failureKey(queueName, jobId);
  const message = jobFailureMessage(err);
  if (!message) {
    failures.delete(key);
    return;
  }
  failures.set(key, { message, storedAt: Date.now() });
  // Eviction only; the timer must not keep the process (or a test) alive.
  setTimeout(() => failures.delete(key), FAILURE_TTL_MS).unref?.();
}

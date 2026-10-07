/**
 * Translation job worker.
 * Processes AI-powered presentation translation jobs.
 *
 * Translation jobs are CPU/API intensive and can take significant time,
 * making them ideal candidates for background processing. The job is an
 * adapter like the routes: it reads its payload, calls `translatePresentation`
 * (`server/services/translate.js`, B610) and stores the result. The service
 * decides who may translate, refuses the pair before the model call and
 * applies the size limit; the worker used to skip that limit and throw bare
 * `Error`s where the routes answered 400.
 */

import { registerWorker, QUEUE_NAMES } from '../connection.js';
import { translatePresentation } from '../../../services/translate.js';
import { jobScope } from '../../../storage/scope.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('translate-worker');

// Store completed job results
const jobResults = new Map();
const RESULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Store a job result for later retrieval.
 * @param {string} jobId - Job ID
 * @param {Object} result - Result data
 */
function storeResult(jobId, result) {
  jobResults.set(jobId, {
    result,
    storedAt: Date.now(),
  });

  // Eviction only: the timer must not keep the process (or a test) alive.
  setTimeout(() => {
    jobResults.delete(jobId);
  }, RESULT_TTL_MS).unref?.();
}

/**
 * Get a stored job result.
 * @param {string} jobId - Job ID
 * @returns {Object|null} Result or null
 */
export function getStoredTranslationResult(jobId) {
  const entry = jobResults.get(jobId);
  if (!entry) return null;

  if (Date.now() - entry.storedAt > RESULT_TTL_MS) {
    jobResults.delete(jobId);
    return null;
  }

  return entry.result;
}

/**
 * Process a translation job. Exported for the test that drives it with a
 * job double; the queue calls it through {@link initializeTranslateWorker}.
 *
 * The job acts as the person who asked for it: `actorEmail` in the payload
 * (the identity the deciders resolve, D253). A job without one has nobody to
 * act as and is refused, not run as the operator.
 *
 * @param {Object} job - BullMQ job (`id`, `data`, `updateProgress`)
 * @returns {Promise<Object>} Result
 */
export async function processTranslateJob(job) {
  const {
    presentationId,
    from,
    to,
    overwrite = false,
    fillMissing = true,
    actorEmail,
  } = job.data;

  if (typeof actorEmail !== 'string' || !actorEmail) {
    throw new Error('translate job names no actorEmail to act as');
  }

  log.info(`Translating ${presentationId} from ${from} to ${to}`);
  await job.updateProgress(10);

  const scope = jobScope(job.data, 'translate job');
  const actor = { email: actorEmail, organizationId: scope.organizationId };
  const translated = await translatePresentation(
    scope,
    { actor },
    { presentationId, from, to, overwrite, fillMissing },
  );

  await job.updateProgress(100);

  const result = {
    from: translated.from,
    to: translated.to,
    presentationId,
    success: true,
    // Gates the download route against enumeration (security-audit H3).
    ownerEmail: actorEmail,
  };

  storeResult(job.id, result);

  return result;
}

/**
 * Initialize the translate worker.
 * @returns {Promise<Object|null>} Worker instance
 */
export async function initializeTranslateWorker() {
  return registerWorker(QUEUE_NAMES.TRANSLATE, processTranslateJob, {
    concurrency: 1, // Limit to 1 concurrent translation (API rate limits)
  });
}

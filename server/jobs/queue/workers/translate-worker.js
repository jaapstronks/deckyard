/**
 * Translation job worker.
 * Processes AI-powered presentation translation jobs.
 *
 * Translation jobs are CPU/API intensive and can take significant time,
 * making them ideal candidates for background processing.
 */

import { registerWorker, QUEUE_NAMES } from '../connection.js';
import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import { translatePresentationStrings } from '../../../utils/ai.js';
import { normalizeTranslationLang, normalizeLang } from '../../../storage/presentations/i18n.js';

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

  setTimeout(() => {
    jobResults.delete(jobId);
  }, RESULT_TTL_MS);
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
 * Process a translation job.
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>} Result
 */
async function processTranslateJob(job) {
  const {
    presentationId,
    from,
    to,
    overwrite = false,
    fillMissing = true,
    repoRoot,
    actorEmail,
  } = job.data;

  console.log(`[translate-worker] Translating ${presentationId} from ${from} to ${to}`);

  await job.updateProgress(10);

  // Load presentation
  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    throw new Error('Presentation not found');
  }

  await job.updateProgress(20);

  // Initialize i18n structure
  pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions =
    pres.i18n.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};

  // Validate languages
  const fromLang = normalizeTranslationLang(from) || normalizeLang(pres.i18n.active) || 'nl';
  const toLang = normalizeTranslationLang(to) || (fromLang === 'nl' ? 'en-GB' : 'nl');

  if (fromLang === toLang) {
    throw new Error('Source and target languages must be different');
  }

  // Check if target already exists
  if (pres.i18n.versions[toLang] && !overwrite && !fillMissing) {
    throw new Error(`Target language version already exists (${toLang})`);
  }

  // Ensure source version exists
  const dominant = normalizeLang(pres.i18n.dominant) || normalizeLang(fromLang) || 'nl';
  pres.i18n.dominant = dominant;

  if (normalizeLang(fromLang)) {
    pres.i18n.active = fromLang;
  }

  if (!pres.i18n.versions[dominant]) {
    pres.i18n.versions[dominant] = { title: pres.title, slides: pres.slides };
  }
  if (!pres.i18n.versions[fromLang]) {
    pres.i18n.versions[fromLang] = { title: pres.title, slides: pres.slides };
  }

  await job.updateProgress(30);

  // Get source content
  const src = pres.i18n.versions[fromLang] || { title: pres.title, slides: pres.slides };

  // Get existing target for fill-missing mode
  const existingTarget =
    !overwrite && pres.i18n.versions[toLang]
      ? pres.i18n.versions[toLang]
      : null;

  await job.updateProgress(40);

  // Perform translation (this is the slow part)
  const translated = await translatePresentationStrings(
    { title: src.title, slides: src.slides },
    {
      from: fromLang,
      to: toLang,
      existingTarget,
      fillMissing: !!fillMissing && !overwrite,
    }
  );

  await job.updateProgress(80);

  // Update presentation with translation
  pres.i18n.versions[toLang] = {
    title: translated.title,
    slides: translated.slides,
  };

  // Save
  const updated = await updatePresentation(repoRoot, presentationId, pres, {
    actorEmail,
    skipLimitCheck: true, // Skip limit check for translations
  });

  await job.updateProgress(100);

  const result = {
    from: fromLang,
    to: toLang,
    presentationId,
    success: true,
  };

  storeResult(job.id, result);

  return result;
}

/**
 * Initialize the translate worker.
 * @returns {Promise<Object|null>} Worker instance
 */
export async function initializeTranslateWorker() {
  return registerWorker(
    QUEUE_NAMES.TRANSLATE,
    processTranslateJob,
    {
      concurrency: 1, // Limit to 1 concurrent translation (API rate limits)
    }
  );
}

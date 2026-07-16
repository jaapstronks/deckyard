/**
 * Public API v1 - Translation endpoint.
 * Handles presentation translation via AI.
 */

import { updatePresentation } from '../../../storage/presentations.js';
import { translatePresentationStrings } from '../../../utils/ai.js';
import { methodNotAllowed } from '../../../utils/http.js';
import { getFeatureFlags } from '../../../config/feature-flags.js';
import {
  normalizeTranslationLang,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../../storage/presentations/i18n.js';
import { requireScope, getPresentationWithAccess, parseJsonBody, checkAiLimit, trackAiRequest, apiSuccess, apiError } from './middleware.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * POST /api/v1/presentations/:id/translate - Translate a presentation.
 *
 * Request body:
 * - targetLang: Target language code (required, one of TRANSLATION_LANGS)
 * - sourceLang: Source language code (optional, defaults to active/dominant)
 * - vendor: LLM vendor to use (optional)
 * - overwrite: Overwrite existing translation (optional, default false)
 * - fillMissing: Fill only missing fields (optional, default true)
 */
async function handleTranslate(ctx, presentationId) {
  const { repoRoot, req, apiKey } = ctx;

  // Require 'ai' scope for translation
  if (!requireScope(ctx, 'ai')) return true;

  // Check daily AI rate limit
  if (!(await checkAiLimit(ctx))) return true;

  // Check if AI is disabled
  const flags = getFeatureFlags();
  if (flags.disableAi) {
    await apiError(ctx, 503, 'AI features are disabled');
    return true;
  }

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  // Load presentation
  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, { access: 'write' });
  if (!ok) return true;

  // Validate target language
  const targetLang = normalizeTranslationLang(body?.targetLang);
  if (!targetLang) {
    await apiError(ctx, 400, `Invalid targetLang. Supported languages: ${TRANSLATION_LANGS.join(', ')}`);
    return true;
  }

  // Initialize i18n structure
  pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions = pres.i18n.versions && typeof pres.i18n.versions === 'object'
    ? pres.i18n.versions
    : {};

  // Resolve source language
  const sourceLang =
    normalizeTranslationLang(body?.sourceLang) ||
    normalizeLang(pres.i18n.active) ||
    normalizeLang(pres.i18n.dominant) ||
    'nl';

  // Validate source != target
  if (sourceLang === targetLang) {
    await apiError(ctx, 400, 'Source and target languages must be different');
    return true;
  }

  const overwrite = !!body?.overwrite;
  const fillMissing = body?.fillMissing !== false; // default true
  const vendor = body?.vendor || null;

  // Ensure source version exists
  const dominant = normalizeLang(pres.i18n.dominant) || normalizeLang(sourceLang) || 'nl';
  pres.i18n.dominant = dominant;

  // Only update active if source is a legacy language
  if (normalizeLang(sourceLang)) {
    pres.i18n.active = sourceLang;
  }

  if (!pres.i18n.versions[dominant]) {
    pres.i18n.versions[dominant] = { title: pres.title, slides: pres.slides };
  }
  if (!pres.i18n.versions[sourceLang]) {
    pres.i18n.versions[sourceLang] = { title: pres.title, slides: pres.slides };
  }

  // Check if target already exists
  if (pres.i18n.versions[targetLang] && !overwrite && !fillMissing) {
    await apiError(ctx, 400, `Target language version already exists (${targetLang}). Set overwrite: true to replace it.`);
    return true;
  }

  // Get source content
  const src = pres.i18n.versions[sourceLang] && typeof pres.i18n.versions[sourceLang] === 'object'
    ? pres.i18n.versions[sourceLang]
    : { title: pres.title, slides: pres.slides };

  // Get existing target for fillMissing mode
  const existingTarget = !overwrite && pres.i18n.versions[targetLang] && typeof pres.i18n.versions[targetLang] === 'object'
    ? pres.i18n.versions[targetLang]
    : null;

  // Perform translation
  let translated;
  try {
    translated = await translatePresentationStrings(
      { title: src.title, slides: src.slides },
      {
        from: sourceLang,
        to: targetLang,
        existingTarget,
        fillMissing: !!fillMissing && !overwrite,
        vendor,
      }
    );
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message, { details: e.details || null });
      return true;
    }
    throw e;
  }

  // Store translation
  pres.i18n.versions[targetLang] = { title: translated.title, slides: translated.slides };

  // Update translation status
  pres.i18n.translation = pres.i18n.translation || {};
  pres.i18n.translation[targetLang] = {
    status: 'done',
    from: sourceLang,
    updatedAt: new Date().toISOString(),
  };

  // Persist
  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, pres, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message, { details: e.details || null });
      return true;
    }
    throw e;
  }

  // Track AI usage
  trackAiRequest(ctx).catch(() => {});

  await apiSuccess(ctx, {
    translated: true,
    from: sourceLang,
    to: targetLang,
    presentation: {
      id: updated.id,
      title: updated.title,
      revision: updated.revision || 0,
      i18n: updated.i18n || null,
    },
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id/translate/languages - List supported languages.
 */
async function handleListLanguages(ctx) {
  if (!requireScope(ctx, 'read')) return true;

  await apiSuccess(ctx, {
    languages: TRANSLATION_LANGS.map((code) => ({
      code,
      label: getLangLabel(code),
    })),
  });
  return true;
}

/**
 * Get human-readable label for a language code.
 */
function getLangLabel(code) {
  const labels = {
    'nl': 'Dutch',
    'en-GB': 'English (British)',
    'de': 'German',
    'fr': 'French',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'it': 'Italian',
    'pl': 'Polish',
    'fi': 'Finnish',
    'da': 'Danish',
    'sv': 'Swedish',
    'no': 'Norwegian',
  };
  return labels[code] || code;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/presentations/:id/translate routes.
 */
export async function handleTranslation(ctx) {
  const { req, res, url } = ctx;

  // GET /api/v1/translate/languages
  if (url.pathname === '/api/v1/translate/languages') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleListLanguages(ctx);
  }

  // POST /api/v1/presentations/:id/translate
  const translateMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/translate$/
  );
  if (translateMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleTranslate(ctx, translateMatch[1]);
  }

  return false;
}

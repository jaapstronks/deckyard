/**
 * Public API v1 - Translation endpoint.
 * Handles presentation translation via AI.
 */

import { updatePresentation } from '../../../storage/presentations/index.js';
import { translatePresentationStrings } from '../../../utils/openai/translate.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import {
  normalizeLang,
  TRANSLATION_LANGS,
  TRANSLATION_LANG_LABELS,
} from '../../../storage/presentations/i18n.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  readApiV1Body,
  checkAiLimit,
  trackAiRequest,
  apiSuccess,
  apiError,
} from './middleware.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';

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
  const { storageScope, req, apiKey } = ctx;

  // Require the 'ai' permission for translation
  if (!requirePermission(ctx, 'ai')) return true;

  // Check daily AI rate limit
  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, req);
  if (!bodyOk) return true;

  // Load presentation
  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, {
    access: 'write',
  });
  if (!ok) return true;

  // Validate target language
  const targetLang = normalizeLang(body?.targetLang);
  if (!targetLang) {
    await apiError(
      ctx,
      400,
      `Invalid targetLang. Supported languages: ${TRANSLATION_LANGS.join(', ')}`,
    );
    return true;
  }

  // Initialize i18n structure
  pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions =
    pres.i18n.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};

  // Resolve source language
  const sourceLang =
    normalizeLang(body?.sourceLang) ||
    normalizeLang(pres.i18n.active) ||
    normalizeLang(pres.i18n.dominant) ||
    DEFAULT_DECK_LANG;

  // Validate source != target
  if (sourceLang === targetLang) {
    await apiError(ctx, 400, 'Source and target languages must be different');
    return true;
  }

  const overwrite = !!body?.overwrite;
  const fillMissing = body?.fillMissing !== false; // default true
  const vendor = body?.vendor || null;

  // Ensure source version exists
  const dominant =
    normalizeLang(pres.i18n.dominant) ||
    normalizeLang(sourceLang) ||
    DEFAULT_DECK_LANG;
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
    await apiError(
      ctx,
      400,
      `Target language version already exists (${targetLang}). Set overwrite: true to replace it.`,
    );
    return true;
  }

  // Get source content
  const src =
    pres.i18n.versions[sourceLang] &&
    typeof pres.i18n.versions[sourceLang] === 'object'
      ? pres.i18n.versions[sourceLang]
      : { title: pres.title, slides: pres.slides };

  // Get existing target for fillMissing mode
  const existingTarget =
    !overwrite &&
    pres.i18n.versions[targetLang] &&
    typeof pres.i18n.versions[targetLang] === 'object'
      ? pres.i18n.versions[targetLang]
      : null;

  // Perform translation (a thrown LLM/status error is answered in the v1
  // envelope by the mount-level withV1ErrorHandler wrap).
  const translated = await translatePresentationStrings(
    { title: src.title, slides: src.slides },
    {
      from: sourceLang,
      to: targetLang,
      existingTarget,
      fillMissing: !!fillMissing && !overwrite,
      vendor,
    },
  );

  // Store translation
  pres.i18n.versions[targetLang] = {
    title: translated.title,
    slides: translated.slides,
  };

  // Update translation status
  pres.i18n.translation = pres.i18n.translation || {};
  pres.i18n.translation[targetLang] = {
    status: 'done',
    from: sourceLang,
    updatedAt: new Date().toISOString(),
  };

  // Persist (throws answered in the v1 envelope by the wrap).
  const updated = await updatePresentation(storageScope, presentationId, pres, {
    actorEmail: apiKey.ownerEmail,
  });

  // Track AI usage
  fireAndForget(trackAiRequest(ctx), 'v1 AI usage tracking');

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
  if (!requirePermission(ctx, 'read')) return true;

  await apiSuccess(ctx, {
    languages: TRANSLATION_LANGS.map((code) => ({
      code,
      label: TRANSLATION_LANG_LABELS[code],
    })),
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Translation routes. The translate rows are `ai`: with AI off they are not
 * mounted and answer the v1 404, like /ai/* does (./index.js), before the
 * permission or AI quota.
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/v1/translate/languages',
    handler: handleListLanguages,
  },
  {
    pattern: '/api/v1/translate/languages',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/translate$/,
    captures: ['uuid'],
    ai: true,
    handler: handleTranslate,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/translate$/,
    captures: ['uuid'],
    ai: true,
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
];

/**
 * Main handler for /api/v1/presentations/:id/translate routes.
 */
export const handleTranslation = withV1ErrorHandler(
  'public-api-v1:translate',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);

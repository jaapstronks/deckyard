/**
 * Public API v1 - Translation endpoint.
 *
 * `POST /presentations/{id}/translate` parses the v1 body and answers in the
 * v1 envelope; the translation itself is `translatePresentation`
 * (`server/services/translate.js`, B610), the same one the editor and the
 * translate worker call.
 */

import { translatePresentation } from '../../../services/translate.js';
import { AppError, isAppError } from '../../../utils/errors.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  readApiV1Body,
  checkAiLimit,
  trackAiRequest,
  apiSuccess,
} from './middleware.js';
import {
  TRANSLATION_LANGS,
  TRANSLATION_LANG_LABELS,
} from '../../../../shared/i18n-utils.js';

/**
 * v1 spells the language pair `sourceLang` / `targetLang`; the service (and
 * the editor's route) `from` / `to`. The body is read in v1's spelling and a
 * refusal that names the pair is answered in it, so a caller finds the field
 * it sent.
 */
const V1_FIELD = { from: 'sourceLang', to: 'targetLang' };

/** The service's refusal with `details.field` in v1's spelling. */
function inV1Spelling(err) {
  const field = isAppError(err) ? V1_FIELD[err.details?.field] : null;
  if (!field) return err;
  return new AppError(
    err.message,
    err.statusCode,
    { ...err.details, field },
    err.code,
  );
}

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
  const { storageScope, req, authedUser } = ctx;

  // Require the 'ai' permission for translation
  if (!requirePermission(ctx, 'ai')) return true;

  // Check daily AI rate limit
  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, req);
  if (!bodyOk) return true;

  // The service loads the deck (404/403), refuses the pair before the model
  // call and writes the version; a thrown refusal or model error is answered
  // in the v1 envelope by the mount-level withV1ErrorHandler wrap.
  let result;
  try {
    result = await translatePresentation(
      storageScope,
      { actor: authedUser },
      {
        presentationId,
        from: body?.sourceLang,
        to: body?.targetLang,
        overwrite: body?.overwrite,
        fillMissing: body?.fillMissing,
        vendor: getOptionalString(body, 'vendor'),
      },
    );
  } catch (err) {
    throw inV1Spelling(err);
  }
  const { from, to, presentation: updated } = result;

  // Track AI usage
  fireAndForget(trackAiRequest(ctx), 'v1 AI usage tracking');

  await apiSuccess(ctx, {
    translated: true,
    from,
    to,
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
 * Translation routes. The translate rows carry `feature: 'ai'`: with AI off they are not
 * mounted and answer the v1 404, like /ai/* does (./index.js), before the
 * permission or AI quota.
 */
export const ROUTES = [
  {
    method: 'GET',
    id: 'listTranslationLanguages',
    pattern: '/api/v1/translate/languages',
    handler: handleListLanguages,
  },
  {
    pattern: '/api/v1/translate/languages',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    id: 'translatePresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/translate$/,
    captures: ['uuid'],
    feature: 'ai',
    handler: handleTranslate,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/translate$/,
    captures: ['uuid'],
    feature: 'ai',
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

/**
 * Public API v1 - AI endpoints.
 * Handles AI generation features via API key authentication.
 */

import {
  assertCreatableDeckInput,
  createPresentation,
  publicDeckTimestamps,
} from '../../../services/presentations.js';
import { generateDeck, generatedDeckToParts } from '../../../utils/ai/index.js';
import { generateSlidesToAppendFromRawContent } from '../../../utils/openai/append.js';
import { getLlmStatus } from '../../../utils/llm/config.js';
import {
  deckToPresentationParts,
  deckThemeId,
  presentationToDeck,
} from '../../../../shared/slide-types.js';
import { loadAiThemeContext, loadDeckTheme } from '../../../utils/themes.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
import { clientDisconnectSignal } from '../../../utils/client-disconnect.js';
import {
  getAiParams,
  getOptionalObject,
} from '../../../utils/request-validators.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  readApiV1Body,
  checkAiLimit,
  trackAiRequest,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/ai/vendors - Get available LLM vendors.
 */
async function handleVendors(ctx) {
  // The 'read' permission is sufficient for checking vendors
  if (!requirePermission(ctx, 'read')) return true;

  const status = getLlmStatus();
  await apiSuccess(ctx, {
    vendors: status,
  });
  return true;
}

/**
 * POST /api/v1/ai/wizard - Generate a new presentation from text, through the
 * one generation pipeline the editor's wizard runs too (B759).
 */
async function handleWizard(ctx) {
  const { repoRoot, storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'ai')) return true;

  // Check AI limit
  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;
  // Refused before the generation, so a refused body costs no LLM call.
  assertCreatableDeckInput(body);

  const { raw, vendor, lang, theme, settings } = getAiParams(body);

  if (!raw.trim()) {
    await apiError(
      ctx,
      400,
      'Missing required field: raw (your content to generate from)',
    );
    return true;
  }

  // Checked before the generation, so an unknown theme costs no LLM call;
  // absent means the installation default, never the model's pick (B486).
  const {
    themeId: effectiveTheme,
    theme: themeConfig,
    titleSlideType,
    themeContext,
  } = await loadAiThemeContext(repoRoot, theme, storageScope);

  // Track AI request
  await trackAiRequest(ctx);

  // A failure below (the model, or a refusal of the create such as 409
  // `limit_exceeded`) is rendered by `withV1ErrorHandler` (B619). A client
  // that hangs up is no failure: the signal aborts the model calls and no
  // presentation is written for nobody, as on the editor's routes.
  const signal = clientDisconnectSignal(ctx.res);
  const slideTypes = await buildMergedSlideTypes(storageScope);
  let deck;
  try {
    deck = await generateDeck(raw, {
      userName: apiKey.name || 'API User',
      targetLang: lang,
      vendor,
      theme: effectiveTheme,
      titleSlideType,
      themeContext,
      slideTypes,
      ...(await loadSlideTypeOffer(apiKey)),
      signal,
    });
  } catch (e) {
    if (!signal.aborted) throw e;
    return true;
  }
  const parts = generatedDeckToParts(deck, { theme: themeConfig, slideTypes });
  if (signal.aborted) return true;

  // One create carries the generated slides (B609): the factory seeds the
  // language version from them. A storage refusal (the size limit) is the
  // service's `AppError`, rendered below like every other refusal.
  const created = await createPresentation(
    storageScope,
    { actor: ctx.authedUser },
    {
      title: parts.title,
      slides: parts.slides,
      theme: effectiveTheme,
      lang: deck.lang,
      ...(settings ? { settings } : {}),
    },
  );

  await apiCreated(ctx, {
    presentation: {
      id: created.id,
      title: created.title,
      slideCount: Array.isArray(created.slides) ? created.slides.length : 0,
      theme: created.theme,
      lang: created.lang || created.i18n?.dominant || DEFAULT_DECK_LANG,
      ...publicDeckTimestamps(created),
    },
  });
  return true;
}

/**
 * POST /api/v1/ai/append-slides - Generate slides to append to an existing presentation.
 */
async function handleAppendSlides(ctx) {
  const { repoRoot, apiKey, storageScope } = ctx;

  if (!requirePermission(ctx, 'ai')) return true;

  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;

  const { raw, vendor, lang } = getAiParams(body);
  if (!raw.trim()) {
    await apiError(
      ctx,
      400,
      'Missing required field: raw (your content to generate from)',
    );
    return true;
  }

  // Optional existing deck/presentation for context
  const deckInput = getOptionalObject(body, 'deck');
  const presInput = getOptionalObject(body, 'presentation');
  const existingDeck = deckInput
    ? deckInput
    : presInput
      ? presentationToDeck(presInput)
      : null;

  // Track AI request
  await trackAiRequest(ctx);

  // A model failure below is rendered by `withV1ErrorHandler` (B619).
  const slideTypeOffer = await loadSlideTypeOffer(apiKey);
  const { slides: generatedSlides } =
    await generateSlidesToAppendFromRawContent(raw, {
      existingDeck,
      targetLang: lang,
      vendor,
      ...slideTypeOffer,
    });

  // Normalize into internal slide format, against the theme of the deck the
  // slides are being appended to.
  const parts = deckToPresentationParts(generatedSlides, {
    theme: await loadDeckTheme(
      repoRoot,
      deckThemeId(existingDeck),
      storageScope,
    ),
    lang: lang || existingDeck?.lang,
    slideTypes: await buildMergedSlideTypes(storageScope),
  });
  const slides = Array.isArray(parts?.slides) ? parts.slides : [];

  await apiSuccess(ctx, {
    slides: slides.map((slide) => ({
      id: slide.id,
      type: slide.type,
      content: slide.content,
    })),
    slideCount: slides.length,
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * AI routes. The whole module's mount carries `feature: 'ai'` (./index.js),
 * so the rows need no `feature` of their own.
 */
export const ROUTES = [
  {
    method: 'GET',
    id: 'listAiVendors',
    pattern: '/api/v1/ai/vendors',
    handler: handleVendors,
  },
  {
    pattern: '/api/v1/ai/vendors',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    id: 'generatePresentationWithAi',
    pattern: '/api/v1/ai/wizard',
    handler: handleWizard,
  },
  {
    pattern: '/api/v1/ai/wizard',
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
  {
    method: 'POST',
    id: 'appendSlidesWithAi',
    pattern: '/api/v1/ai/append-slides',
    handler: handleAppendSlides,
  },
  {
    pattern: '/api/v1/ai/append-slides',
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
];

/**
 * Main handler for /api/v1/ai/* routes.
 */
export const handleAi = withV1ErrorHandler('public-api-v1:ai', (ctx) =>
  dispatchV1Routes(ROUTES, ctx),
);

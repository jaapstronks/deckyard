/**
 * Public API v1 - AI endpoints.
 * Handles AI generation features via API key authentication.
 */

import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations.js';
import { methodNotAllowed } from '../../../utils/http.js';
import {
  generateDeckJsonFromRawContent,
  generateSlidesToAppendFromRawContent,
} from '../../../utils/ai.js';
import { getLlmStatus } from '../../../utils/llm/config.js';
import { deckToPresentationParts, presentationToDeck } from '../../../../shared/slide-types.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../../config/sandbox.js';
import { loadDisabledSlideTypes, loadCustomSlideTypes } from '../../../utils/org-slide-types.js';
import {
  requireScope,
  parseJsonBody,
  checkAiLimit,
  trackAiRequest,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate and extract AI request parameters.
 */
function getAiParams(body) {
  return {
    raw: String(body?.raw || '').trim(),
    vendor: body?.vendor || null,
    lang: ['en-GB', 'nl'].includes(body?.lang) ? body.lang : null,
    theme: body?.theme || null,
  };
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/ai/vendors - Get available LLM vendors.
 */
async function handleVendors(ctx) {
  // Read scope is sufficient for checking vendors
  if (!requireScope(ctx, 'read')) return true;

  const status = getLlmStatus();
  await apiSuccess(ctx, {
    vendors: status,
  });
  return true;
}

/**
 * POST /api/v1/ai/wizard - Generate a new presentation from text.
 */
async function handleWizard(ctx) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'ai')) return true;

  // Check AI limit
  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, ctx.req);
  if (!bodyOk) return true;

  const { raw, vendor, lang, theme } = getAiParams(body);

  if (!raw) {
    await apiError(ctx, 400, 'Missing required field: raw (your content to generate from)');
    return true;
  }

  // Track AI request
  await trackAiRequest(ctx);

  try {
    // Generate deck using AI
    const [disabledSlideTypes, customSlideTypes] = await Promise.all([
      loadDisabledSlideTypes(apiKey),
      loadCustomSlideTypes(apiKey),
    ]);
    const deck = await generateDeckJsonFromRawContent(raw, {
      userName: apiKey.name || 'API User',
      targetLang: lang,
      vendor,
      disabledSlideTypes,
      customSlideTypes,
    });

    const parts = deckToPresentationParts(deck);

    // Create the presentation
    const effectiveTheme = theme || (sandboxEnabled() ? sandboxDefaultThemeId() : parts.theme);

    const created = await createPresentation(repoRoot, {
      title: parts.title,
      theme: effectiveTheme,
      ownerEmail: apiKey.ownerEmail,
      lang: lang || undefined,
    });

    // Build i18n structure for the active language
    const activeLang = created?.i18n?.active || created?.i18n?.dominant || lang || 'nl';
    const updatedI18n = {
      ...created.i18n,
      versions: {
        ...created.i18n?.versions,
        [activeLang]: {
          title: parts.title,
          slides: parts.slides,
        },
      },
    };

    // Update with generated content
    const updated = await updatePresentation(repoRoot, created.id, {
      ...created,
      title: parts.title,
      slides: parts.slides,
      i18n: updatedI18n,
    });

    await apiCreated(ctx, {
      presentation: {
        id: updated.id,
        title: updated.title,
        slideCount: Array.isArray(updated.slides) ? updated.slides.length : 0,
        theme: updated.themeId || updated.theme,
        language: updated.language || activeLang,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
    return true;

  } catch (e) {
    console.error('[Public API AI Wizard] Error:', e);
    const statusCode = e?.statusCode || 500;
    await apiError(ctx, statusCode, e?.message || 'Deck generation failed');
    return true;
  }
}

/**
 * POST /api/v1/ai/append-slides - Generate slides to append to an existing presentation.
 */
async function handleAppendSlides(ctx) {
  const { apiKey } = ctx;

  if (!requireScope(ctx, 'ai')) return true;

  if (!(await checkAiLimit(ctx))) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, ctx.req);
  if (!bodyOk) return true;

  const raw = String(body?.raw || '').trim();
  if (!raw) {
    await apiError(ctx, 400, 'Missing required field: raw (your content to generate from)');
    return true;
  }

  const vendor = body?.vendor || null;
  const lang = ['en-GB', 'nl'].includes(body?.lang) ? body.lang : null;

  // Optional existing deck/presentation for context
  const existingDeck =
    body?.deck && typeof body.deck === 'object'
      ? body.deck
      : body?.presentation && typeof body.presentation === 'object'
        ? presentationToDeck(body.presentation)
        : null;

  // Track AI request
  await trackAiRequest(ctx);

  try {
    const [disabledSlideTypes, customSlideTypes] = await Promise.all([
      loadDisabledSlideTypes(apiKey),
      loadCustomSlideTypes(apiKey),
    ]);
    const { slides: generatedSlides } = await generateSlidesToAppendFromRawContent(raw, {
      existingDeck,
      targetLang: lang,
      vendor,
      disabledSlideTypes,
      customSlideTypes,
    });

    // Normalize into internal slide format
    const parts = deckToPresentationParts(generatedSlides);
    const slides = Array.isArray(parts?.slides) ? parts.slides : [];

    // Ensure required image URLs are never blank
    for (const s of slides) {
      if (!s || typeof s !== 'object') continue;
      if (
        (s.type === 'image-slide' || s.type === 'image-text-slide') &&
        (!s.content ||
          typeof s.content !== 'object' ||
          typeof s.content.image !== 'string' ||
          !s.content.image.trim())
      ) {
        s.content = s.content && typeof s.content === 'object' ? s.content : {};
        s.content.image = '/assets/images/backgrounds/demo-aurora.jpg';
      }
    }

    await apiSuccess(ctx, {
      slides: slides.map((slide) => ({
        id: slide.id,
        type: slide.type,
        content: slide.content,
      })),
      slideCount: slides.length,
    });
    return true;

  } catch (e) {
    console.error('[Public API AI Append] Error:', e);
    const statusCode = e?.statusCode || 500;
    await apiError(ctx, statusCode, e?.message || 'Slide generation failed');
    return true;
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/ai/* routes.
 */
export async function handleAi(ctx) {
  const { req, res, url } = ctx;

  // GET /api/v1/ai/vendors
  if (url.pathname === '/api/v1/ai/vendors') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleVendors(ctx);
  }

  // POST /api/v1/ai/wizard
  if (url.pathname === '/api/v1/ai/wizard') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleWizard(ctx);
  }

  // POST /api/v1/ai/append-slides
  if (url.pathname === '/api/v1/ai/append-slides') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleAppendSlides(ctx);
  }

  return false;
}

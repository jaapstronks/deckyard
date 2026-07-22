import {
  createPresentation,
  updatePresentation,
} from '../../storage/presentations.js';
import { badRequest, json, serveJson } from '../../utils/http.js';
import {
  getAiParams,
  getBoolean,
  getLang,
  getOptionalObject,
  getOptionalString,
  getString,
  getTrimmedString,
} from '../../utils/request-validators.js';
import {
  deckToPresentationParts,
  presentationToDeck,
} from '../../../shared/slide-types.js';
import {
  generateDeckJsonFromRawContent,
  generateSlidesToAppendFromRawContent,
  convertSlideWithAi,
} from '../../utils/ai.js';
import { generateDeckV2, generateOutlineOnly, generateSessionId, createSessionLogger } from '../../utils/ai/index.js';
import { generateOutline, separateSlidesForProcessing } from '../../utils/ai/generate-outline.js';
import { refineAllSlideGroups } from '../../utils/ai/refine-slides.js';
import { validateAndFixRefinedSlides, validateSlideCount } from '../../utils/ai/validate-slides.js';
import { calculateTargetSlides } from '../../utils/ai/generate-outline.js';
import { analyzeForCompression, applyCompression } from '../../utils/ai/compress-deck.js';
import { refineSectionWithAi } from '../../utils/ai/refine-section.js';
import { getLlmStatus } from '../../utils/llm/config.js';
import { getDisplayNameForUser } from '../../utils/user-name.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../config/sandbox.js';
import { loadTheme, resolveThemeId } from '../../utils/themes.js';
import { loadDisabledSlideTypes, loadCustomSlideTypes } from '../../utils/org-slide-types.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('ai');

/**
 * Load disabled and custom slide type context for the authenticated user's org.
 */
async function loadSlideTypeContext(authedUser) {
  const [disabled, custom] = await Promise.all([
    loadDisabledSlideTypes(authedUser),
    loadCustomSlideTypes(authedUser),
  ]);
  return { disabled, custom };
}

/**
 * Extract theme context for AI generation.
 * Provides the AI with theme-specific information to make better content decisions.
 */
function extractThemeContext(theme) {
  if (!theme) return null;

  const ctx = {};

  // Available slide background options (lime, mist, dark are standard)
  const bgOptions = [];
  const vars = theme.cssVars || {};
  if (vars['--t-slide-bg-lime']) bgOptions.push('lime');
  if (vars['--t-slide-bg-mist']) bgOptions.push('mist');
  if (vars['--t-slide-bg-dark']) bgOptions.push('dark');
  if (bgOptions.length) ctx.backgroundOptions = bgOptions;

  // Brand colors
  if (theme.brandColors?.length) {
    ctx.brandColors = theme.brandColors;
  }

  // Whether theme has background image presets
  if (theme.backgroundPresets?.length) {
    ctx.hasBackgroundImages = true;
  }

  return Object.keys(ctx).length ? ctx : null;
}

/**
 * Re-attach AI review metadata (reasoning + alternative types) to normalized
 * slides. deckToPresentationParts strips unknown slide keys, and both arrays
 * map 1:1 by index, so this restores what the pipeline produced.
 */
function reattachAiMeta(normalizedSlides, sourceSlides) {
  (normalizedSlides || []).forEach((s, i) => {
    const src = sourceSlides?.[i];
    if (!src || !s || typeof s !== 'object') return;
    if (src._aiReasoning) s._aiReasoning = src._aiReasoning;
    if (Array.isArray(src._aiAlternatives) && src._aiAlternatives.length) {
      s._aiAlternatives = src._aiAlternatives;
    }
  });
}

/**
 * Create a presentation and initialize its i18n structure with the generated slides.
 * Consolidates the repeated create→update-with-i18n pattern used across wizard endpoints.
 */
async function createPresentationWithI18n(repoRoot, { parts, lang, authedUser, theme, settings, notionSourcePageId }) {
  const created = await createPresentation(repoRoot, {
    title: parts.title,
    theme,
    ownerEmail: authedUser?.email || null,
    lang: lang || undefined,
    ...(settings ? { settings } : {}),
    ...(notionSourcePageId ? { notionSourcePageId } : {}),
  });

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

  return updatePresentation(repoRoot, created.id, {
    ...created,
    title: parts.title,
    slides: parts.slides,
    i18n: updatedI18n,
  });
}

export async function handleAi({ repoRoot, req, res, url, authedUser }) {
  // LLM vendor discovery for UI configuration.
  if (url.pathname === '/api/ai/vendors' && req.method === 'GET') {
    serveJson(res, 200, getLlmStatus());
    return true;
  }

  // AI Wizard: generate a deck from raw input and create a new presentation.
  if (url.pathname === '/api/ai/wizard' && req.method === 'POST') {
    const body = await json(req);
    const { raw, vendor, lang, theme: themeFromRequest, settings: settingsFromRequest } = getAiParams(body);
    if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
    const notionSourcePageId = getTrimmedString(body, 'notionSourcePageId');

    const userName = getDisplayNameForUser(authedUser);
    const slideTypeCtx = await loadSlideTypeContext(authedUser);
    const deck = await generateDeckJsonFromRawContent(raw, {
      userName,
      targetLang: lang,
      vendor,
      disabledSlideTypes: slideTypeCtx.disabled,
      customSlideTypes: slideTypeCtx.custom,
    });
    const parts = deckToPresentationParts(deck);

    // Theme is chosen by the user at creation time; do not let the model/environment decide.
    const effectiveTheme = themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : parts.theme);

    const updated = await createPresentationWithI18n(repoRoot, {
      parts, lang, authedUser, theme: effectiveTheme,
      settings: settingsFromRequest, notionSourcePageId,
    });
    serveJson(res, 201, updated);
    return true;
  }

  // AI Wizard V2: Two-phase deck generation with better slide type selection.
  // This endpoint uses the new two-phase approach for testing/comparison.
  if (url.pathname === '/api/ai/wizard-v2' && req.method === 'POST') {
    const body = await json(req);
    const { raw, vendor, lang, theme: themeFromRequest, settings: settingsFromRequest } = getAiParams(body);
    if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
    const enableLogging = getBoolean(body, 'enableLogging', true);

    const userName = getDisplayNameForUser(authedUser);
    const effectiveTheme = themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : 'default');

    // Load theme to get the correct title slide type and theme context for AI
    let titleSlideType = 'title-slide';
    let themeContext = null;
    try {
      const themeId = resolveThemeId(effectiveTheme);
      const theme = await loadTheme(repoRoot, themeId);
      titleSlideType = theme?.defaultTitleSlide || 'title-slide';
      themeContext = extractThemeContext(theme);
    } catch {
      // ignore theme loading errors, use default
    }

    const slideTypeCtx = await loadSlideTypeContext(authedUser);
    try {
      const deck = await generateDeckV2(raw, {
        userName,
        targetLang: lang,
        vendor,
        theme: effectiveTheme,
        titleSlideType,
        enableLogging,
        disabledSlideTypes: slideTypeCtx.disabled,
        customSlideTypes: slideTypeCtx.custom,
        themeContext,
      });

      const parts = deckToPresentationParts(deck);
      reattachAiMeta(parts.slides, deck.slides);

      const updated = await createPresentationWithI18n(repoRoot, {
        parts, lang, authedUser, theme: effectiveTheme,
        settings: settingsFromRequest,
      });

      // Include generation metadata for debugging
      serveJson(res, 201, {
        ...updated,
        _generationMeta: deck._generationMeta,
      });
    } catch (e) {
      log.error('[AI Wizard V2] Error:', e);
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, {
        error: e?.message || 'Deck generation failed',
        details: e?.rawResponse?.slice(0, 1000),
      });
    }
    return true;
  }

  // AI Wizard V2 Preview: Get outline only (for debugging/preview).
  if (url.pathname === '/api/ai/wizard-v2/outline' && req.method === 'POST') {
    const body = await json(req);
    const raw = getString(body, 'raw');
    if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
    const vendor = getOptionalString(body, 'vendor');
    const lang = getLang(body);

    const userName = getDisplayNameForUser(authedUser);

    try {
      const outline = await generateOutlineOnly(raw, {
        userName,
        targetLang: lang,
        vendor,
      });
      serveJson(res, 200, outline);
    } catch (e) {
      log.error('[AI Outline] Error:', e);
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, {
        error: e?.message || 'Outline generation failed',
      });
    }
    return true;
  }

  // AI Wizard V2 Streaming: Server-Sent Events for progress + final result.
  // Returns status messages during generation, then the final presentation.
  if (url.pathname === '/api/ai/wizard-v2/stream' && req.method === 'POST') {
    const body = await json(req);
    const { raw, vendor, lang, theme: themeFromRequest, settings: settingsFromRequest } = getAiParams(body);
    if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
    const notionSourcePageId = getTrimmedString(body, 'notionSourcePageId');
    const enableLogging = getBoolean(body, 'enableLogging', true);
    const targetLength = getOptionalString(body, 'targetLength') || 'auto';

    const userName = getDisplayNameForUser(authedUser);
    const slideTypeCtx = await loadSlideTypeContext(authedUser);
    const sessionId = generateSessionId();
    const logger = enableLogging ? createSessionLogger(sessionId) : null;
    const effectiveTheme = themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : 'default');

    // Load theme to get the correct title slide type and theme context for AI
    let titleSlideType = 'title-slide';
    let themeContext = null;
    try {
      const themeId = resolveThemeId(effectiveTheme);
      const theme = await loadTheme(repoRoot, themeId);
      titleSlideType = theme?.defaultTitleSlide || 'title-slide';
      themeContext = extractThemeContext(theme);
    } catch {
      // ignore theme loading errors, use default
    }

    log.info(`[AI Wizard V2 Stream] Starting session ${sessionId}, theme: ${effectiveTheme}, titleSlideType: ${titleSlideType}, targetLength: ${targetLength}`);

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Phase 1: Generate outline (get status messages)
      sendEvent('status', { message: 'Analyzing your content...', phase: 'outline' });

      const outline = await generateOutline(raw, {
        userName,
        targetLang: lang,
        vendor,
        targetLength,
        onLog: logger ? (data) => logger.logPhase1(data) : null,
      });

      // Send status messages to client. The rotator on the client replays
      // these while sections are being written; real per-section progress
      // events (phase 'refine-progress') below take over as groups finish.
      const statusMessages = outline.statusMessages || [];
      sendEvent('messages', { statusMessages, total: outline.slides.length });

      // Phase 2: Separate structural vs content slides
      const { structuralSlides, contentGroups } = separateSlidesForProcessing(outline.slides);
      const langCode = outline.metadata.requestedLang || outline.metadata.detectedLang || 'en';

      // Informational (phase 'refine'): shown only until the rotator has its
      // messages; real per-section events below use 'refine-progress' and
      // take over the modal.
      sendEvent('status', {
        message:
          langCode === 'nl'
            ? `Outline klaar: ${outline.slides.length} slides in ${contentGroups.length} secties…`
            : `Outline ready: ${outline.slides.length} slides in ${contentGroups.length} sections…`,
        progress: 20,
        phase: 'refine',
      });

      // Only send content slides to AI refinement
      let refinedContentSlides = [];
      if (contentGroups.length > 0) {
        refinedContentSlides = await refineAllSlideGroups(contentGroups, {
          lang: langCode,
          vendor,
          batchSize: 6,
          presentationContext: {
            title: outline.title,
            summary: outline.summary,
          },
          onLog: logger ? (data) => logger.logPhase2Call(data) : null,
          disabledSlideTypes: slideTypeCtx.disabled,
          customSlideTypes: slideTypeCtx.custom,
          themeContext,
          // Real progress: one event per finished section group.
          onGroupDone: ({ done, total }) => {
            sendEvent('status', {
              message:
                langCode === 'nl'
                  ? `Sectie ${done} van ${total} geschreven…`
                  : `Wrote section ${done} of ${total}…`,
              progress: Math.round(20 + (done / total) * 65),
              phase: 'refine-progress',
            });
          },
        });
      }

      // Combine structural + content slides, sorted by original index
      const allSlides = [...structuralSlides, ...refinedContentSlides]
        .sort((a, b) => a.originalIndex - b.originalIndex);

      // Validate and fix slides to meet minimum requirements
      const validatedSlides = validateAndFixRefinedSlides(allSlides);

      // Validate slide count against target budget
      const { targetSlides: budgetTarget } = calculateTargetSlides(raw, targetLength);
      const budgetValidation = validateSlideCount(validatedSlides, budgetTarget);

      // Assemble deck with automatic title slide using theme-appropriate type
      const { cryptoUuid } = await import('../../../shared/slide-types/helpers.js');
      const deck = {
        format: 'slidecreator.deck',
        version: 1,
        title: outline.title,
        theme: effectiveTheme,
        slides: [
          // Automatic title slide first using the theme-appropriate type
          {
            id: cryptoUuid(),
            type: titleSlideType,
            content: {
              title: outline.title || 'Presentation',
              subtitle: outline.subtitle || '',
              background: 'lime',
            },
            notes: '',
            _aiReasoning: 'Automatic title slide',
          },
          // Then all other slides with presenter notes
          ...validatedSlides.map((refined) => ({
            id: cryptoUuid(),
            type: refined.type,
            content: refined.content,
            notes: refined.presenterNotes || '',
            _aiReasoning: refined.reasoning,
            ...(refined.alternativeType
              ? {
                  _aiAlternatives: [
                    {
                      type: refined.alternativeType,
                      reason: refined.alternativeReason || '',
                    },
                  ],
                }
              : {}),
          })),
        ],
      };

      const parts = deckToPresentationParts(deck);
      // Keep the per-slide "why this type" + alternatives on the saved slides;
      // the whole-deck review grid reads them after the editor loads the deck.
      reattachAiMeta(parts.slides, deck.slides);

      // Create presentation
      sendEvent('status', { message: 'Saving your presentation...', progress: 90, phase: 'save' });

      const updated = await createPresentationWithI18n(repoRoot, {
        parts, lang, authedUser, theme: effectiveTheme,
        settings: settingsFromRequest, notionSourcePageId,
      });

      // Finalize logging
      if (logger) {
        logger.finalize(deck, {
          sessionId,
          totalSlides: updated.slides?.length || 0,
          endpoint: 'wizard-v2/stream',
        });
      }

      // Send final result
      sendEvent('complete', {
        presentation: updated,
        sessionId,
        slideCount: updated.slides?.length || 0,
        budget: {
          target: budgetTarget,
          actual: budgetValidation.contentSlides,
          percentage: budgetValidation.percentage,
          overBudget: budgetValidation.overBudget,
        },
      });

    } catch (e) {
      log.error('[AI Wizard V2 Stream] Error:', e);

      // Log the error too
      if (logger) {
        try {
          logger.finalize({ error: e?.message }, { sessionId, failed: true });
        } catch { /* ignore logging errors */ }
      }

      sendEvent('error', {
        error: e?.message || 'Deck generation failed',
      });
    }

    res.end();
    return true;
  }

  // AI Wizard: generate slides to append to an existing presentation (editor flow).
  if (url.pathname === '/api/ai/append-slides' && req.method === 'POST') {
    const body = await json(req);
    const raw = getString(body, 'raw');
    if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
    const vendor = getOptionalString(body, 'vendor');
    const lang = getLang(body);
    const contentOnly = getBoolean(body, 'contentOnly', false);
    const verbatim = getBoolean(body, 'verbatim', false);
    // Revision mode (batch review "Adjust"): prior batch + feedback on it.
    const priorSlides = Array.isArray(body?.priorSlides) ? body.priorSlides : null;
    const feedback = getOptionalString(body, 'feedback');

    const existingDeck =
      body?.deck && typeof body.deck === 'object'
        ? body.deck
        : body?.presentation && typeof body.presentation === 'object'
        ? presentationToDeck(body.presentation)
        : null;

    const slideTypeCtx = await loadSlideTypeContext(authedUser);
    const {
      slides: generatedSlides,
      rationale,
      review,
    } = await generateSlidesToAppendFromRawContent(raw, {
      existingDeck,
      targetLang: lang,
      vendor,
      contentOnly,
      verbatim,
      disabledSlideTypes: slideTypeCtx.disabled,
      customSlideTypes: slideTypeCtx.custom,
      priorSlides,
      feedback,
    });

    // Normalize into internal slide format so validation is stable and ids exist.
    const parts = deckToPresentationParts(generatedSlides);
    let slides = Array.isArray(parts?.slides) ? parts.slides : [];

    // Validate slides and log any issues (unknown fields, schema mismatches, etc.)
    slides = validateAndFixRefinedSlides(slides);

    // Re-attach per-slide review metadata (normalization strips unknown slide
    // keys). Both arrays map 1:1 by index onto the generated batch.
    slides.forEach((s, i) => {
      const meta = review?.[i];
      if (!meta || !s || typeof s !== 'object') return;
      if (meta.why) s._aiReasoning = meta.why;
      if (meta.alternatives?.length) s._aiAlternatives = meta.alternatives;
    });

    // Extra safety: ensure required image URLs are never blank.
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

    serveJson(res, 200, { slides, rationale });
    return true;
  }

  // Section refine: revise a contiguous range of slides from user feedback
  // (whole-deck review grid's multi-select "Adjust section" action).
  if (url.pathname === '/api/ai/refine-section' && req.method === 'POST') {
    const body = await json(req);
    const presentation = getOptionalObject(body, 'presentation');
    if (!presentation || !Array.isArray(presentation.slides)) {
      return badRequest(res, 'Expected { presentation: { slides: [...] }, slideIds: [...], feedback: "..." }');
    }
    const slideIds = Array.isArray(body?.slideIds)
      ? body.slideIds.filter((x) => typeof x === 'string' && x)
      : [];
    if (!slideIds.length) return badRequest(res, 'Expected non-empty slideIds array.');
    const feedback = getTrimmedString(body, 'feedback');
    if (!feedback) return badRequest(res, 'Expected { feedback: "..." }');

    // The revision replaces a contiguous range: span from the first to the
    // last selected slide (gaps in the selection are included in the section).
    const wanted = new Set(slideIds);
    const indices = presentation.slides
      .map((s, i) => (s?.id && wanted.has(s.id) ? i : -1))
      .filter((i) => i >= 0);
    if (!indices.length) {
      return badRequest(res, 'None of the given slideIds exist in the presentation.');
    }
    const start = Math.min(...indices);
    const end = Math.max(...indices);

    const vendor = getOptionalString(body, 'vendor');
    const lang = getLang(body);
    const slideTypeCtx = await loadSlideTypeContext(authedUser);

    try {
      const { slides: revisedRaw, rationale, review } = await refineSectionWithAi(
        presentation,
        {
          start,
          end,
          feedback,
          targetLang: lang,
          vendor,
          disabledSlideTypes: slideTypeCtx.disabled,
          customSlideTypes: slideTypeCtx.custom,
        }
      );

      // Normalize so ids exist and content matches schemas, then re-attach the
      // per-slide "why" (normalization strips unknown keys).
      const parts = deckToPresentationParts(revisedRaw);
      let slides = Array.isArray(parts?.slides) ? parts.slides : [];
      slides = validateAndFixRefinedSlides(slides);
      slides.forEach((s, i) => {
        if (review?.[i]?.why) s._aiReasoning = review[i].why;
      });

      serveJson(res, 200, { slides, rationale, range: { start, end } });
    } catch (e) {
      log.error('[AI Refine Section] Error:', e);
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, { error: e?.message || 'Section refine failed' });
    }
    return true;
  }

  // AI-assisted slide conversion: convert a slide to a different type using AI.
  if (url.pathname === '/api/ai/convert-slide' && req.method === 'POST') {
    const body = await json(req);
    const slide = getOptionalObject(body, 'slide');
    const toType = getTrimmedString(body, 'toType');
    if (!slide) {
      return badRequest(res, 'Expected { slide: {...}, toType: "..." }');
    }
    if (!toType) {
      return badRequest(res, 'Expected { toType: "..." }');
    }

    const vendor = getOptionalString(body, 'vendor');
    const lang = getLang(body) || 'nl';

    try {
      const converted = await convertSlideWithAi(slide, toType, {
        vendor,
        lang,
      });
      serveJson(res, 200, { slide: converted });
    } catch (e) {
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, { error: e?.message || 'Conversion failed' });
    }
    return true;
  }

  // AI Deck Compression: analyze a presentation for consolidation opportunities.
  if (url.pathname === '/api/ai/compress-deck' && req.method === 'POST') {
    const body = await json(req);
    const presentation = getOptionalObject(body, 'presentation');
    if (!presentation || !Array.isArray(presentation.slides)) {
      return badRequest(res, 'Expected { presentation: { slides: [...] } }');
    }

    const vendor = getOptionalString(body, 'vendor');
    const targetReduction = getOptionalString(body, 'targetReduction') || 'moderate';
    const applyChanges = getBoolean(body, 'applyChanges', false);

    try {
      const recommendations = await analyzeForCompression(presentation, {
        targetReduction,
        vendor,
      });

      if (applyChanges && (recommendations.merges.length > 0 || recommendations.removals.length > 0)) {
        const compressed = applyCompression(presentation, recommendations);
        serveJson(res, 200, {
          recommendations,
          presentation: compressed,
          applied: true,
        });
      } else {
        serveJson(res, 200, {
          recommendations,
          applied: false,
        });
      }
    } catch (e) {
      log.error('[AI Compress Deck] Error:', e);
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, { error: e?.message || 'Compression analysis failed' });
    }
    return true;
  }

  // ─── Iterate Deck / Slide ──────────────────────────────────────────────
  if (url.pathname === '/api/ai/iterate' && req.method === 'POST') {
    const body = await json(req);
    const presentation = getOptionalObject(body, 'presentation');
    if (!presentation || !Array.isArray(presentation.slides)) {
      return badRequest(res, 'Expected { presentation: { slides: [...] }, command: "..." }');
    }

    const command = getTrimmedString(body, 'command');
    if (!command) {
      return badRequest(res, 'Expected { command: "make this punchier" }');
    }

    const vendor = getOptionalString(body, 'vendor');
    const lang = getLang(body) || 'en';
    const applyChanges = getBoolean(body, 'applyChanges', true);

    // Per-slide refine sends the index of the slide being edited so the LLM
    // works on that slide instead of the whole deck (validated in the util).
    const rawIndex = Number(body?.currentSlideIndex);
    const currentSlideIndex = Number.isInteger(rawIndex) ? rawIndex : null;

    const slideTypeCtx = await loadSlideTypeContext(authedUser);

    try {
      const { iteratePresentation } = await import('../../utils/ai/iterate-deck.js');
      const { deck: newDeck, plan, targetSlideIndex } = await iteratePresentation(presentation, command, {
        lang,
        vendor,
        currentSlideIndex,
        disabledSlideTypes: slideTypeCtx.disabled,
        customSlideTypes: slideTypeCtx.custom,
      });

      serveJson(res, 200, {
        plan,
        presentation: applyChanges ? newDeck : null,
        applied: applyChanges,
        targetSlideIndex,
      });
    } catch (e) {
      log.error('[AI Iterate] Error:', e);
      const statusCode = e?.statusCode || 500;
      serveJson(res, statusCode, { error: e?.message || 'Iteration failed' });
    }
    return true;
  }

  return false;
}

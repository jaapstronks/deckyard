import { badRequest, json } from '../../../utils/http.js';
import {
  getAiParams,
  getBoolean,
  getOptionalString,
  getTrimmedString,
} from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { generateSessionId, createSessionLogger } from '../../../utils/ai/index.js';
import {
  generateOutline,
  separateSlidesForProcessing,
  calculateTargetSlides,
} from '../../../utils/ai/generate-outline.js';
import { refineAllSlideGroups } from '../../../utils/ai/refine-slides.js';
import {
  validateAndFixRefinedSlides,
  validateSlideCount,
} from '../../../utils/ai/validate-slides.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../../config/sandbox.js';
import {
  log,
  loadSlideTypeContext,
  loadAiThemeContext,
  reattachAiMeta,
  createPresentationWithI18n,
} from './shared.js';

/**
 * POST /api/ai/wizard-v2/stream — Server-Sent Events for progress + final
 * result. Streams status messages during generation, then the final
 * presentation.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2Stream({ repoRoot, req, res, authedUser }) {
  const body = await json(req);
  const {
    raw,
    vendor,
    lang,
    theme: themeFromRequest,
    settings: settingsFromRequest,
  } = getAiParams(body);
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const notionSourcePageId = getTrimmedString(body, 'notionSourcePageId');
  const enableLogging = getBoolean(body, 'enableLogging', true);
  const targetLength = getOptionalString(body, 'targetLength') || 'auto';

  const userName = getDisplayNameForUser(authedUser);
  const slideTypeCtx = await loadSlideTypeContext(authedUser);
  const sessionId = generateSessionId();
  const logger = enableLogging ? createSessionLogger(sessionId) : null;
  const effectiveTheme =
    themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : 'default');

  // Load theme to get the correct title slide type and theme context for AI
  const { titleSlideType, themeContext } = await loadAiThemeContext(
    repoRoot,
    effectiveTheme
  );

  log.info(
    `[AI Wizard V2 Stream] Starting session ${sessionId}, theme: ${effectiveTheme}, titleSlideType: ${titleSlideType}, targetLength: ${targetLength}`
  );

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
    const { structuralSlides, contentGroups } = separateSlidesForProcessing(
      outline.slides
    );
    const langCode =
      outline.metadata.requestedLang || outline.metadata.detectedLang || 'en';

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
    const allSlides = [...structuralSlides, ...refinedContentSlides].sort(
      (a, b) => a.originalIndex - b.originalIndex
    );

    // Validate and fix slides to meet minimum requirements
    const validatedSlides = validateAndFixRefinedSlides(allSlides);

    // Validate slide count against target budget
    const { targetSlides: budgetTarget } = calculateTargetSlides(raw, targetLength);
    const budgetValidation = validateSlideCount(validatedSlides, budgetTarget);

    // Assemble deck with automatic title slide using theme-appropriate type
    const { cryptoUuid } = await import('../../../../shared/slide-types/helpers.js');
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
    sendEvent('status', {
      message: 'Saving your presentation...',
      progress: 90,
      phase: 'save',
    });

    const updated = await createPresentationWithI18n(repoRoot, {
      parts,
      lang,
      authedUser,
      theme: effectiveTheme,
      settings: settingsFromRequest,
      notionSourcePageId,
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
      } catch {
        /* ignore logging errors */
      }
    }

    sendEvent('error', {
      error: e?.message || 'Deck generation failed',
    });
  }

  res.end();
  return true;
}

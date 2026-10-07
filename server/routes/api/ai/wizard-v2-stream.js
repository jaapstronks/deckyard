import { badRequest, requireJsonBody } from '../../../utils/http.js';
import {
  getAiParams,
  getBoolean,
  getOptionalString,
  getTrimmedString,
} from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';
import { DECK_FORMAT_ID } from '../../../../shared/slide-types/deck-format-id.js';
import {
  generateSessionId,
  createSessionLogger,
} from '../../../utils/ai/index.js';
import {
  generateOutline,
  separateSlidesForProcessing,
  calculateTargetSlides,
} from '../../../utils/ai/generate-outline.js';
import { refineAllSlideGroups } from '../../../utils/ai/refine-slides.js';
import {
  validateAndFixRefinedSlides,
  validateSlideCount,
} from '../../../utils/ai/validate-slides/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import {
  OUTLINE_CREEP_MS,
  PROGRESS,
  REFINE_CREEP_MS,
} from '../../../utils/import-progress.js';
import {
  log,
  loadSlideTypeContext,
  loadAiThemeContext,
  reattachAiMeta,
  createDeckFromParts,
} from './shared.js';

/**
 * POST /api/ai/wizard-v2/stream — Server-Sent Events for progress + final
 * result. Streams status messages during generation, then the final
 * presentation.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2Stream({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the stream opens, so a refused body costs no LLM call (B576).
  assertCreatableDeckInput(body);
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
  // Settle the theme to get the correct title slide type and theme context
  // for AI; an unknown theme is refused here, before the stream opens.
  const {
    themeId: effectiveTheme,
    titleSlideType,
    themeContext,
    theme,
  } = await loadAiThemeContext(repoRoot, themeFromRequest, storageScope);

  log.info(
    `[AI Wizard V2 Stream] Starting session ${sessionId}, theme: ${effectiveTheme}, titleSlideType: ${titleSlideType}, targetLength: ${targetLength}`,
  );

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal aborts both model phases and
  // is checked before the presentation is written.
  const { signal } = stream;

  try {
    // Phase 1: Generate outline. One long model call with no events of its
    // own, so the bar creeps toward the refine floor instead of standing
    // still (B595; `docs/reference/import-progress.md`).
    sseWrite(res, {
      event: 'status',
      data: {
        message: 'Analyzing your content...',
        phase: 'outline',
        progress: PROGRESS.parse,
        creepTo: PROGRESS.refineFloor,
        creepMs: OUTLINE_CREEP_MS,
      },
    });

    const outline = await generateOutline(raw, {
      userName,
      targetLang: lang,
      vendor,
      targetLength,
      onLog: logger ? (data) => logger.logPhase1(data) : null,
      signal,
    });

    // Send status messages to client. The rotator on the client replays
    // these while sections are being written; real per-section progress
    // events (phase 'refine-progress') below take over as groups finish.
    const statusMessages = outline.statusMessages || [];
    sseWrite(res, {
      event: 'messages',
      data: { statusMessages, total: outline.slides.length },
    });

    // Phase 2: Separate structural vs content slides
    const { structuralSlides, contentGroups } = separateSlidesForProcessing(
      outline.slides,
    );
    const langCode =
      outline.metadata.requestedLang || outline.metadata.detectedLang || 'en';

    // Informational (phase 'refine'): shown only until the rotator has its
    // messages; real per-section events below use 'refine-progress' and
    // take over the modal.
    sseWrite(res, {
      event: 'status',
      data: {
        message:
          langCode === 'nl'
            ? `Outline klaar: ${outline.slides.length} slides in ${contentGroups.length} secties…`
            : `Outline ready: ${outline.slides.length} slides in ${contentGroups.length} sections…`,
        progress: PROGRESS.refineFloor,
        creepTo: PROGRESS.refineCeiling,
        creepMs: REFINE_CREEP_MS,
        phase: 'refine',
      },
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
        signal,
        disabledSlideTypes: slideTypeCtx.disabled,
        customSlideTypes: slideTypeCtx.custom,
        themeContext,
        // Real progress: one event per finished section group.
        onGroupDone: ({ done, total }) => {
          sseWrite(res, {
            event: 'status',
            data: {
              message:
                langCode === 'nl'
                  ? `Sectie ${done} van ${total} geschreven…`
                  : `Wrote section ${done} of ${total}…`,
              progress: Math.round(
                PROGRESS.refineFloor +
                  (done / total) *
                    (PROGRESS.refineCeiling - PROGRESS.refineFloor),
              ),
              phase: 'refine-progress',
            },
          });
        },
      });
    }

    // Combine structural + content slides, sorted by original index
    const allSlides = [...structuralSlides, ...refinedContentSlides].sort(
      (a, b) => a.originalIndex - b.originalIndex,
    );

    // Validate and fix slides to meet minimum requirements
    const validatedSlides = validateAndFixRefinedSlides(allSlides);

    // Validate slide count against target budget
    const { targetSlides: budgetTarget } = calculateTargetSlides(
      raw,
      targetLength,
    );
    const budgetValidation = validateSlideCount(validatedSlides, budgetTarget);

    // Assemble deck with automatic title slide using theme-appropriate type
    const deck = {
      format: DECK_FORMAT_ID,
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

    const parts = deckToPresentationParts(deck, { theme, lang: langCode });
    // Keep the per-slide "why this type" + alternatives on the saved slides;
    // the whole-deck review grid reads them after the editor loads the deck.
    reattachAiMeta(parts.slides, deck.slides);

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

    // Create presentation
    sseWrite(res, {
      event: 'status',
      data: {
        message: 'Saving your presentation...',
        progress: PROGRESS.save,
        phase: 'save',
      },
    });

    const updated = await createDeckFromParts(storageScope, {
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
    sseWrite(res, {
      event: 'complete',
      data: {
        presentation: updated,
        sessionId,
        slideCount: updated.slides?.length || 0,
        budget: {
          target: budgetTarget,
          actual: budgetValidation.totalSlides,
          percentage: budgetValidation.percentage,
          overBudget: budgetValidation.overBudget,
        },
      },
    });
  } catch (e) {
    if (signal.aborted) {
      log.info(`[AI Wizard V2 Stream] ${sessionId}: cancelled by the client`);
      res.end();
      return true;
    }

    log.error('[AI Wizard V2 Stream] Error:', e);

    // Log the error too
    if (logger) {
      try {
        logger.finalize({ error: e?.message }, { sessionId, failed: true });
      } catch {
        /* ignore logging errors */
      }
    }

    sseError(res, e?.message || 'Deck generation failed');
  }

  res.end();
  return true;
}

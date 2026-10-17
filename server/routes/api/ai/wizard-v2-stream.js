import { badRequest, requireJsonBody } from '../../../utils/http.js';
import {
  getAiParams,
  getOptionalString,
  getTrimmedString,
} from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import {
  generateDeck,
  generateSessionId,
  createSessionLogger,
} from '../../../utils/ai/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { loadAiThemeContext } from '../../../utils/themes.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import {
  OUTLINE_CREEP_MS,
  PROGRESS,
  REFINE_CREEP_MS,
} from '../../../utils/import-progress.js';
import { log, reattachAiMeta, createDeckFromParts } from './shared.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

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
  const targetLength = getOptionalString(body, 'targetLength') || 'auto';

  const userName = getDisplayNameForUser(authedUser);
  const slideTypeOffer = await loadSlideTypeOffer(authedUser);
  // The map the org's types were offered from is the one they are refined,
  // fixed and composed in (B247).
  const slideTypes = await buildMergedSlideTypes(storageScope);
  const sessionId = generateSessionId();
  const logger = createSessionLogger(sessionId);
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
    // Phase 1 is a few long model calls with no events of their own, so the
    // bar creeps toward the refine floor instead of standing still (B595;
    // `docs/reference/import-progress.md`).
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

    // The progress copy follows the deck language, known once the outline is.
    let nl = false;
    // The one generation pipeline (B756); this route only reports on it.
    const deck = await generateDeck(raw, {
      userName,
      targetLang: lang,
      vendor,
      targetLength,
      theme: effectiveTheme,
      titleSlideType,
      themeContext,
      slideTypes,
      ...slideTypeOffer,
      signal,
      logger,
      onOutline: (outline, { sections }) => {
        // The rotator on the client replays these while sections are being
        // written; the per-section events below take over as groups finish.
        sseWrite(res, {
          event: 'messages',
          data: {
            statusMessages: outline.statusMessages || [],
            total: outline.slides.length,
          },
        });
        // Informational (phase 'refine'): shown only until the rotator has
        // its messages.
        const { requestedLang, detectedLang } = outline.metadata || {};
        nl = (requestedLang || detectedLang) === 'nl';
        sseWrite(res, {
          event: 'status',
          data: {
            message: nl
              ? `Outline klaar: ${outline.slides.length} slides in ${sections} secties…`
              : `Outline ready: ${outline.slides.length} slides in ${sections} sections…`,
            progress: PROGRESS.refineFloor,
            creepTo: PROGRESS.refineCeiling,
            creepMs: REFINE_CREEP_MS,
            phase: 'refine',
          },
        });
      },
      // Real progress: one event per finished section group.
      onGroupDone: ({ done, total }) => {
        sseWrite(res, {
          event: 'status',
          data: {
            message: nl
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

    const parts = deckToPresentationParts(deck, {
      theme,
      lang: deck.lang,
      slideTypes,
    });
    // Keep the per-slide "why this type" + alternatives on the saved slides;
    // the whole-deck review grid reads them after the editor loads the deck.
    reattachAiMeta(parts.slides, deck.slides);

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

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
      lang: deck.lang,
      authedUser,
      theme: effectiveTheme,
      settings: settingsFromRequest,
      notionSourcePageId,
    });

    sseWrite(res, {
      event: 'complete',
      data: {
        presentation: updated,
        sessionId,
        slideCount: updated.slides?.length || 0,
      },
    });
  } catch (e) {
    if (signal.aborted) {
      log.info(`[AI Wizard V2 Stream] ${sessionId}: cancelled by the client`);
      res.end();
      return true;
    }

    log.error('[AI Wizard V2 Stream] Error:', e);
    sseError(res, e?.message || 'Deck generation failed');
  }

  res.end();
  return true;
}

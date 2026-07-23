import { badRequest, json, serveJson } from '../../../utils/http.js';
import {
  getString,
  getOptionalString,
  getLang,
  getBoolean,
} from '../../../utils/request-validators.js';
import {
  deckToPresentationParts,
  presentationToDeck,
} from '../../../../shared/slide-types.js';
import { generateSlidesToAppendFromRawContent } from '../../../utils/ai.js';
import { validateAndFixRefinedSlides } from '../../../utils/ai/validate-slides.js';
import { loadSlideTypeContext } from './shared.js';

/**
 * POST /api/ai/append-slides — generate slides to append to an existing
 * presentation (editor flow).
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiAppendSlides({ req, res, authedUser }) {
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

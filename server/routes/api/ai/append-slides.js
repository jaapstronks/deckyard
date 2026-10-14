import { badRequest, serveJson, requireJsonBody } from '../../../utils/http.js';
import {
  getAiParams,
  getOptionalString,
  getBoolean,
  getOptionalObject,
} from '../../../utils/request-validators.js';
import {
  deckToPresentationParts,
  deckThemeId,
  presentationToDeck,
} from '../../../../shared/slide-types.js';
import { loadDeckTheme } from '../../../utils/themes.js';
import { generateSlidesToAppendFromRawContent } from '../../../utils/openai/append.js';
import { validateAndFixRefinedSlides } from '../../../utils/ai/validate-slides/index.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

/**
 * POST /api/ai/append-slides — generate slides to append to an existing
 * presentation (editor flow).
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiAppendSlides({
  repoRoot,
  req,
  res,
  authedUser,
  storageScope,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { raw, vendor, lang } = getAiParams(body);
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const contentOnly = getBoolean(body, 'contentOnly', false);
  const verbatim = getBoolean(body, 'verbatim', false);
  // Revision mode (batch review "Adjust"): prior batch + feedback on it.
  const priorSlides = Array.isArray(body?.priorSlides)
    ? body.priorSlides
    : null;
  const feedback = getOptionalString(body, 'feedback');

  const deckInput = getOptionalObject(body, 'deck');
  const presInput = getOptionalObject(body, 'presentation');
  const existingDeck = deckInput
    ? deckInput
    : presInput
      ? presentationToDeck(presInput)
      : null;

  const slideTypeOffer = await loadSlideTypeOffer(authedUser);
  // The map the org's types were offered from is the one they are composed and
  // fixed in (B247).
  const slideTypes = await buildMergedSlideTypes(storageScope);
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
    ...slideTypeOffer,
    priorSlides,
    feedback,
  });

  // Normalize into internal slide format so validation is stable and ids exist.
  // Against the theme of the deck the slides are being appended to, so a
  // generated slide composes the way an inserted one does.
  const parts = deckToPresentationParts(generatedSlides, {
    theme: await loadDeckTheme(
      repoRoot,
      deckThemeId(existingDeck),
      storageScope,
    ),
    lang: lang || existingDeck?.lang,
    slideTypes,
  });
  let slides = Array.isArray(parts?.slides) ? parts.slides : [];

  // Validate slides and log any issues (unknown fields, schema mismatches, etc.)
  slides = validateAndFixRefinedSlides(slides, { slideTypes });

  // Re-attach per-slide review metadata (normalization strips unknown slide
  // keys). Both arrays map 1:1 by index onto the generated batch.
  slides.forEach((s, i) => {
    const meta = review?.[i];
    if (!meta || !s || typeof s !== 'object') return;
    if (meta.why) s._aiReasoning = meta.why;
    if (meta.alternatives?.length) s._aiAlternatives = meta.alternatives;
  });

  serveJson(res, 200, { slides, rationale });
  return true;
}

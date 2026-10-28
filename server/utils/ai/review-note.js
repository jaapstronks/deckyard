/**
 * The one public spelling of a slide's review explanation: `reviewNote`
 * (B590 PR C).
 *
 * The AI routes store their explanation per slide as the
 * {@link AI_REVIEW_KEYS} (`_aiReasoning` with `_aiReview` as its evidence),
 * the editor's review grid reads them, and every reader projection strips
 * them. An agent that builds a deck itself (MCP `create_presentation_from_slides`
 * and `add_slide`, v1 create, PUT and add-slide) speaks one field instead:
 * `reviewNote` in, `reviewNote` out for whoever may write the deck. The raw
 * keys never cross the public boundary in either direction.
 *
 * Incoming, a note becomes `_aiReasoning` plus an unbound `_aiReview` with
 * origin `agent` and no source passage; the write seam binds it to the slide
 * as stored (`normalizeSlides`), so a fresh agent deck shows its explanations
 * as current, and the first edit makes them stale.
 *
 * @module server/utils/ai/review-note
 */

import { AppError } from '../errors.js';
import { getAppBaseUrl } from '../../config/utils.js';
import { isFeatureEnabled } from '../../config/flags-snapshot.js';
import { AI_REVIEW_KEYS, mapDeckSlideLists } from '../public-output.js';

/** Longest review note a slide takes, in characters. */
export const REVIEW_NOTE_MAX_LENGTH = 500;

/** The evidence an agent's note carries: content explanation, no source. */
const AGENT_REVIEW = Object.freeze({
  kind: 'content',
  sourceExcerpt: null,
  origin: 'agent',
});

/**
 * @param {string} field
 * @param {string} message
 * @param {{index?: number, lang?: string}} where
 * @returns {AppError} 400 `invalid` naming the field
 */
function refusal(field, message, { index, lang } = {}) {
  return new AppError(
    message,
    400,
    {
      field,
      ...(index !== undefined ? { index } : {}),
      ...(lang ? { lang } : {}),
    },
    'invalid',
  );
}

/**
 * Read one slide's incoming `reviewNote`.
 *
 * @param {unknown} value - the `reviewNote` the caller sent
 * @param {{index?: number, lang?: string}} [where] - for the refusal
 * @returns {string|undefined} the trimmed note (`''` clears), `undefined`
 *   when the caller sent none
 * @throws {AppError} 400 `invalid`, `details.field: 'reviewNote'`, for a
 *   non-string or a note over {@link REVIEW_NOTE_MAX_LENGTH}
 */
export function readReviewNote(value, where = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw refusal('reviewNote', 'reviewNote must be a string', where);
  }
  const note = value.trim();
  if (note.length > REVIEW_NOTE_MAX_LENGTH) {
    throw refusal(
      'reviewNote',
      `reviewNote is longer than ${REVIEW_NOTE_MAX_LENGTH} characters`,
      where,
    );
  }
  return note;
}

/**
 * Refuse a slide that carries a raw review key: the public contract names
 * the explanation `reviewNote` and nothing else.
 *
 * @param {unknown} slide
 * @param {{index?: number, lang?: string}} [where]
 * @throws {AppError} 400 `invalid`, `details.field` the raw key
 */
export function refuseRawReviewKeys(slide, where = {}) {
  if (!slide || typeof slide !== 'object') return;
  const key = AI_REVIEW_KEYS.find((k) => k in slide);
  if (key) {
    throw refusal(
      key,
      `${key} is not part of the public slide contract; send reviewNote`,
      where,
    );
  }
}

/**
 * Write a note onto a slide as an agent explanation. An empty note removes
 * the explanation and its evidence.
 *
 * @param {Object} slide - mutated
 * @param {string} note - as {@link readReviewNote} returned it
 * @returns {Object} the slide
 */
export function applyReviewNote(slide, note) {
  if (!note) {
    delete slide._aiReasoning;
    delete slide._aiReview;
    return slide;
  }
  slide._aiReasoning = note;
  // No fingerprint: the write seam binds it to the slide as stored.
  slide._aiReview = { ...AGENT_REVIEW };
  return slide;
}

/**
 * Turn one incoming public slide into its stored form: refuse raw review
 * keys, drop `reviewNote` and, when it was sent, apply it.
 *
 * Without a stored twin the slide is new; with one (a PUT, matched by id)
 * the stored review keys stay unless the note changed. A note equal to the
 * stored explanation keeps everything (the source passage, the
 * alternatives), so GET-then-PUT changes nothing it did not mean to.
 *
 * @param {Object} slide - the slide as the caller sent it
 * @param {Object} [options]
 * @param {Object|null} [options.stored] - the stored slide with the same id
 * @param {number} [options.index]
 * @param {string} [options.lang]
 * @returns {Object} a new slide object
 */
export function reviewNoteIn(slide, { stored = null, index, lang } = {}) {
  if (!slide || typeof slide !== 'object') return slide;
  refuseRawReviewKeys(slide, { index, lang });
  const { reviewNote, ...out } = slide;
  const note = readReviewNote(reviewNote, { index, lang });
  if (stored && typeof stored === 'object') {
    for (const key of AI_REVIEW_KEYS) {
      if (stored[key] !== undefined) out[key] = stored[key];
    }
  }
  if (note !== undefined && note !== (out._aiReasoning || '')) {
    applyReviewNote(out, note);
  }
  return out;
}

/**
 * The public form of a stored slide for a reader who may write the deck:
 * the raw review keys out, the explanation as `reviewNote` when there is one.
 *
 * @param {Object} slide
 * @returns {Object} a new slide object
 */
export function reviewNoteOut(slide) {
  if (!slide || typeof slide !== 'object') return slide;
  const out = { ...slide };
  for (const key of AI_REVIEW_KEYS) delete out[key];
  const note =
    typeof slide._aiReasoning === 'string' ? slide._aiReasoning.trim() : '';
  if (note) out.reviewNote = note;
  return out;
}

/**
 * Map every slide list of a deck body through {@link reviewNoteIn}: the
 * top-level `slides` and each `i18n.versions[lang].slides`. A stored deck
 * (a PUT) lends each slide its stored review keys by id, in the same
 * language version.
 *
 * @param {Object} body - the deck as the caller sent it
 * @param {Object|null} [stored] - the deck as stored, for a PUT
 * @returns {Object} a new body; unchanged lists are shared
 */
export function reviewNotesInDeck(body, stored = null) {
  if (!body || typeof body !== 'object') return body;
  const mapList = (slides, storedSlides, lang) => {
    if (!Array.isArray(slides)) return slides;
    const byId = new Map(
      (Array.isArray(storedSlides) ? storedSlides : [])
        .filter((s) => s && typeof s.id === 'string')
        .map((s) => [s.id, s]),
    );
    return slides.map((slide, index) =>
      reviewNoteIn(slide, {
        stored: typeof slide?.id === 'string' ? byId.get(slide.id) : null,
        index,
        lang,
      }),
    );
  };
  const out = { ...body };
  if (Array.isArray(body.slides)) {
    out.slides = mapList(body.slides, stored?.slides);
  }
  const versions = body.i18n?.versions;
  if (versions && typeof versions === 'object') {
    const storedVersions = stored?.i18n?.versions || {};
    const nextVersions = {};
    for (const [lang, version] of Object.entries(versions)) {
      nextVersions[lang] =
        version && typeof version === 'object' && Array.isArray(version.slides)
          ? {
              ...version,
              slides: mapList(
                version.slides,
                storedVersions[lang]?.slides,
                lang,
              ),
            }
          : version;
    }
    out.i18n = { ...body.i18n, versions: nextVersions };
  }
  return out;
}

/**
 * {@link reviewNoteOut} over every slide list of a deck.
 *
 * @param {Object} pres
 * @returns {Object} the deck, unchanged when no slide carried a review key
 */
export function reviewNotesOutDeck(pres) {
  return mapDeckSlideLists(pres, (slides) =>
    slides.some(hasReviewKey) ? slides.map(reviewNoteOut) : slides,
  );
}

const hasReviewKey = (slide) =>
  !!slide &&
  typeof slide === 'object' &&
  AI_REVIEW_KEYS.some((key) => key in slide);

/**
 * The link that opens a deck's review in the editor: the edit link with
 * `?aiReview=1`. The editor opens the review on top and never with the
 * discard action a fresh generation offers, so a shared or old link cannot
 * throw a deck away. Given only where the review can open: the editor offers
 * it with the `ai` cluster on (D179), and without a configured base URL there
 * is no absolute link to give.
 *
 * @param {string} id - the presentation id
 * @returns {string|null}
 */
export function reviewUrlFor(id) {
  if (!isFeatureEnabled('ai')) return null;
  const base = getAppBaseUrl();
  return base ? `${base}/app/${encodeURIComponent(id)}?aiReview=1` : null;
}

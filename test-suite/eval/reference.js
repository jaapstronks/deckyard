/**
 * Structural comparison against a human reference deck (category A only).
 *
 * These are deterministic shape comparisons -- deck length, text density,
 * topic overlap. Editorial-judgement similarity is the judge's humanLikeness
 * dimension; this module deliberately does not try to score taste.
 */

import { deckMetrics, extractSlideText, wordCount } from './metrics.js';

/**
 * Compare a generated deck with a parsed human reference deck.
 *
 * @param {object} deck - Generated deck
 * @param {{slides: {title: string, text: string, wordCount?: number}[]}} reference
 * @returns {object|null} null when there is no usable reference
 */
export function compareToReference(deck, reference) {
  const referenceSlides = reference?.slides || [];
  if (!referenceSlides.length) return null;

  const generated = deckMetrics(deck);
  const referenceWords = referenceSlides.map((slide) =>
    Number.isFinite(slide.wordCount)
      ? slide.wordCount
      : wordCount([slide.title, slide.text].filter(Boolean).join(' '))
  );

  const referenceMeanWords = average(referenceWords);
  const generatedMeanWords = generated.wordsPerSlide.mean;

  return {
    slideCount: {
      generated: generated.slideCount,
      reference: referenceSlides.length,
      ratio: round(generated.slideCount / referenceSlides.length),
    },
    // Slide economy relative to the human deck: >1 means the generated deck
    // puts more text on a slide than the human presenter chose to.
    textDensity: {
      generatedMeanWords,
      referenceMeanWords: round(referenceMeanWords),
      ratio: referenceMeanWords ? round(generatedMeanWords / referenceMeanWords) : null,
    },
    titleOverlap: titleOverlap(deck, referenceSlides),
  };
}

/**
 * Overlap between the topics the two decks chose to give a slide to.
 *
 * Compares content words in slide titles, which is a coarse but honest proxy:
 * it detects "the human deck has a competition section and the generated deck
 * does not" without pretending to measure semantic similarity.
 *
 * @param {object} deck
 * @param {{title: string}[]} referenceSlides
 */
function titleOverlap(deck, referenceSlides) {
  const generatedTerms = termSet(
    (deck.slides || []).map((slide) => extractSlideText(slide).title).join(' ')
  );
  const referenceTerms = termSet(referenceSlides.map((slide) => slide.title || '').join(' '));

  const shared = [...referenceTerms].filter((term) => generatedTerms.has(term));
  const missed = [...referenceTerms].filter((term) => !generatedTerms.has(term));

  return {
    sharedTermCount: shared.length,
    referenceTermCount: referenceTerms.size,
    overlapRate: referenceTerms.size ? round(shared.length / referenceTerms.size) : 0,
    // Title terms the human thought worth a slide heading but the generator
    // never mentions -- a fast pointer at structural blind spots.
    missedReferenceTerms: missed.slice(0, 25),
  };
}

/** Very common words carry no topical signal in either language. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'our', 'we', 'is',
  'are', 'at', 'by', 'from', 'as', 'that', 'this', 'it', 'be',
  'de', 'het', 'een', 'en', 'van', 'voor', 'op', 'met', 'in', 'te', 'is', 'zijn', 'we',
  'onze', 'aan', 'door', 'dat', 'die', 'bij', 'naar', 'over',
]);

function termSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word))
  );
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

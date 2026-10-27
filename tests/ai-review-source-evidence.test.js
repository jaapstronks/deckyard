import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  verifiedSourceExcerpt,
  outlineSourceEvidence,
} from '../server/utils/ai/source-evidence.js';
import {
  assembleDeck,
  generatedDeckToParts,
} from '../server/utils/ai/generate-deck.js';
import { isAiReviewCurrent, bindAiReview } from '../shared/ai-review.js';
import { createDeckYdocCodec } from '../shared/collab/deck-ydoc.js';
import { separateSlidesForProcessing } from '../server/utils/ai/generate-outline.js';
import { aiReviewDescription } from '../client/views/editor/ai-review-annotations.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

const SOURCE = 'A programme in five phases.\nFirst we listen.\nThen we build.';

test('source evidence matches literal input, permitting only whitespace differences', () => {
  assert.equal(
    verifiedSourceExcerpt(SOURCE, 'First we listen. Then we build.'),
    'First we listen.\nThen we build.',
  );
  for (const invented of [
    'We launch tomorrow.',
    'first we listen.',
    'Eerst luisteren we.',
    'First we listen. […] Then we build.',
  ]) {
    assert.equal(verifiedSourceExcerpt(SOURCE, invented), null);
  }
  assert.equal(
    verifiedSourceExcerpt('A [literal] (source).', '[literal] (source).'),
    '[literal] (source).',
  );
});

test('title and structural slides carry honest evidence and remain current through composition', () => {
  const outline = {
    title: 'Five phases',
    slides: [
      {
        index: 0,
        intent: 'chapter',
        sourceContext: { excerpt: 'First we listen.' },
      },
      {
        index: 1,
        intent: 'content',
        sourceContext: { excerpt: 'An invented passage.' },
      },
    ],
  };
  outlineSourceEvidence(outline, SOURCE);
  const refined = outline.slides.map((s) => ({
    originalIndex: s.index,
    type: 'content-slide',
    content: { title: `Part ${s.index + 1}`, body: 'Text' },
    _reviewEvidence: s._reviewEvidence,
  }));
  const deck = assembleDeck(outline, refined);
  assert.equal(deck.slides[0]._aiReview.kind, 'title');
  assert.ok(SOURCE.includes(deck.slides[0]._aiReview.sourceExcerpt));
  assert.equal(deck.slides[1]._aiReview.sourceExcerpt, 'First we listen.');
  assert.equal(deck.slides[2]._aiReview.sourceExcerpt, null);
  const parts = generatedDeckToParts(deck, {
    theme: null,
    slideTypes: SLIDE_TYPES,
  });
  assert.ok(parts.slides.every(isAiReviewCurrent));
  assert.equal(parts.slides[1]._aiReview.kind, 'chapter');
});

test('edits, reload and Yjs preserve evidence without making old explanations current', () => {
  const slide = bindAiReview(
    {
      id: 's1',
      type: 'content-slide',
      content: { title: 'Original', body: 'First we listen.' },
    },
    { sourceExcerpt: 'First we listen.', kind: 'content' },
  );
  assert.ok(isAiReviewCurrent(slide));
  const edited = structuredClone(slide);
  edited.content.title = 'A different claim';
  assert.equal(isAiReviewCurrent(edited), false);
  assert.equal(isAiReviewCurrent(JSON.parse(JSON.stringify(edited))), false);
  const codec = createDeckYdocCodec(Y);
  const doc = new Y.Doc();
  codec.bootstrapPresentationToDoc(
    { id: 'p1', title: 'Test', lang: 'en-GB', slides: [edited] },
    doc,
  );
  const projected = codec.projectDocToPresentation(doc);
  assert.deepEqual(projected.slides[0]._aiReview, slide._aiReview);
  assert.equal(isAiReviewCurrent(projected.slides[0]), false);
  edited.content.title = 'Original';
  assert.ok(isAiReviewCurrent(edited), 'undo restores the original binding');
  edited.type = 'title-slide';
  assert.equal(isAiReviewCurrent(edited), false);
  doc.destroy();
});

test('implicit render defaults and declared derived caches do not age an explanation', () => {
  const slide = bindAiReview(
    {
      type: 'title-slide',
      content: { title: 'Topic', slideBgImage: '/source.jpg' },
    },
    { kind: 'title', sourceExcerpt: 'Topic' },
  );
  const sampled = structuredClone(slide);
  Object.assign(sampled.content, {
    slideLogo: 'none',
    slideBgText: 'auto',
    slideBgAutoFor: '/source.jpg',
    slideBgTextAuto: 'light',
    slideBgNeedsScrim: false,
  });
  assert.ok(isAiReviewCurrent(sampled));
  sampled.content.slideLogo = 'top-right';
  assert.equal(isAiReviewCurrent(sampled), false);
  sampled.content.slideLogo = 'none';
  sampled.content.slideBgText = 'dark';
  assert.equal(isAiReviewCurrent(sampled), false);
});

test('resolved structural quotes and closing slides show author copy rather than pipeline diagnostics', () => {
  const outline = {
    title: 'Source review',
    slides: [
      {
        index: 0,
        intent: 'quote',
        roughContent: 'First we listen.',
        hints: [],
        sourceContext: { excerpt: 'First we listen.' },
      },
      {
        index: 1,
        intent: 'closing',
        roughContent: 'Then we build.',
        hints: [],
        sourceContext: { excerpt: 'Then we build.' },
      },
    ],
  };
  outlineSourceEvidence(outline, SOURCE);
  const { structuralSlides } = separateSlidesForProcessing(outline.slides);
  assert.equal(structuralSlides.length, 2);
  for (const slide of structuralSlides)
    slide._reviewEvidence = outline.slides.find(
      (s) => s.index === slide.originalIndex,
    )._reviewEvidence;
  const deck = assembleDeck(outline, structuralSlides, { titleSlide: null });
  assert.equal(deck.slides[0]._aiReview.kind, 'quote');
  assert.equal(deck.slides[1]._aiReview.kind, 'closing');
  for (const slide of deck.slides) {
    assert.doesNotMatch(
      aiReviewDescription(slide),
      /Structural|resolved directly|Phase 2|Fallback:/u,
    );
    assert.ok(SOURCE.includes(slide._aiReview.sourceExcerpt));
  }
});

test('a long unwrapped source line produces a bounded literal title passage', () => {
  const source = 'Topic ' + 'a long source line '.repeat(10000);
  const outline = { slides: [] };
  outlineSourceEvidence(outline, source);
  assert.ok(outline._reviewTitleEvidence.sourceExcerpt.length <= 480);
  assert.ok(source.includes(outline._reviewTitleEvidence.sourceExcerpt));
  assert.equal(
    verifiedSourceExcerpt(source, source),
    null,
    'unbounded model candidates are not compiled as regular expressions',
  );
});

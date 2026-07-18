import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deckMetrics,
  extractSlideText,
  numberFidelity,
  wordCount,
} from '../test-suite/eval/metrics.js';
import { computeDeltas, aggregateScores, overallScore } from '../test-suite/eval/report.js';
import { costOf, CostTracker } from '../test-suite/lib/cost.js';
import { sourceTextFilename } from '../test-suite/lib/cases.js';

test('extractSlideText separates the title from body text', () => {
  const { title, body } = extractSlideText({
    type: 'content-slide',
    content: { title: 'Revenue growth', body: 'Sales rose sharply.', layout: 'one-column' },
  });
  assert.equal(title, 'Revenue growth');
  assert.match(body, /Sales rose sharply/);
  assert.doesNotMatch(body, /one-column/, 'layout is configuration, not text');
});

test('extractSlideText treats list items as bullets whatever the slide type', () => {
  const { bullets } = extractSlideText({
    type: 'timeline-slide',
    content: {
      title: 'Roadmap',
      items: [
        { date: '2024', title: 'Launch', text: 'First release' },
        { date: '2025', title: 'Scale', text: 'Expand to EU' },
      ],
    },
  });
  assert.equal(bullets.length, 2);
  assert.match(bullets[0], /Launch/);
});

test('extractSlideText drops flat numbered config keys, not just exact names', () => {
  // text-blocks-slide uses flat keys like row1Color / arrow1 / row2Enabled.
  // An exact-name blocklist misses these, and their values then read as slide
  // prose -- which made the judge penalize decks for invisible text.
  const { allText } = extractSlideText({
    type: 'text-blocks-slide',
    content: {
      title: 'Barriers',
      row1Count: '4',
      row1Color: 'yellow',
      arrow1: 'down',
      row2Enabled: 'yes',
      row1Block1Title: 'Split transitions',
      row1Block1Body: 'The two transitions rarely meet',
    },
  });
  for (const token of ['yellow', 'down', 'yes', '4']) {
    assert.ok(!allText.includes(token), `config value "${token}" must not count as slide text`);
  }
  assert.ok(allText.includes('Split transitions'), 'real content is still captured');
});

test('extractSlideText finds bullets in markdown bodies', () => {
  const { bullets } = extractSlideText({
    type: 'content-slide',
    content: { title: 'Points', body: '- First\n- Second\n- Third' },
  });
  assert.equal(bullets.length, 3);
});

test('deckMetrics counts walls of text and reports structure', () => {
  const longBody = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const deck = {
    slides: [
      { type: 'title-slide', content: { title: 'Deck' } },
      { type: 'content-slide', content: { title: 'Dense', body: longBody } },
      { type: 'payoff-slide', content: { tagline: 'Thanks' } },
    ],
  };
  const metrics = deckMetrics(deck);
  assert.equal(metrics.slideCount, 3);
  assert.equal(metrics.wallOfTextSlides, 1);
  assert.equal(metrics.structure.hasTitleSlide, true);
  assert.equal(metrics.structure.hasClosing, true);
  assert.equal(metrics.slideTypeDistribution['content-slide'], 1);
});

test('numberFidelity flags figures that are absent from the source', () => {
  const deck = {
    slides: [
      { type: 'content-slide', content: { title: 'Results', body: 'Revenue was 9300 million.' } },
      { type: 'content-slide', content: { title: 'Made up', body: 'Margin hit 87 percent.' } },
    ],
  };
  const result = numberFidelity(deck, 'Revenue was 9300 million this quarter.');
  assert.ok(result.unsupported.includes('87'), 'invented figure is flagged');
  assert.ok(!result.unsupported.includes('9300'), 'sourced figure is not flagged');
});

test('numberFidelity ignores years and small integers', () => {
  const deck = {
    slides: [{ type: 'content-slide', content: { body: 'In 2031 we had 3 pillars.' } }],
  };
  // Neither appears in the source, but both are formatting noise rather than
  // claims copied from it.
  const result = numberFidelity(deck, 'No figures here.');
  assert.deepEqual(result.unsupported, []);
  assert.equal(result.supportRate, 1);
});

test('numberFidelity matches across EU and US number formatting', () => {
  const deck = {
    slides: [{ type: 'content-slide', content: { body: 'Total of 1.234,5 million.' } }],
  };
  const result = numberFidelity(deck, 'The total was 1,234.5 million.');
  assert.deepEqual(result.unsupported, [], 'same value written both ways still matches');
});

test('wordCount ignores markdown punctuation', () => {
  assert.equal(wordCount('## Heading **bold** text'), 3);
});

test('computeDeltas only calls a move significant past the threshold', () => {
  const deltas = computeDeltas(
    { coverage: 4.0, structure: 3.5, slideEconomy: 2.9 },
    { coverage: 3.5, structure: 3.45, slideEconomy: 3.6 }
  );
  const byDimension = Object.fromEntries(deltas.map((d) => [d.dimension, d.direction]));
  assert.equal(byDimension.coverage, 'up');
  assert.equal(byDimension.structure, 'flat', 'a 0.05 move is noise');
  assert.equal(byDimension.slideEconomy, 'down');
});

test('aggregateScores averages a dimension across cases and repeats', () => {
  const results = [
    { repeats: [{ verdict: { scores: { coverage: { score: 4 } } } }] },
    { repeats: [{ verdict: { scores: { coverage: { score: 2 } } } }] },
  ];
  assert.equal(aggregateScores(results).coverage, 3);
});

test('overallScore excludes humanLikeness so mixed case sets stay comparable', () => {
  const scores = {
    coverage: 4,
    structure: 4,
    slideEconomy: 4,
    faithfulness: 4,
    presentability: 4,
    humanLikeness: 1,
  };
  assert.equal(overallScore(scores), 4);
});

test('costOf prices cached reads far below fresh input', () => {
  const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const fresh = costOf({ ...empty, inputTokens: 1_000_000 }, 'claude-opus-4-8');
  const cached = costOf({ ...empty, cacheReadTokens: 1_000_000 }, 'claude-opus-4-8');
  assert.equal(fresh, 5);
  assert.ok(cached < fresh / 5, 'cache reads are an order of magnitude cheaper');
});

test('costOf prices each model at its own rates', () => {
  const output = { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(costOf(output, 'claude-opus-4-8'), 25);
  assert.equal(costOf(output, 'gpt-5.5'), 30);
});

test('costOf refuses an unpriced model rather than reporting zero', () => {
  // Silently under-counting is worse than failing: a cost report that lies is
  // the one thing worse than no cost report.
  assert.throws(
    () => costOf({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'made-up-model'),
    /No pricing for model/
  );
});

test('CostTracker keeps categories and models separate, and totals them', () => {
  const tracker = new CostTracker();
  tracker.record('generation', { inputTokens: 1000, outputTokens: 500 }, 'gpt-5.5');
  tracker.record('judge', { inputTokens: 2000, outputTokens: 100 }, 'claude-opus-4-8');
  tracker.record('judge', { inputTokens: 1000, outputTokens: 50 }, 'claude-opus-4-8');

  const summary = tracker.summary();
  const judge = summary.byCategory['judge|claude-opus-4-8'];
  const generation = summary.byCategory['generation|gpt-5.5'];

  assert.equal(judge.calls, 2);
  assert.equal(judge.inputTokens, 3000);
  assert.equal(generation.model, 'gpt-5.5');
  assert.equal(summary.total.calls, 3);
  // A mixed-vendor run must price each line at its own rates, not one blended rate.
  assert.equal(summary.totalUsd, Math.round((judge.usd + generation.usd) * 10000) / 10000);
});

test('sourceTextFilename maps every fetched asset type to its extracted text', () => {
  // The fetch script and the readers must agree on this name. They previously
  // used separate regexes: the reader handled only pdf/doc, so .html and .wiki
  // assets fell through and raw markup was fed to the pipeline.
  assert.equal(sourceTextFilename('report.pdf'), 'report.txt');
  assert.equal(sourceTextFilename('persbericht.html'), 'persbericht.txt');
  assert.equal(sourceTextFilename('post-mortem.htm'), 'post-mortem.txt');
  assert.equal(sourceTextFilename('article.wiki'), 'article.txt');
  assert.equal(sourceTextFilename('readme.md'), 'readme.txt');
  assert.equal(sourceTextFilename('notes.docx'), 'notes.txt');
  assert.equal(sourceTextFilename('already.txt'), 'already.txt');
});

test('deckMetrics measures type monotony and divider share', () => {
  const slide = (type) => ({ type, content: { title: 'x', body: 'some words here' } });
  const deck = {
    slides: [
      slide('title-slide'),
      slide('list-slide'),
      slide('list-slide'),
      slide('list-slide'),
      slide('chapter-title-slide'),
      slide('kpi-metrics-slide'),
    ],
  };
  const { repetition, dividerShare } = deckMetrics(deck);
  assert.equal(repetition.consecutiveRepeats, 2, 'three in a row is two repeats');
  assert.equal(repetition.longestRun, 3);
  assert.equal(dividerShare, round2(1 / 6));

  function round2(n) {
    return Math.round(n * 100) / 100;
  }
});

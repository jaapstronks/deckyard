import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStatusMessages,
  normalizeAnalysis,
  normalizeStructure,
} from '../server/utils/ai/generate-outline.js';
import { buildStructureUserPrompt } from '../server/utils/ai/prompts/base/outline.js';

const ANALYSIS = normalizeAnalysis({
  title: ' Duurzame digitalisering ',
  summary: 'Een actieprogramma.',
  sections: [
    {
      heading: 'Vijf fases',
      importance: 'high',
      keyPoints: ['Fase 1: inventarisatie (2026)', '', 'Fase 2: pilots'],
      excerpt: 'Het programma kent vijf fases.',
      quotes: [
        { text: 'We beginnen nu.', author: 'De minister' },
        { text: '' },
      ],
    },
    { heading: 'Budget', importance: 'vital', keyPoints: ['€ 12 mln'] },
    { heading: '', keyPoints: [] },
  ],
});

test('normalizeAnalysis trims, drops empty entries and folds unknown importance', () => {
  assert.equal(ANALYSIS.title, 'Duurzame digitalisering');
  assert.equal(ANALYSIS.sections.length, 2, 'the empty section is dropped');
  assert.deepEqual(ANALYSIS.sections[0].keyPoints, [
    'Fase 1: inventarisatie (2026)',
    'Fase 2: pilots',
  ]);
  assert.equal(ANALYSIS.sections[0].quotes.length, 1);
  assert.equal(ANALYSIS.sections[1].importance, 'medium');
});

test('normalizeStructure drops opening slides and attaches the section as sourceContext', () => {
  const slides = normalizeStructure(
    {
      slides: [
        { intent: 'opening', roughContent: 'Title' },
        {
          intent: 'content',
          section: 0,
          roughContent: 'Vijf fases',
          hints: ['is-timeline'],
          groupId: 'g1',
        },
        { intent: 'closing', section: 9, roughContent: 'Doe mee' },
      ],
    },
    ANALYSIS,
  );
  assert.equal(slides.length, 2);
  assert.deepEqual(
    slides.map((s) => s.index),
    [0, 1],
  );
  assert.equal(slides[0].sourceContext.heading, 'Vijf fases');
  assert.equal(
    slides[0].sourceContext.excerpt,
    'Het programma kent vijf fases.',
  );
  assert.equal(slides[0].presenterNotes, '', 'notes are written in Phase 2');
  assert.equal(slides[1].sourceContext, null, 'unknown section index');
});

test('normalizeStructure never returns an empty plan', () => {
  const slides = normalizeStructure({ slides: [] }, ANALYSIS);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].intent, 'content');
});

test('the structure prompt carries the specifics but not the raw source', () => {
  const prompt = buildStructureUserPrompt({ analysis: ANALYSIS });
  assert.match(prompt, /SECTION 0 \(high importance\): Vijf fases/);
  assert.match(prompt, /- Fase 1: inventarisatie \(2026\)/);
  assert.match(prompt, /QUOTE: "We beginnen nu\." \(De minister\)/);
});

test('buildStatusMessages names the sections and pads to six lines', () => {
  const nl = buildStatusMessages(ANALYSIS, 'nl');
  assert.equal(nl.length, 6);
  assert.equal(nl[0], 'Slides maken over Vijf fases...');
  const en = buildStatusMessages(ANALYSIS, 'en-GB');
  assert.equal(en[1], 'Creating slides about Budget...');
});

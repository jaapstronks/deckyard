/** Print and reader must emit identical sections for every core type. */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real sanitizer, as the server has it: without it markdown projects escaped.
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

const { CORE_SLIDE_TYPE_DEFS, CORE_SLIDE_TYPE_NAMES } =
  await import('../shared/slide-types/registry.js');
const { slideTypeSample } =
  await import('../shared/slide-types/authoring-companions.js');
const { newSlide } = await import('../shared/slide-types/presentation.js');
const { buildPrintHtml } = await import('../server/export/print.js');
const { buildReaderHtml } = await import('../server/export/reader.js');

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Every core type with its sample, as one deck in `lang`. */
function deckOfEveryType(lang) {
  return {
    id: 'print-reader-deck',
    title: 'Every type',
    lang,
    slides: CORE_SLIDE_TYPE_NAMES.map((type, i) => ({
      ...newSlide({
        type,
        lang,
        content: slideTypeSample(type, CORE_SLIDE_TYPE_DEFS[type]) || null,
        slideTypes: CORE_SLIDE_TYPE_DEFS,
        presentationId: 'print-reader-deck',
      }),
      id: `s${i + 1}`,
    })),
  };
}

/** The slide sections of a document, keyed by their type. */
function sectionsByType(html) {
  const out = new Map();
  for (const m of html.matchAll(
    /<section\b[^>]*class="reader-slide"[^>]*>[\s\S]*?<\/section>/g,
  )) {
    const type = m[0].match(/data-slide-type="([^"]*)"/)[1];
    out.set(type, m[0]);
  }
  return out;
}

for (const lang of ['nl', 'en-GB']) {
  test(`print and reader share the section HTML per type (${lang})`, async () => {
    const deck = deckOfEveryType(lang);
    const opts = { slideTypes: CORE_SLIDE_TYPE_DEFS };
    const print = sectionsByType(await buildPrintHtml(repoRoot, deck, opts));
    const reader = sectionsByType(buildReaderHtml(repoRoot, deck, opts));

    // Non-vacuity: live-only types leave both documents, everything else is
    // in both. An empty match would pass the comparison for the wrong reason.
    const printable = CORE_SLIDE_TYPE_NAMES.filter(
      (type) => CORE_SLIDE_TYPE_DEFS[type].liveOnly !== true,
    );
    assert.deepEqual([...reader.keys()], printable);
    assert.deepEqual([...print.keys()], printable);

    for (const type of printable) {
      assert.equal(
        print.get(type),
        reader.get(type),
        `the handout prints ${type} differently from the reader — print must ` +
          'emit renderSlideSectionHtml unchanged (D134)',
      );
    }
  });
}

test('the handout has no reader of its own', async () => {
  const html = await buildPrintHtml(repoRoot, deckOfEveryType('en-GB'), {
    slideTypes: CORE_SLIDE_TYPE_DEFS,
  });
  // No per-type wrapper, no JSON fallback, no number typed into a heading.
  assert.doesNotMatch(html, /class="print-slide"/);
  assert.doesNotMatch(html, /class="print-pre"/);
  assert.doesNotMatch(html, /class="print-slide-num"/);
  assert.doesNotMatch(html, /No content\.|Geen inhoud\./);
  // The number is a counter in the stylesheet (D133).
  assert.match(html, /counter-increment: print-slide/);
});

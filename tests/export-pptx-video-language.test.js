/**
 * PPTX export: the video placeholder speaks the deck's language (B358).
 *
 * The placeholder is the only text this export writes itself — every other
 * slide is a picture of what the renderer already produced — so it is the one
 * place where the exporter can put a language on a slide that the deck never
 * chose. It used to put Dutch there unconditionally.
 *
 * Why this file runs without a browser or network: a `video-slide` takes the
 * native composition, and a YouTube, Vimeo or unrecognised source composes the
 * placeholder from shapes and text without rendering or fetching anything. The
 * Bunny branches are not exercised here for the opposite reason — they reach
 * for a pull zone and an MP4 — but they read the same `copy` object as the
 * three below, and the table is pinned key-for-key in
 * `slide-copy-language.test.js`.
 *
 * Run with: node --test tests/export-pptx-video-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { buildPptxBuffer } from '../server/export/pptx.js';
import {
  SLIDE_COPY,
  DEFAULT_SLIDE_COPY_LANG,
} from '../shared/slide-types/slide-copy.js';

const repoRoot = '.';

/** A video slide with the given source; no title, to keep the runs to the copy. */
function videoSlide(source) {
  return { id: 'v1', type: 'video-slide', content: { source } };
}

/**
 * The text runs of the first slide part, joined and un-escaped.
 *
 * The runs come back as XML, so an apostrophe in "can't" and the quotes around
 * "Insert Online Video" arrive as entities. Decoding here rather than writing
 * the entities into the assertions keeps a failure message readable as the
 * sentence the reader would see.
 */
async function slideText(pres) {
  const { buffer } = await buildPptxBuffer(repoRoot, pres, { scale: 1 });
  const zip = await JSZip.loadAsync(Buffer.from(buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((m) => m[1])
    .join(' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/123456789';

test('an en-GB deck gets an English YouTube placeholder', async () => {
  const text = await slideText({
    title: 'Deck',
    lang: 'en-GB',
    slides: [videoSlide(YOUTUBE)],
  });

  assert.ok(
    text.includes("YouTube videos can't play offline in PowerPoint."),
    `expected the English detail, got: ${JSON.stringify(text)}`,
  );
  assert.ok(
    text.includes('Insert Online Video'),
    'expected the English instruction',
  );
  assert.ok(
    !text.includes('handmatig'),
    `an English deck must carry no Dutch copy, got: ${JSON.stringify(text)}`,
  );
});

test('a nl deck gets a Dutch YouTube placeholder', async () => {
  const text = await slideText({
    title: 'Deck',
    lang: 'nl',
    slides: [videoSlide(YOUTUBE)],
  });

  assert.ok(
    text.includes(
      "YouTube-video's kunnen niet offline worden afgespeeld in PowerPoint.",
    ),
    `expected the Dutch detail, got: ${JSON.stringify(text)}`,
  );
  assert.ok(
    text.includes('Online video invoegen'),
    'expected the Dutch instruction',
  );
});

test('the provider name is filled in, not left as a placeholder', async () => {
  // `{provider}` is one template for every brand; an unfilled one would ship a
  // literal brace to the reader, which reads as a bug and is easy to miss in a
  // sentence that is otherwise correct.
  const text = await slideText({
    title: 'Deck',
    lang: 'nl',
    slides: [videoSlide(VIMEO)],
  });

  assert.ok(text.includes('Vimeo-video'), 'expected the Vimeo brand name');
  assert.ok(
    !text.includes('{provider}'),
    `no placeholder may survive into the file, got: ${JSON.stringify(text)}`,
  );
});

test('an unrecognised source explains itself in the deck language', async () => {
  // The other end of the branch tree: no provider at all, and the deck names a
  // language the copy table does not carry.
  const german = await slideText({
    title: 'Deck',
    lang: 'de',
    slides: [videoSlide('')],
  });

  assert.ok(
    german.includes(SLIDE_COPY[DEFAULT_SLIDE_COPY_LANG].videoPptxSourceUnknown),
    `a German deck falls back to ${DEFAULT_SLIDE_COPY_LANG}, got: ${JSON.stringify(german)}`,
  );
  assert.ok(
    !german.includes(SLIDE_COPY.nl.videoPptxSourceUnknown),
    'the fallback is English, not Dutch — the defect this file exists for',
  );

  const dutch = await slideText({
    title: 'Deck',
    lang: 'nl',
    slides: [videoSlide('')],
  });
  assert.ok(dutch.includes(SLIDE_COPY.nl.videoPptxSourceUnknown));
});

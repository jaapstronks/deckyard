/**
 * A Bunny library is instance configuration, not a default in core (B650).
 *
 * `video-slide.js` carried one fork's library id twice — as the field default
 * and as a fallback in `renderHtml` — plus that fork's video as the default
 * `source`. So a new video slide in any other instance played a stranger's
 * video, and a bare UUID an author typed resolved against a stranger's library.
 * Same class as the hardcoded player colours (B648), without the colour.
 *
 * Pinned here: a bare UUID without a library embeds nothing (and the slide
 * says what to paste), a pasted play or embed URL still plays because it names
 * its own library, the export paths read the library off the slide with no
 * fallback, and the id appears nowhere in `shared/` or `server/`.
 *
 * Run with: node --test tests/bunny-library-id.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './helpers/walk-files.js';

import videoSlide from '../shared/slide-types/types/video-slide.js';
import { bunnyEmbedUrlFromInput } from '../shared/slide-types/helpers.js';
import {
  parseVideoSource,
  resolveBunnyLibraryId,
} from '../server/export/video-helpers.js';

const UUID = '3045cc09-0000-4000-8000-00000000abcd';
const LIB = '123456';

/** The rendered HTML for a video slide with this content. */
const render = (content) =>
  videoSlide.renderHtml(content, { id: 's1' }, { theme: null });

/** The iframe src in that HTML, or `''` when the slide renders no iframe. */
function renderedSrc(content) {
  const m = render(content).match(/<iframe[^>]*\ssrc="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

// --------------------------------------------------- the slide without a library

test('a bare UUID without a library embeds nothing', () => {
  const html = render({ source: UUID });
  assert.equal(renderedSrc({ source: UUID }), '');
  // And it is not silently blank: the slide says what to paste.
  assert.match(html, /video-empty/);
});

test('the shipped defaults name no library, so they embed nothing', () => {
  assert.equal(videoSlide.defaults.bunnyLibraryId, '');
  // A new slide opens on its own empty state rather than on a stranger's
  // video. Since B653 the default `source` is blank too, and an instance that
  // owns a library seeds this field from configuration
  // (tests/config-seeds-type-defaults.test.js).
  assert.match(render(videoSlide.defaults), /video-empty/);
});

test("a slide's own library id makes the same UUID play", () => {
  const src = renderedSrc({ source: UUID, bunnyLibraryId: LIB });
  const url = new URL(src);
  assert.equal(url.hostname, 'iframe.mediadelivery.net');
  assert.equal(url.pathname, `/embed/${LIB}/${UUID}`);
});

test('a pasted play or embed URL needs no configuration: it names its library', () => {
  const play = `https://iframe.mediadelivery.net/play/${LIB}/${UUID}`;
  const embed = `https://iframe.mediadelivery.net/embed/${LIB}/${UUID}`;
  for (const source of [play, embed]) {
    const url = new URL(renderedSrc({ source }));
    assert.equal(url.pathname, `/embed/${LIB}/${UUID}`, source);
  }
});

// ------------------------------------------------------------- the helper itself

test('the embed helper refuses a bare UUID without a library', () => {
  assert.equal(bunnyEmbedUrlFromInput(UUID), '');
  assert.equal(bunnyEmbedUrlFromInput(UUID, { libraryId: '' }), '');
  assert.equal(bunnyEmbedUrlFromInput(UUID, { libraryId: '   ' }), '');
  assert.equal(
    bunnyEmbedUrlFromInput(UUID, { libraryId: LIB }),
    `https://iframe.mediadelivery.net/embed/${LIB}/${UUID}`,
  );
});

test('the slide and the export paths read the field the same way', () => {
  // One spelling: the slide hands the field to the helper as authored and the
  // export paths hand it to `resolveBunnyLibraryId`, so neither can start
  // normalizing it differently from the other. `validateSlide` refuses a
  // non-string here, so this is about the two reads agreeing, not about the
  // value being reachable.
  for (const bunnyLibraryId of [LIB, `  ${LIB}  `, '', '   ', undefined]) {
    const embedded = Boolean(renderedSrc({ source: UUID, bunnyLibraryId }));
    const resolved = Boolean(resolveBunnyLibraryId({ bunnyLibraryId }));
    assert.equal(embedded, resolved, String(bunnyLibraryId));
  }
});

// --------------------------------------------------------- the export paths

test('the export paths read the library off the slide, with no fallback', () => {
  assert.equal(
    resolveBunnyLibraryId({ source: UUID, bunnyLibraryId: LIB }),
    LIB,
  );
  assert.equal(resolveBunnyLibraryId({ source: UUID }), '');
  assert.equal(resolveBunnyLibraryId({ bunnyLibraryId: '  ' }), '');
  assert.equal(resolveBunnyLibraryId(null), '');
});

test('the export parser reports no bunny video for a UUID without a library', () => {
  const unresolved = parseVideoSource(UUID, '');
  assert.equal(unresolved.provider, null);
  assert.equal(unresolved.libraryId, null);

  const resolved = parseVideoSource(UUID, LIB);
  assert.equal(resolved.provider, 'bunny');
  assert.equal(resolved.libraryId, LIB);
  assert.equal(resolved.videoId, UUID);
});

// ------------------------------------------------------------------- the guard

test("no fork's Bunny library id survives in shared/ or server/", () => {
  // Spelled in halves so this file is not itself a hit.
  const banned = '366' + '590';
  const roots = ['../shared/', '../server/'].map((r) =>
    fileURLToPath(new URL(r, import.meta.url)),
  );
  const offenders = [];
  // `server/data/` holds saved decks, whose slides legitimately name the
  // library their author chose.
  for (const root of roots) {
    for (const file of walkFiles(root, {
      extensions: ['.js'],
      skipEntry: (entry) =>
        entry.name === 'data' || entry.name === 'node_modules',
      followSymlinks: true,
      filesOnly: false,
    })) {
      if (readFileSync(file, 'utf8').includes(banned)) offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a Bunny library belongs in configuration, not in code:\n${offenders.join('\n')}`,
  );
});

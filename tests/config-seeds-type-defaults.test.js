/**
 * The route from installation configuration to a slide type's defaults (B653).
 *
 * `video-slide` had one fork's Bunny library written into core, so a new video
 * slide in any other instance played from a stranger's account. Taking it
 * out (B650) left the other half open: an instance that *owns* a Bunny library
 * could not say so. There was no route at all — not an accident of this type,
 * but a missing seam, which is why the fix is a declaration
 * (`configDefaults`) and not a branch on a type name.
 *
 * Pinned here, in the order the value travels:
 *
 * 1. the declaration reader and its closed vocabulary;
 * 2. `withConfiguredDefaults`, the one seam, including that an unconfigured
 *    install is handed the very same map back;
 * 3. the env half, and that both server map seams go through it;
 * 4. the behaviour that made this worth building: a new video slide plays a
 *    bare Bunny UUID where a library is configured, and asks for a link where
 *    none is;
 * 5. that no fork's video is left in core's defaults.
 *
 * Run with: node --test tests/config-seeds-type-defaults.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_DEFAULT_SOURCE_NAMES,
  applyConfigDefaults,
  isConfigDefaultSource,
  slideConfigDefaults,
  withConfiguredDefaults,
} from '../shared/slide-types/config-defaults.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { newSlide } from '../shared/slide-types/presentation.js';
import videoSlide from '../shared/slide-types/types/video-slide.js';
import {
  instanceSlideDefaults,
  instanceSlideTypes,
} from '../server/config/slide-defaults.js';

const LIBRARY = '424242';
const BUNNY_UUID = '3045cc09-0000-4000-8000-00000000abcd';

/** Run `fn` with `BUNNY_LIBRARY_ID` set to `value` (unset when falsy). */
function withEnv(value, fn) {
  const previous = process.env.BUNNY_LIBRARY_ID;
  if (value) process.env.BUNNY_LIBRARY_ID = value;
  else delete process.env.BUNNY_LIBRARY_ID;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.BUNNY_LIBRARY_ID;
    else process.env.BUNNY_LIBRARY_ID = previous;
  }
}

// ------------------------------------------------------- 1. the declaration

test('the declaration is read against a closed vocabulary', () => {
  assert.deepEqual(slideConfigDefaults({}), {});
  assert.deepEqual(slideConfigDefaults(null), {});
  // Not a map: a fork that wrote a list said nothing this seam can satisfy.
  assert.deepEqual(
    slideConfigDefaults({ configDefaults: ['bunnyLibraryId'] }),
    {},
  );
  // A source outside the vocabulary is dropped, not applied: the helpers here
  // have to be able to produce the value, so a type cannot name an env var
  // core never reads.
  assert.deepEqual(
    slideConfigDefaults({
      configDefaults: {
        bunnyLibraryId: 'bunny-library-id',
        forkKey: 'whatever-the-fork-wants',
      },
    }),
    { bunnyLibraryId: 'bunny-library-id' },
  );
  assert.ok(isConfigDefaultSource('bunny-library-id'));
  assert.ok(!isConfigDefaultSource('bunny_library_id'));
});

test('every configDefaults key a core type declares is a key it uses', () => {
  const declaring = [];
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    const declared = slideConfigDefaults(def);
    if (!Object.keys(declared).length) continue;
    declaring.push(name);
    const fields = new Set((def.fields || []).map((f) => f?.key));
    for (const key of Object.keys(declared)) {
      assert.ok(
        fields.has(key) || Object.hasOwn(def.defaults || {}, key),
        `${name}: configDefaults names '${key}', which is neither a field nor a default`,
      );
    }
  }
  assert.deepEqual(declaring, ['video-slide']);
});

// ------------------------------------------------------------ 2. the seam

test('a configured value lands in the declaring type and nowhere else', () => {
  const configured = withConfiguredDefaults(SLIDE_TYPES, {
    'bunny-library-id': LIBRARY,
  });
  assert.equal(configured['video-slide'].defaults.bunnyLibraryId, LIBRARY);
  // Copy-on-write: a type that declares nothing is the very same object, so
  // the identities other modules compare (and the compiled renderers) survive.
  assert.equal(configured['content-slide'], SLIDE_TYPES['content-slide']);
  assert.notEqual(configured['video-slide'], SLIDE_TYPES['video-slide']);
  assert.equal(
    configured['video-slide'].fields,
    SLIDE_TYPES['video-slide'].fields,
  );
  assert.equal(
    configured['video-slide'].renderHtml,
    SLIDE_TYPES['video-slide'].renderHtml,
  );
  // The source map is untouched: a second surface asking the same question
  // must not see the first one's answer.
  assert.equal(SLIDE_TYPES['video-slide'].defaults.bunnyLibraryId, '');
});

test('an unconfigured install gets the map it handed in', () => {
  // The fast path, and the promise that this module changes nothing where
  // nobody configured anything.
  for (const config of [null, undefined, {}, { 'bunny-library-id': '   ' }]) {
    assert.equal(withConfiguredDefaults(SLIDE_TYPES, config), SLIDE_TYPES);
  }
  // A blank value is "not configured", not "configured as empty": that is what
  // an unset env var reads as, and the type's own default is the better answer.
  assert.deepEqual(
    applyConfigDefaults({ bunnyLibraryId: 'kept' }, videoSlide, {
      'bunny-library-id': '',
    }),
    [],
  );
});

test('per-language variants are seeded too', () => {
  // `defaultsByLang` holds complete variants of `defaults`, so a key written
  // only into the neutral map would be lost for exactly the decks in that
  // language.
  const def = {
    configDefaults: { libId: 'bunny-library-id' },
    defaults: { libId: '', title: '' },
    defaultsByLang: { nl: { libId: '', title: 'Film' }, 'en-GB': null },
  };
  const out = withConfiguredDefaults(
    { 'fork-slide': def },
    { 'bunny-library-id': LIBRARY },
  );
  assert.equal(out['fork-slide'].defaults.libId, LIBRARY);
  assert.equal(out['fork-slide'].defaultsByLang.nl.libId, LIBRARY);
  assert.equal(out['fork-slide'].defaultsByLang.nl.title, 'Film');
  assert.equal(out['fork-slide'].defaultsByLang['en-GB'], null);
  // The declaration is untouched by the fold.
  assert.equal(def.defaults.libId, '');
  assert.equal(def.defaultsByLang.nl.libId, '');
});

// -------------------------------------------------------- 3. the env half

test('the env half reads BUNNY_LIBRARY_ID and feeds the seam', () => {
  withEnv(` ${LIBRARY} `, () => {
    assert.deepEqual(instanceSlideDefaults(), {
      'bunny-library-id': LIBRARY,
    });
    assert.equal(
      instanceSlideTypes(SLIDE_TYPES)['video-slide'].defaults.bunnyLibraryId,
      LIBRARY,
    );
  });
  withEnv(null, () => {
    assert.deepEqual(instanceSlideDefaults(), { 'bunny-library-id': '' });
    assert.equal(instanceSlideTypes(SLIDE_TYPES), SLIDE_TYPES);
  });
  // Every source the vocabulary declares is something the env half produces,
  // so a type can never declare one nothing answers.
  const produced = Object.keys(instanceSlideDefaults());
  assert.deepEqual(produced.sort(), [...CONFIG_DEFAULT_SOURCE_NAMES].sort());
});

test('both server map seams go through the env half', () => {
  // The two places a surface's type map is built: the server-side registry
  // every creation path resolves against, and the response the editor holds
  // and composes new slides from. Fold it in anywhere else and the two
  // surfaces disagree about what a new slide starts with.
  const reads = (path) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  for (const path of [
    '../server/utils/custom-slide-type-runtime.js',
    '../server/routes/api/slide-types.js',
  ]) {
    assert.match(
      reads(path),
      /instanceSlideTypes\(SLIDE_TYPES\)/,
      `${path}: builds a type map without the installation's configuration`,
    );
  }
});

// ----------------------------------------------------- 4. what it is for

/** The iframe src a rendered video slide carries, or '' when it renders none. */
function renderedSrc(content) {
  const html = videoSlide.renderHtml(content, { id: 's1' }, {});
  const m = html.match(/<iframe[^>]*\ssrc="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

test('a new video slide plays a bare UUID where a library is configured', () => {
  const slide = withEnv(LIBRARY, () =>
    newSlide({
      type: 'video-slide',
      slideTypes: instanceSlideTypes(SLIDE_TYPES),
      content: { source: BUNNY_UUID },
    }),
  );
  // The slide stores the value like any other content, which is what makes
  // every surface downstream — canvas, presenter, reader, the four export
  // paths — read the key it already read.
  assert.equal(slide.content.bunnyLibraryId, LIBRARY);
  assert.match(
    renderedSrc(slide.content),
    new RegExp(
      `^https://iframe\\.mediadelivery\\.net/embed/${LIBRARY}/${BUNNY_UUID}\\?`,
    ),
  );
});

test('without configuration the same slide asks for a link', () => {
  const slide = withEnv(null, () =>
    newSlide({
      type: 'video-slide',
      slideTypes: instanceSlideTypes(SLIDE_TYPES),
      content: { source: BUNNY_UUID },
    }),
  );
  assert.equal(slide.content.bunnyLibraryId, '');
  assert.equal(renderedSrc(slide.content), '');
  const html = videoSlide.renderHtml(slide.content, { id: 's1' }, {});
  assert.match(html, /video-empty/);
});

test('a pasted embed URL names its own library and ignores the configured one', () => {
  // The self-naming form needs no configuration, so configuring one must not
  // rewrite it.
  const pasted = `https://iframe.mediadelivery.net/embed/999999/${BUNNY_UUID}`;
  const slide = withEnv(LIBRARY, () =>
    newSlide({
      type: 'video-slide',
      slideTypes: instanceSlideTypes(SLIDE_TYPES),
      content: { source: pasted },
    }),
  );
  assert.match(renderedSrc(slide.content), /\/embed\/999999\//);
});

// ------------------------------------------------- 5. nothing fork-shaped

test("core's video defaults name no video and no library", () => {
  assert.equal(videoSlide.defaults.source, '');
  assert.equal(videoSlide.defaults.bunnyLibraryId, '');
  // The UUID and the library B650 removed, pinned by value so neither comes
  // back through a defaults map, a sample or an example.
  const src = readFileSync(
    fileURLToPath(
      new URL('../shared/slide-types/types/video-slide.js', import.meta.url),
    ),
    'utf8',
  );
  assert.doesNotMatch(src, /3045cc09-605c-40d9-aa76-9ace93e7f637/);
  assert.doesNotMatch(src, /366590/);
});

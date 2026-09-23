/**
 * B243: one factory where a slide comes into being.
 *
 * Four routes used to create a slide, with three different compositions
 * between them and one that skipped composition entirely:
 *
 * - the editor's three insert sites went through `makeNewSlide`
 *   (`defaultsByLang`, instance keys) and then had the panel add a background
 *   preset back afterwards;
 * - `newPresentation`, the public API's per-slide POST and the slide-library
 *   insert went through `newSlide` (bare `defaults`, preset, a `pollId` branch
 *   on the type name);
 * - deck import composed a third time inside `normalizeDeckSlide`;
 * - the MCP write tools validated and stored raw, so an agent-created poll
 *   slide reached storage with no `pollId` at all.
 *
 * Every hook that has to hold "on both creation paths" — the preset seed, the
 * instance keys, and next the theme ground of B160 — therefore had to be
 * written three times and still missed the fourth. `newSlide()` is now the one
 * composition and every route hands it what it knows.
 *
 * This file pins that in two ways: behaviourally (the routes agree on the
 * content they produce), and at source level (a new route cannot quietly grow
 * a fourth composition, and a normalize call cannot quietly drop the theme).
 *
 * Run with: node --test tests/one-slide-factory.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { walkJsFiles, callArguments } from './helpers/call-sites.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { newSlide } from '../shared/slide-types/presentation.js';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';
import { migratePresentation } from '../shared/slide-types/schema-version.js';

/**
 * A theme that declares background presets, slide-background variants, and a
 * ground of its own (B160) — so every parity claim below is made against a
 * theme that actually steers composition, not a bare one.
 */
const THEME = {
  backgroundPresets: ['/assets/images/backgrounds/preset-one.jpg'],
  slideBackgrounds: [{ id: 'seaweed', label: 'Seaweed' }],
  defaultBackground: 'seaweed',
};

/** Ids are per-instance by construction; content is what the routes must agree on. */
function withoutInstanceIds(content) {
  const { pollId, presentationId, ...rest } = content;
  return rest;
}

// ── the routes agree ────────────────────────────────────────────────────────

test('creating and importing a slide of the same type yield the same content', () => {
  // The editor insert (the factory, with the registry the editor holds) and a
  // deck import of a bare `{ type }` slide. The import path builds a patch and
  // hands it to the same factory, so on every key neither route was given they
  // must land on the same value — for the whole registry, and for a deck
  // language too: a type declaring `defaultsByLang` composes from that variant
  // on import exactly as on insert.
  //
  // Keys the migration funnel synthesizes are excluded, and they are the reason
  // this compares key by key rather than whole objects: an imported slide runs
  // the funnel first, which seeds a shape for the legacy-collection types
  // (`text-blocks-slide` gets an empty `rows` skeleton), so the import genuinely
  // *was* given those keys. That is the funnel's contract, not the factory's.
  for (const [type, lang] of Object.keys(SLIDE_TYPES).flatMap((t) => [
    [t, null],
    [t, 'nl'],
  ])) {
    const created = withoutInstanceIds(
      newSlide({
        type,
        slideTypes: SLIDE_TYPES,
        theme: THEME,
        lang,
        presentationId: 'deck-1',
      }).content,
    );
    const [importedSlide] = deckToPresentationParts(
      { slides: [{ type, content: {} }] },
      { theme: THEME, lang },
    ).slides;
    const imported = withoutInstanceIds(importedSlide.content);
    const funnelSeeded = new Set(
      Object.keys(
        migratePresentation({ slides: [{ type, content: {} }] }).slides[0]
          .content || {},
      ),
    );

    assert.deepEqual(
      Object.keys(imported)
        .filter((k) => !funnelSeeded.has(k))
        .sort(),
      Object.keys(created)
        .filter((k) => !funnelSeeded.has(k))
        .sort(),
      `${type} (${lang}): creating and importing must produce the same content keys`,
    );
    for (const key of Object.keys(created)) {
      if (funnelSeeded.has(key)) continue;
      assert.deepEqual(
        imported[key],
        created[key],
        `${type}.${key} (${lang}): an imported slide must compose like a created one`,
      );
    }
  }
});

test("a theme background is the type's declaration, on every route (D92)", () => {
  // One rule for one question. `autoBackgroundPreset` on the type decides
  // whether a slide takes a background from `theme.backgroundPresets`; no route
  // seeds one by type name on top of that. Import used to seed the core
  // `title-slide` by name and the converter did the same for
  // chapter-title → title, so an imported or converted title slide wore a
  // theme photo an inserted one did not.
  const chapter = { type: 'chapter-title-slide', content: { title: 'Ch.' } };
  assert.ok(!SLIDE_TYPES['title-slide'].autoBackgroundPreset);
  assert.ok(
    !newSlide({ type: 'title-slide', theme: THEME }).content.slideBgImage,
    'insert: the core title type declares nothing, so nothing is seeded',
  );
  assert.ok(
    !deckToPresentationParts(
      { slides: [{ type: 'title-slide', content: {} }] },
      { theme: THEME },
    ).slides[0].content.slideBgImage,
    'import: no seed by name',
  );
  assert.ok(
    !convertSlideToType(chapter, 'title-slide', { theme: THEME }).content
      .slideBgImage,
    'convert: no seed by name',
  );

  // The declaration is enough: a registry whose title type declares the flag
  // is seeded on the same three routes, and a background carried into a
  // conversion is not overwritten.
  const declared = {
    ...SLIDE_TYPES,
    'title-slide': {
      ...SLIDE_TYPES['title-slide'],
      autoBackgroundPreset: true,
    },
  };
  assert.equal(
    newSlide({ type: 'title-slide', theme: THEME, slideTypes: declared })
      .content.slideBgImage,
    THEME.backgroundPresets[0],
  );
  assert.equal(
    convertSlideToType(chapter, 'title-slide', {
      theme: THEME,
      slideTypes: declared,
    }).content.slideBgImage,
    THEME.backgroundPresets[0],
  );
  assert.equal(
    convertSlideToType(
      { ...chapter, content: { ...chapter.content, slideBgImage: '/own.jpg' } },
      'title-slide',
      { theme: THEME, slideTypes: declared },
    ).content.slideBgImage,
    '/own.jpg',
  );
});

test('a type declaring instance keys gets them on every route', () => {
  // The MCP write path used to store validated content raw, which is how an
  // agent-created poll slide reached storage without the id its live state is
  // addressed by. The declaration is applied by the factory, so every route
  // that composes gets it.
  const created = newSlide({ type: 'poll-slide' });
  assert.match(
    created.content.pollId,
    /^[0-9a-f-]{36}$/,
    'a created poll slide carries a fresh pollId',
  );

  const [imported] = deckToPresentationParts({
    slides: [{ type: 'poll-slide', content: { question: 'Hm?' } }],
  }).slides;
  assert.match(imported.content.pollId, /^[0-9a-f-]{36}$/);
  assert.notEqual(imported.content.pollId, created.content.pollId);

  const withDeck = newSlide({
    type: 'follow-invite-slide',
    presentationId: 'deck-7',
  });
  assert.equal(withDeck.content.presentationId, 'deck-7');
});

test('content handed to the factory is a patch over the defaults', () => {
  // What "don't blank a required field on import" means once the factory owns
  // the defaults: an omitted key keeps the default, a present one wins.
  const def = SLIDE_TYPES['content-slide'];
  const bare = newSlide({ type: 'content-slide' });
  const patched = newSlide({
    type: 'content-slide',
    content: { title: 'Mine' },
  });
  assert.equal(patched.content.title, 'Mine');
  for (const key of Object.keys(def.defaults || {})) {
    if (key === 'title') continue;
    assert.deepEqual(
      patched.content[key],
      bare.content[key],
      `${key}: a key the caller omits keeps the type's default`,
    );
  }
});

test('a background the caller brings is never overwritten by a theme preset', () => {
  // The seed runs after the merge, so a slide-library item or an imported slide
  // that already carries a background (canonical or legacy) keeps it. Ordering
  // this the other way round is the regression this pins: the preset would be
  // written first and a legacy `bgImage` would then arrive alongside it.
  const def = { autoBackgroundPreset: true, defaults: {}, fields: [] };
  const registry = { 'forky-title': def };
  const seeded = newSlide({
    type: 'forky-title',
    slideTypes: registry,
    theme: THEME,
  });
  assert.equal(seeded.content.slideBgImage, THEME.backgroundPresets[0]);

  const legacy = newSlide({
    type: 'forky-title',
    slideTypes: registry,
    theme: THEME,
    content: { bgImage: '/mine.jpg' },
  });
  assert.equal(legacy.content.bgImage, '/mine.jpg');
  assert.ok(
    !legacy.content.slideBgImage,
    'no preset is stacked on a legacy background',
  );
});

test('an imported enum value the theme adds is kept, not reset', () => {
  // The import funnel asks the same question the editor's picker and the
  // agent-facing schema ask: a theme may add slide-background variants, so
  // `background` is not closed by the definition alone.
  const [imported] = deckToPresentationParts(
    { slides: [{ type: 'content-slide', content: { background: 'seaweed' } }] },
    { theme: THEME },
  ).slides;
  assert.equal(imported.content.background, 'seaweed');

  // Without the theme the variant is not on offer, so the key falls back to the
  // type's default rather than importing an unrenderable value.
  const [noTheme] = deckToPresentationParts({
    slides: [{ type: 'content-slide', content: { background: 'seaweed' } }],
  }).slides;
  assert.equal(
    noTheme.content.background,
    SLIDE_TYPES['content-slide'].defaults.background,
  );
});

// ── the guards ──────────────────────────────────────────────────────────────

/**
 * Cloning a type's `defaults` is what "composing a slide" starts with, so a
 * second site doing it is a second composition. `resolveTypeDefaults` is the
 * one that may; everything else must go through the factory.
 */
const DEFAULTS_CLONE = /(?:structuredClone|deepClone)\s*\([^)]*\bdefaults\b/;

/** Files allowed to resolve a type's defaults, and why. */
const CLONE_ALLOWED = new Set([
  // The resolver itself — the one place `defaults` / `defaultsByLang` is read.
  'shared/slide-types/type-defaults.js',
  // A collection field's new-item skeleton, not a slide's content.
  'client/views/editor/editor-form/collection-editor.js',
  // The slide-type builder editing a definition, not creating a slide from one.
  'client/views/settings/tabs/slide-types-tab/index.js',
]);

test('only the shared resolver composes a slide from a type default', () => {
  const offenders = [];
  for (const dir of ['client', 'server', 'shared']) {
    for (const file of walkJsFiles(path.join(process.cwd(), dir))) {
      const rel = path.relative(process.cwd(), file);
      if (CLONE_ALLOWED.has(rel)) continue;
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const line of source.split('\n')) {
        if (DEFAULTS_CLONE.test(line)) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these sites clone a type's defaults instead of composing through newSlide():\n${offenders.join('\n')}`,
  );
});

/**
 * Source with comments blanked out. Both guards scan for a call shape, and
 * `deckToPresentationParts()` is named in prose in three places — a guard that
 * reports those is a guard nobody keeps green.
 * @param {string} source
 * @returns {string}
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('every deck normalization is given a theme and a language', () => {
  // A slide composes against the theme (background presets, slide-background
  // variants) and the deck language (`defaultsByLang`). Twelve of the thirteen
  // call sites used to pass no theme, and none passed a language, so an
  // imported or AI-generated slide came out different from an inserted one.
  const offenders = [];
  for (const dir of ['server', 'shared', 'client']) {
    for (const file of walkJsFiles(path.join(process.cwd(), dir))) {
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const args of callArguments(source, 'deckToPresentationParts')) {
        if (!args[1]?.includes('theme') || !args[1]?.includes('lang')) {
          offenders.push(
            `${path.relative(process.cwd(), file)}: deckToPresentationParts(${args.join(', ')})`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these call sites normalize a deck without a theme or a language:\n${offenders.join('\n')}`,
  );
});

test('every slide composition and conversion is given a theme', () => {
  // The factory and the converter both re-seed a slide for its type, and that
  // seed reads the theme: the ground (`defaultBackground`, B160), the
  // background presets, the variants a type may carry. A call site without
  // a theme is a route where a slide comes out different from every other —
  // the public-API library insert and the theme-change conversion used to be
  // two such routes.
  const offenders = [];
  for (const dir of ['server', 'shared', 'client']) {
    for (const file of walkJsFiles(path.join(process.cwd(), dir))) {
      const rel = path.relative(process.cwd(), file);
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const args of callArguments(source, '\\bnewSlide')) {
        if (!args[0]?.includes('theme'))
          offenders.push(`${rel}: newSlide(${args.join(', ')})`);
      }
      for (const args of callArguments(source, '\\bconvertSlideToType')) {
        if (!args[2]?.includes('theme'))
          offenders.push(`${rel}: convertSlideToType(${args.join(', ')})`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these call sites compose or convert a slide without a theme:\n${offenders.join('\n')}`,
  );
});

/**
 * The top-level keys of every object literal in a source file. A bracket-depth
 * scan like `callArguments`: nested literals and calls are skipped over, so
 * `{ id, content: { type } }` reports `id` and `content`, not `type`. A spread
 * is no key, so `{ ...newSlide(…), id }` reports only `id`.
 * @param {string} source - Source with comments already removed.
 * @returns {Set<string>[]}
 */
function objectLiteralKeys(source) {
  const literals = [];
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let top = '';
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) depth -= 1;
      if (depth === 0) break;
      if (depth === 1 && i > start) top += c;
    }
    const keys = [
      ...top.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g),
    ];
    literals.push(new Set(keys.map((m) => m[1])));
  }
  return literals;
}

/**
 * Route files that hold an `{ id, type, content }` literal which is not a slide
 * coming into being. Each names what it is instead.
 */
const SLIDE_LITERAL_ALLOWED = new Set([
  // A projection of a stored slide for the activity feed.
  'server/routes/api/activity.js',
  // A portable-deck document; `deckToPresentationParts` composes it on import.
  'server/routes/api/ai/wizard-v2-stream.js',
  // A stored library item viewed as a slide for the HTML gate and the preview.
  'server/routes/api/slide-library.js',
  // A projection of generated slides in the response.
  'server/routes/public-api/v1/ai.js',
  // PATCH of a slide that already exists.
  'server/routes/public-api/v1/slides.js',
]);

test('no route builds a new slide as a bare literal (B272)', () => {
  // Accepting a comment's proposed slide and importing PDF pages as image
  // slides both wrote `{ id, type, content }` straight into the deck: no type
  // defaults, no instance keys, no notes or visibility, no theme ground. A new
  // slide under `server/routes/` is made by `newSlide()`.
  const offenders = [];
  for (const file of walkJsFiles(path.join(process.cwd(), 'server/routes'))) {
    const rel = path.relative(process.cwd(), file);
    if (SLIDE_LITERAL_ALLOWED.has(rel)) continue;
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const keys of objectLiteralKeys(source)) {
      if (keys.has('id') && keys.has('type') && keys.has('content'))
        offenders.push(`${rel}: { ${[...keys].join(', ')} }`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these routes build a slide without newSlide():\n${offenders.join('\n')}`,
  );
});

test('the guards would catch what they are for', () => {
  assert.deepEqual(
    callArguments('x = newSlide({ type, slideTypes });', '\\bnewSlide'),
    [['{ type, slideTypes }']],
  );
  assert.deepEqual(
    callArguments('makeNewSlide({ theme });', '\\bnewSlide'),
    [],
    'a word boundary keeps a differently named helper out of the scan',
  );
  // A blinded guard passes silently, so both patterns are exercised here.
  assert.ok(DEFAULTS_CLONE.test('  const c = structuredClone(def.defaults);'));
  assert.ok(DEFAULTS_CLONE.test('  return deepClone(byLang || def.defaults);'));
  assert.ok(
    !DEFAULTS_CLONE.test('  const c = structuredClone(slide.content);'),
  );
  assert.deepEqual(
    callArguments(
      'deckToPresentationParts(deck);\n',
      'deckToPresentationParts',
    ),
    [['deck']],
  );
  assert.deepEqual(
    objectLiteralKeys('s = { id: uuid(), type: t, content: { a: 1 }, notes };'),
    [new Set(['id', 'type', 'content', 'notes']), new Set(['a'])],
  );
  assert.deepEqual(
    objectLiteralKeys('x = { ...newSlide({ type, theme }), id };'),
    [new Set(['id']), new Set(['type', 'theme'])],
  );
  assert.equal(withoutComments('a // ready for foo()\nb').trim(), 'a \nb');
  assert.equal(withoutComments('/** foo() */\nb').trim(), 'b');
});

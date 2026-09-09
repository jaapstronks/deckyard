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
import { migratePresentation } from '../shared/slide-types/schema-version.js';

/** A theme that declares both background presets and slide-background variants. */
const THEME = {
  backgroundPresets: ['/assets/images/backgrounds/preset-one.jpg'],
  slideBackgrounds: [{ id: 'seaweed', label: 'Seaweed' }],
};

/** Ids are per-instance by construction; content is what the routes must agree on. */
function withoutInstanceIds(content) {
  const { pollId, presentationId, ...rest } = content;
  return rest;
}

// ── the routes agree ────────────────────────────────────────────────────────

/**
 * The one type where creating and importing still disagree, and why.
 *
 * The factory seeds a theme background by DECLARATION (`autoBackgroundPreset`),
 * which no core type carries; deck import has always seeded the core title
 * slide by NAME. Two rules for one question, and which one wins is a form
 * decision — does `title-slide` declare the flag, or does import stop seeding?
 * — not something a refactor gets to settle. B243 preserved the imported
 * behaviour and left the decision to B256; when that lands, this exception
 * goes and the loop below covers the whole registry.
 */
const IMPORT_SEEDS_BY_NAME = 'title-slide';

test('creating and importing a slide of the same type yield the same content', () => {
  // The editor insert (the factory, with the registry the editor holds) and a
  // deck import of a bare `{ type }` slide. The import path builds a patch and
  // hands it to the same factory, so on every key neither route was given they
  // must land on the same value.
  //
  // Keys the migration funnel synthesizes are excluded, and they are the reason
  // this compares key by key rather than whole objects: an imported slide runs
  // the funnel first, which seeds a shape for the legacy-collection types
  // (`text-blocks-slide` gets an empty `rows` skeleton), so the import genuinely
  // *was* given those keys. That is the funnel's contract, not the factory's.
  for (const type of Object.keys(SLIDE_TYPES)) {
    if (type === IMPORT_SEEDS_BY_NAME) continue;
    const created = withoutInstanceIds(
      newSlide({
        type,
        slideTypes: SLIDE_TYPES,
        theme: THEME,
        presentationId: 'deck-1',
      }).content,
    );
    const [importedSlide] = deckToPresentationParts(
      { slides: [{ type, content: {} }] },
      { theme: THEME },
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
      `${type}: creating and importing must produce the same content keys`,
    );
    for (const key of Object.keys(created)) {
      if (funnelSeeded.has(key)) continue;
      assert.deepEqual(
        imported[key],
        created[key],
        `${type}.${key}: an imported slide must compose like a created one`,
      );
    }
  }
});

test('the one remaining disagreement is the title-slide import seed', () => {
  // Pinned so the exception above cannot quietly widen, and so the day
  // `title-slide` declares `autoBackgroundPreset` (or import stops seeding by
  // name) this test says which half moved.
  const created = newSlide({ type: IMPORT_SEEDS_BY_NAME, theme: THEME });
  assert.ok(
    !created.content.slideBgImage,
    'the core title type declares no autoBackgroundPreset, so creating seeds nothing',
  );
  const [imported] = deckToPresentationParts(
    { slides: [{ type: IMPORT_SEEDS_BY_NAME, content: {} }] },
    { theme: THEME },
  ).slides;
  assert.equal(imported.content.slideBgImage, THEME.backgroundPresets[0]);
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

test('every deck normalization is given a theme', () => {
  // A slide composes against the theme (background presets, slide-background
  // variants). Twelve of the thirteen call sites used to pass none, so an
  // imported or AI-generated slide came out different from an inserted one.
  const offenders = [];
  for (const dir of ['server', 'shared', 'client']) {
    for (const file of walkJsFiles(path.join(process.cwd(), dir))) {
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const args of callArguments(source, 'deckToPresentationParts')) {
        if (!args[1]?.includes('theme')) {
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
    `these call sites normalize a deck without a theme:\n${offenders.join('\n')}`,
  );
});

test('the guards would catch what they are for', () => {
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
  assert.equal(withoutComments('a // ready for foo()\nb').trim(), 'a \nb');
  assert.equal(withoutComments('/** foo() */\nb').trim(), 'b');
});

/**
 * B160 / D88: a theme declares the ground its slides start on.
 *
 * A slide type writes `defaults.background` theme-agnostically — it cannot know
 * which theme will carry it — so a theme whose whole design stands on another
 * ground had every newly inserted slide arrive on the wrong one, and the author
 * changed them by hand. `theme.defaultBackground` is that missing counterpart
 * to `defaultTitleSlide`: one string, said once.
 *
 * Where it is honoured is a declaration, not a name: the theme's id must be in
 * the union the editor's background picker already builds for that type (its
 * own `background` options plus the theme's `slideBackgrounds` variants, read
 * through `allowedEnumValues`). A type that does not offer the id — and a type
 * with no `background` field at all — keeps its own default.
 *
 * And it is a *default*: it is applied where a type's defaults are resolved
 * (`resolveTypeDefaults`), so the caller's content patch wins over it exactly
 * as over any other key, and both surfaces that resolve type defaults — the
 * slide factory and the type converter — get it from the same place.
 *
 * Run with: node --test tests/theme-default-background.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { newSlide } from '../shared/slide-types/presentation.js';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';
import { normalizeTheme } from '../shared/theme-normalize.js';
import { validateThemeConfig } from '../shared/theme-config-schema.js';
import { buildThemeConfig } from '../server/utils/theme-builder.js';

/** A theme that stands on mist. `content-slide` defaults to lime without it. */
const MIST = { defaultBackground: 'mist' };

/** A theme whose ground is a variant it ships itself. */
const VARIANT = {
  defaultBackground: 'seaweed',
  slideBackgrounds: [{ id: 'seaweed', label: 'Seaweed', value: '#0d2b22' }],
};

function backgroundOf(type, theme, opts = {}) {
  return newSlide({ type, theme, ...opts }).content.background;
}

// ── the rule ────────────────────────────────────────────────────────────────

test('the theme ground replaces the type default where the type offers it', () => {
  // `content-slide` defaults to lime and offers lime/mist; `kpi-metrics-slide`
  // already defaults to mist. Both land on the theme's ground, so the answer
  // does not depend on what the type happened to write.
  assert.equal(backgroundOf('content-slide', MIST), 'mist');
  assert.equal(backgroundOf('kpi-metrics-slide', MIST), 'mist');
  assert.equal(backgroundOf('title-slide', MIST), 'mist');
});

test('a type that does not offer the id keeps its own default', () => {
  // `accent` is only on the extended background field. `countdown-slide`
  // declares that one, `content-slide` the two-option one — so the same theme
  // moves the first and leaves the second alone. No branch on a type name:
  // what a type offers is what its declaration says it offers.
  const accent = { defaultBackground: 'accent' };
  assert.equal(backgroundOf('countdown-slide', accent), 'accent');
  assert.equal(backgroundOf('content-slide', accent), 'lime');

  // An id no type and no theme variant offers moves nothing at all.
  const unknown = { defaultBackground: 'not-a-background' };
  assert.equal(backgroundOf('content-slide', unknown), 'lime');
  assert.equal(backgroundOf('countdown-slide', unknown), 'dark');
});

test('a type without a background field gets no background key', () => {
  // `quote-slide` does not declare the field, so there is nothing for the
  // theme to replace — and inventing the key would put a value in content
  // that no field owns.
  assert.equal(backgroundOf('quote-slide', MIST), undefined);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(
      newSlide({ type: 'quote-slide', theme: MIST }).content,
      'background',
    ),
  );
});

test("a theme's own variant may be its ground", () => {
  assert.equal(backgroundOf('content-slide', VARIANT), 'seaweed');
});

test('the ground is a default: content the caller brings wins over it', () => {
  // The patch rule of the factory (step 2), unchanged by this: a caller that
  // names a background — an import, a library item, an agent — keeps it.
  assert.equal(
    backgroundOf('content-slide', MIST, { content: { background: 'lime' } }),
    'lime',
  );
});

// ── every route ─────────────────────────────────────────────────────────────

test('the import route seeds the theme ground, and a variant survives it', () => {
  const [mist] = deckToPresentationParts(
    { slides: [{ type: 'content-slide', content: {} }] },
    { theme: MIST, lang: 'nl' },
  ).slides;
  assert.equal(mist.content.background, 'mist');

  // The enum reset in `normalizeDeckSlide` reads the same theme-aware union,
  // so a variant id is not reset to the type's first option on the way in.
  const [variant] = deckToPresentationParts(
    { slides: [{ type: 'content-slide', content: {} }] },
    { theme: VARIANT, lang: 'nl' },
  ).slides;
  assert.equal(variant.content.background, 'seaweed');

  // An imported slide that names its own background still keeps it.
  const [named] = deckToPresentationParts(
    { slides: [{ type: 'content-slide', content: { background: 'lime' } }] },
    { theme: MIST, lang: 'nl' },
  ).slides;
  assert.equal(named.content.background, 'lime');
});

test('a converted slide lands on the theme ground of its new type', () => {
  // `convertSlideToType` re-seeds the target type's defaults through the same
  // resolver, so a conversion cannot be the one route that ignores the theme —
  // the split D92 closed for the background preset, closed here for the ground.
  const list = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    type: 'list-slide',
    content: { title: 'Punten', items: ['een'] },
  };
  const converted = convertSlideToType(list, 'content-slide', { theme: MIST });
  assert.equal(converted.content.background, 'mist');
});

// ── the theme surfaces ──────────────────────────────────────────────────────

test('normalizeTheme folds the id to one spelling', () => {
  assert.equal(
    normalizeTheme({ defaultBackground: '  MIST ' }).defaultBackground,
    'mist',
  );
  // A theme that says nothing declares nothing — every type keeps its default.
  assert.equal(normalizeTheme({}).defaultBackground, '');
});

test('a stored config keeps only a ground it offers itself', () => {
  // The write gate for a DB theme: `lime`, `mist` or one of this config's own
  // variants — the set the theme editor's select is built from. Anything
  // else would be a stored id that resolves to nothing, a second state for
  // "no ground", so it is dropped rather than kept.
  const calm = { id: 'calm', label: 'Calm', value: '#eef' };
  assert.equal(
    validateThemeConfig({ defaultBackground: 'lime' }).defaultBackground,
    'lime',
  );
  assert.equal(
    validateThemeConfig({ defaultBackground: ' MIST ' }).defaultBackground,
    'mist',
    'one spelling at the gate as well',
  );
  assert.equal(
    validateThemeConfig({ slideBackgrounds: [calm], defaultBackground: 'calm' })
      .defaultBackground,
    'calm',
  );
  for (const id of ['calm', 'dark', 'nope', '']) {
    assert.equal(
      validateThemeConfig({ defaultBackground: id }).defaultBackground,
      undefined,
      `"${id}" is not a ground this config offers`,
    );
  }
});

test('a DB theme can declare it too', () => {
  // The file/DB gap `theme-config-schema` exists to close: the key survives
  // validation of the stored config and reaches the built theme.
  assert.equal(
    validateThemeConfig({ defaultBackground: 'mist' }).defaultBackground,
    'mist',
  );
  const built = buildThemeConfig({
    id: 'uuid-1',
    slug: 'acme',
    label: 'Acme',
    colors: {
      primary: '#7c3aed',
      background: '#fefefe',
      textLight: '#ffffff',
      textDark: '#1f2937',
    },
    fonts: { heading: 'Montserrat', body: 'Inter' },
    config: { defaultBackground: 'mist' },
  });
  assert.equal(built.defaultBackground, 'mist');
  assert.equal(
    newSlide({ type: 'content-slide', theme: normalizeTheme(built) }).content
      .background,
    'mist',
  );
  // A row that says nothing keeps every type on its own default.
  const plain = buildThemeConfig({
    id: 'uuid-2',
    slug: 'plain',
    label: 'Plain',
    colors: {
      primary: '#7c3aed',
      background: '#fefefe',
      textLight: '#ffffff',
      textDark: '#1f2937',
    },
    fonts: { heading: 'Montserrat', body: 'Inter' },
    config: {},
  });
  assert.equal(plain.defaultBackground, undefined);
  assert.equal(
    newSlide({ type: 'content-slide', theme: normalizeTheme(plain) }).content
      .background,
    'lime',
  );
});

// ── the MCP write route, end to end ─────────────────────────────────────────

/**
 * The promise the brief makes is "on every route", and MCP is the route that
 * used to compose its own slides. It now goes through the factory with the
 * loaded theme, so the ground has to arrive in storage — proven here against
 * a database theme (the fork's own case) with the in-memory DB double, which
 * exercises the stored-config half of the plumbing at the same time.
 */
process.env.AUTH_SECRET = ['deckyard', 'test', 'b160']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
/** Unique per file: `loadDeckTheme` memoizes a DB theme by its UUID. */
const THEME_ID = '99999999-1111-4222-8333-444444444444';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { userRows } = await import('./helpers/identity-fixtures.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

test('MCP create_presentation_from_slides seeds the theme ground', async () => {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [
      {
        id: THEME_ID,
        organization_id: ORG,
        slug: 'ground',
        label: 'Ground',
        logo_url: null,
        logo_small_url: null,
        colors: {
          primary: '#7c3aed',
          background: '#fefefe',
          textLight: '#ffffff',
          textDark: '#1f2937',
        },
        fonts: { heading: 'Montserrat', body: 'Inter' },
        config: { version: 1, defaultBackground: 'mist' },
        is_default: false,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        created_by: null,
      },
    ],
    presentations: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());

  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get('create_presentation_from_slides');
  assert.ok(tool, 'create_presentation_from_slides is not registered');

  await tool.handler(
    {
      title: 'Van een agent',
      theme: THEME_ID,
      lang: 'nl',
      validation: 'strict',
      slides: [
        { type: 'content-slide', content: { title: 'Hoi', body: 'Tekst' } },
        {
          type: 'quote-slide',
          content: {
            quote: 'Zo dan',
            authorName: 'Iemand',
            authorTitle: 'Rol',
          },
        },
      ],
    },
    { ownerEmail: OWNER, organizationId: ORG },
  );

  const stored = db.__tables.presentations[0];
  assert.ok(stored, 'the deck was created');
  assert.equal(
    stored.slides[0].content.background,
    'mist',
    'an agent-created content slide lands on the theme ground',
  );
  assert.equal(
    stored.slides[1].content.background,
    undefined,
    'a type that does not offer a background is untouched',
  );
});

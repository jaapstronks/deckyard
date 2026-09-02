/**
 * The public viewer and the embed offer the versions the deck has (B182/D72 #6).
 *
 * Both surfaces used to render a fixed `NL  EN` pair, gated on
 * `hasLangVersion(pres, otherLang(modeLang))`. That is two claims a deck cannot
 * make good on: a Dutch-only deck showed an English button that switched to a
 * version it did not have, and a deck with a German version showed no German
 * button at all — even though `/p/…?lang=de` served it perfectly. The switch is
 * built from `existingVersionLangs()` now, in the versions' own order, with the
 * native language name as its label (D77).
 *
 * House shape: the exported handler called directly with a req/res double over
 * `tests/helpers/fake-db.js` (see tests/published-embed-first-party-only.test.js).
 *
 * Run with: node --test tests/viewer-language-switch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handlePublishedPage } =
  await import('../server/routes/static/published.js');
const { handleEmbed } = await import('../server/routes/static/embed.js');
const { renderEmbedHtmlDocument } =
  await import('../server/utils/embed-html/template.js');

const PUBLISH_ID = 'abcd1234';
const SLUG = 'my-deck';

const version = (title) => ({
  title,
  slides: [{ id: 's1', type: 'content-slide', content: { title } }],
});

/** Seed one published deck carrying exactly the language versions named. */
function seed(langs) {
  const versions = {};
  for (const lang of langs) versions[lang] = version(`Deck ${lang}`);
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      presentations: [
        {
          id: 'deck-pub',
          organization_id: ORG,
          title: 'Deck nl',
          owner_email: 'owner@example.com',
          created_by: 'owner@example.com',
          updated_by: 'owner@example.com',
          visibility: 'organization',
          theme: 'default',
          lang: langs[0],
          revision: 1,
          is_view_only: false,
          slides: [{ id: 's1', type: 'content-slide', content: {} }],
          i18n: { dominant: langs[0], versions },
          settings: {},
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
      published_presentations: [
        {
          id: PUBLISH_ID,
          organization_id: ORG,
          presentation_id: 'deck-pub',
          title: 'Deck nl',
          slug: SLUG,
          og_image_url: null,
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
        },
      ],
      app_settings: [{ id: 'singleton', settings: {} }],
    }),
  );
}

test.before(async () => {
  seed(['nl']);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** A response double capturing status/headers/body. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    rawBody: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      return this;
    },
  };
}

/** Drive a viewer handler and hand back the document it wrote. */
async function documentFrom(handle, pathAndQuery) {
  const res = makeRes();
  const handled = await handle({
    repoRoot: process.cwd(),
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
  });
  assert.equal(handled, true, `${pathAndQuery} was handled`);
  assert.equal(res.statusCode, 200, `${pathAndQuery} answered 200`);
  return String(res.rawBody || '');
}

/** The `?lang=` targets of the published page's switch, in document order. */
function publishedSwitchLangs(html) {
  return [
    ...html.matchAll(
      /<a class="sb-segmented-btn[^"]*" href="[^"]*\?lang=([^"&]+)"/g,
    ),
  ].map((m) => decodeURIComponent(m[1]));
}

/** The languages the embed's switch offers, in document order. */
function embedSwitchLangs(html) {
  return [...html.matchAll(/data-embed-lang="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The boot payload the embed's inlined runtime reads.
 *
 * Parsed exactly as the runtime parses it — `JSON.parse` on the block's raw
 * text — because that is the assertion. The payload used to be HTML-escaped,
 * and a `<script>` block is raw text where entities are never decoded, so
 * `JSON.parse('{&quot;lang&quot;…')` threw on every embed ever served and the
 * runtime fell back to its defaults for all of it.
 */
function embedBoot(html) {
  const m = html.match(
    /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert.ok(m, 'the embed carries a boot payload');
  return JSON.parse(m[1]);
}

const published = () =>
  documentFrom(handlePublishedPage, `/p/${PUBLISH_ID}-${SLUG}`);
const embed = () => documentFrom(handleEmbed, `/embed/${PUBLISH_ID}-${SLUG}`);

test('a deck with nl and de offers exactly those two, named natively', async () => {
  seed(['nl', 'de']);
  const page = await published();
  assert.deepEqual(publishedSwitchLangs(page), ['nl', 'de']);
  assert.match(page, /Nederlands<\/a>/);
  assert.match(page, /Deutsch<\/a>/);
  // The retired pair: English was never a version of this deck.
  assert.ok(
    !publishedSwitchLangs(page).includes('en-GB'),
    'no link to a version the deck does not have',
  );

  const frame = await embed();
  assert.deepEqual(embedSwitchLangs(frame), ['nl', 'de']);
  assert.match(frame, /Deutsch<\/button>/);
  // The inlined runtime validates a switch against these, not against the axis.
  assert.deepEqual(embedBoot(frame).versionLangs, ['nl', 'de']);
});

test('a third version is a third button, not an overflow of the pair', async () => {
  seed(['nl', 'en-GB', 'fr']);
  assert.deepEqual(publishedSwitchLangs(await published()), [
    'nl',
    'en-GB',
    'fr',
  ]);
  assert.deepEqual(embedSwitchLangs(await embed()), ['nl', 'en-GB', 'fr']);
});

test('a single-language deck gets no switch at all', async () => {
  seed(['nl']);
  const page = await published();
  assert.deepEqual(publishedSwitchLangs(page), []);
  assert.ok(
    !/<div class="sb-segmented"/.test(page),
    'a one-version deck has nothing to switch between, so the group is absent',
  );
  const frame = await embed();
  assert.deepEqual(embedSwitchLangs(frame), []);
});

test('the version being served is the active button', async () => {
  seed(['nl', 'de']);
  const de = await documentFrom(
    handlePublishedPage,
    `/p/${PUBLISH_ID}-${SLUG}?lang=de`,
  );
  assert.match(
    de,
    /<a class="sb-segmented-btn is-active" href="[^"]*\?lang=de"/,
    'the German link is the active one when German is being served',
  );
  assert.match(de, /"inLanguage":"de"/);
});

test('the embed boot payload is JSON its own runtime can parse', () => {
  // Not about languages as such — but the language switch is one of the four
  // things the runtime silently lost while this was broken (with the slide
  // count, the start index and the allowed-origin list), so it is pinned here
  // beside the switch that depends on it.
  const html = renderEmbedHtmlDocument({
    totalSlides: 3,
    boot: {
      publishId: 'abcd1234',
      totalSlides: 3,
      options: { langSwitch: true },
      lang: 'nl',
      versionLangs: ['nl', 'de'],
    },
  });
  const boot = embedBoot(html);
  assert.equal(boot.totalSlides, 3);
  assert.deepEqual(boot.versionLangs, ['nl', 'de']);
  assert.equal(boot.options.langSwitch, true);
});

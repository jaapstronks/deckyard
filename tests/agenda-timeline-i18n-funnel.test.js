/**
 * Migration 030, finished: a translation stuck on `agenda-timeline-slide`
 * reads back as the `timeline-slide` its dominant version already is (B225).
 *
 * 030 (May 2026) took the consolidation decision and applied it to
 * `presentations.slides` only, on the argument that the renderer had
 * back-compat for the old field names. Rung 3 of the removal then took the
 * *type* off the registry, at which point the field names stopped mattering:
 * a version left behind renders as an *archived* slide in that language alone.
 * The fork's deck `c94a140f` is the proof — one slide id, `timeline-slide` in
 * `slides` and `agenda-timeline-slide` in both `versions.nl` and
 * `versions['en-GB']` (D80).
 *
 * The unit-level behaviour of the v12 -> v13 step (COALESCE order, idempotence,
 * the keys it keeps) lives in tests/schema-version.test.js. This file pins the
 * three seams that matter to a user: the storage read, the import path, and
 * the render — which no longer has a fallback to lean on.
 *
 * Run with: node --test tests/agenda-timeline-i18n-funnel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb, getDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { deckToPresentationParts } =
  await import('../shared/slide-types/deck.js');
const { renderSlideHtml } =
  await import('../shared/slide-types/presentation.js');

const OWNER = 'owner@example.com';
const RETIRED = 'agenda-timeline-slide';

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** The pre-consolidation item shape: `time` for the date, `body` for the text. */
function legacyContent(title) {
  return {
    title,
    subheading: '',
    items: [
      { time: '2020', title: 'Start', body: 'Het begin' },
      { time: '2024', title: 'Nu', body: 'Vandaag' },
    ],
  };
}

/** What those items become — 030's fold, applied by the funnel. */
const CONVERTED_ITEMS = [
  { date: '2020', title: 'Start', text: 'Het begin' },
  { date: '2024', title: 'Nu', text: 'Vandaag' },
];

/**
 * Store a deck exactly as 030 left it: the dominant `slides` already converted,
 * the language versions still on the retired type.
 *
 * Written straight into the row rather than through `updatePresentation`,
 * because the write path runs the same funnel — a deck that arrives through it
 * has already been converted, which is the opposite of what this sets up.
 *
 * @returns {Promise<string>} the presentation id
 */
async function storeHalfMigratedDeck() {
  const converted = {
    id: 's1',
    type: 'timeline-slide',
    content: {
      title: 'Tijdlijn',
      subheading: '',
      items: CONVERTED_ITEMS.map((item) => ({ ...item })),
    },
    notes: '',
  };
  const stuck = (title) => ({
    id: 's1',
    type: RETIRED,
    content: legacyContent(title),
    notes: '',
  });

  const scope = testScope({ actorEmail: OWNER });
  const created = await createPresentation(scope, {
    title: 'Half-migrated deck',
    ownerEmail: OWNER,
  });
  await getDb()
    .updateTable('presentations')
    .set({
      slides: JSON.stringify([converted]),
      i18n: JSON.stringify({
        dominant: 'nl',
        active: 'nl',
        versions: {
          nl: { title: 'Tijdlijn', slides: [stuck('Tijdlijn')] },
          'en-GB': { title: 'Timeline', slides: [stuck('Timeline')] },
        },
      }),
    })
    .where('id', '=', created.id)
    .execute();
  return created.id;
}

test('a translation left on the retired type reads back as a timeline', async () => {
  const id = await storeHalfMigratedDeck();

  const deck = await getPresentation(testScope({ actorEmail: OWNER }), id);

  for (const lang of ['nl', 'en-GB']) {
    const slide = deck.i18n.versions[lang].slides[0];
    assert.equal(slide.type, 'timeline-slide', lang);
    assert.deepEqual(
      slide.content.items.map(({ date, title, text }) => ({
        date,
        title,
        text,
      })),
      CONVERTED_ITEMS,
      lang,
    );
    for (const item of slide.content.items) {
      assert.ok(!('time' in item), `${lang}: legacy \`time\` dropped`);
      assert.ok(!('body' in item), `${lang}: legacy \`body\` dropped`);
    }
  }
});

test('an imported deck on the retired type arrives converted', () => {
  // The seam no migration and no `scripts/` one-off can cover: an export handed
  // to this install was never in any store either could be pointed at.
  const parts = deckToPresentationParts({
    title: 'Old export',
    slides: [{ id: 's1', type: RETIRED, content: legacyContent('Timeline') }],
  });

  assert.equal(parts.slides[0].type, 'timeline-slide');
  assert.deepEqual(
    parts.slides[0].content.items.map(({ date, title, text }) => ({
      date,
      title,
      text,
    })),
    CONVERTED_ITEMS,
  );
});

test('the converted slide renders without any legacy-name fallback', async () => {
  // The point of doing this in the funnel: the renderer can now read one
  // spelling. Rendering the *stored* item shape has to come out empty, and
  // rendering what the funnel produced has to come out whole — otherwise the
  // fallback was still carrying the deck.
  const stored = legacyContent('Tijdlijn');
  const rawHtml = renderSlideHtml(
    { type: 'timeline-slide', content: stored },
    { lang: 'nl' },
  );
  assert.ok(
    !rawHtml.includes('2020') && !rawHtml.includes('Het begin'),
    'the renderer no longer reads `time`/`body`',
  );

  const id = await storeHalfMigratedDeck();
  const deck = await getPresentation(testScope({ actorEmail: OWNER }), id);
  const html = renderSlideHtml(deck.i18n.versions.nl.slides[0], { lang: 'nl' });

  assert.ok(html.includes('2020'), 'the date survives the funnel');
  assert.ok(html.includes('Het begin'), 'the text survives the funnel');
  assert.ok(
    !html.includes('slide-unresolved'),
    'and it is a timeline, not an archived slide',
  );
});

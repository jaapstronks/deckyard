/**
 * B611: MCP's slide-set writers on the slide service.
 *
 * `remove_slide`, `reorder_slides`, `append_slides`, `compress_presentation`
 * and `iterate_presentation` each loaded the deck, changed `pres.slides` and
 * wrote the whole loaded deck back through `updatePresentation`, the last
 * adapter import into `server/storage/presentations/**` (A7.4, D256). They
 * ignored a refused write (a deck over the size limit answered as if stored),
 * and with `i18n.active ≠ dominant` the write seam stored the loaded dominant
 * text as the active version (D320 (6)). Now remove and reorder ask
 * `removeSlide`/`reorderSlides`, the three model-backed tools hand the slide
 * set their input step composed to `replaceSlides` (`server/services/slides.js`),
 * and every write goes through `persistSlides`.
 *
 * The store: OWNER's Dutch deck of three slides with a complete German
 * version, and nobody else's. The model is the one way out, so the provider's
 * `fetch` is swapped for a double that answers what the test hands it
 * (following tests/service-layer-b610.test.js). Every refusal is asserted
 * against the store and the model call count, not read off the message alone.
 *
 * Run with: node --test tests/service-layer-b611.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b611']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.APP_URL = 'https://deck.example';
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
delete process.env.SANDBOX_MODE;
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';
const DECK_ID = 'd0000611-0000-4000-8000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

// --- The store ----------------------------------------------------------------

const slide = (id, title, type = 'content-slide') => ({
  id,
  type,
  content: { title },
});

const NL = {
  title: 'Roadmap',
  slides: [
    slide('slide-1', 'Hoi', 'title-slide'),
    slide('slide-2', 'Twee'),
    slide('slide-3', 'Drie'),
  ],
};
const DE = {
  title: 'Fahrplan',
  slides: [
    slide('slide-1', 'Hallo', 'title-slide'),
    slide('slide-2', 'Zwei'),
    slide('slide-3', 'Drei'),
  ],
};

/**
 * @param {Object} [opts]
 * @param {string} [opts.active='nl'] - The stored active language.
 */
async function installDb({ active = 'nl' } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, OUTSIDER_EMAIL),
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER_EMAIL,
        created_by: OWNER_EMAIL,
        updated_by: OWNER_EMAIL,
        owner_user_id: userIdFor(OWNER_EMAIL),
        created_by_user_id: userIdFor(OWNER_EMAIL),
        updated_by_user_id: userIdFor(OWNER_EMAIL),
        title: NL.title,
        description: null,
        theme: 'default',
        lang: 'nl',
        visibility: 'private',
        is_view_only: false,
        revision: 1,
        settings: {},
        i18n: {
          dominant: 'nl',
          active,
          versions: { nl: structuredClone(NL), de: structuredClone(DE) },
        },
        slides: structuredClone(NL.slides),
        published: null,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    presentation_collaborators: [],
    activity_events: [],
    api_usage_daily: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const storedDeck = (db) =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);

/** The presentation updates since `from` in the query log. */
const presentationUpdates = (db, from = 0) =>
  db.__queryLog
    .slice(from)
    .filter((q) => q.table === 'presentations' && q.op === 'update').length;

const titles = (version) => version.slides.map((s) => s.content.title);

// --- The model ----------------------------------------------------------------

/** Swap the provider's `fetch` for a double answering `answer`; counts calls. */
function stubModel(t, answer) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts = {}) => {
    calls.push(opts);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

/** append_slides: one new Dutch slide in the portable deck format. */
const APPEND_ANSWER = {
  slides: [{ type: 'content-slide', content: { title: 'Vier' } }],
};
/** compress_presentation: drop the third slide. */
const COMPRESS_ANSWER = {
  summary: 'Eén minder',
  merges: [],
  removals: [{ slideIndex: 2, reason: 'Dubbel' }],
};
/** iterate_presentation: rewrite the second slide. */
const ITERATE_ANSWER = {
  summary: 'Korter',
  modifications: [
    {
      slideIndex: 1,
      action: 'replace',
      reasoning: 'Korter',
      slide: {
        type: 'content-slide',
        content: { title: 'Kort', body: 'Korter gezegd' },
      },
    },
  ],
};

// --- The tools ----------------------------------------------------------------

/** An MCP tool, called the way an SSE session of `as` calls it. */
function mcpTool(name, as = OWNER_EMAIL) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER_EMAIL });
  const tool = server.tools.get(name);
  assert.ok(tool, `${name} is not registered`);
  return (args) => tool.handler(args, { ownerEmail: as, organizationId: ORG });
}

/**
 * Each slide-set writer: its arguments, the model answer it needs (none for
 * remove/reorder) and the Dutch titles it leaves behind.
 */
const WRITERS = {
  remove_slide: {
    args: { slideIndex: 1 },
    after: ['Hoi', 'Drie'],
  },
  reorder_slides: {
    args: { fromIndex: 0, toIndex: 2 },
    after: ['Twee', 'Drie', 'Hoi'],
  },
  append_slides: {
    args: { content: 'Een vierde punt' },
    answer: APPEND_ANSWER,
    after: ['Hoi', 'Twee', 'Drie', 'Vier'],
  },
  compress_presentation: {
    args: { apply: true },
    answer: COMPRESS_ANSWER,
    after: ['Hoi', 'Twee'],
  },
  iterate_presentation: {
    args: { command: 'shorten everything' },
    answer: ITERATE_ANSWER,
    after: ['Hoi', 'Kort', 'Drie'],
  },
};

// =============================================================================
// The owner writes once; the other language version stays
// =============================================================================

test('every writer: the owner writes the Dutch slide set in one update; the German version and the deck metadata stay', async (t) => {
  for (const [name, writer] of Object.entries(WRITERS)) {
    const db = await installDb();
    const calls = stubModel(t, writer.answer);
    const from = db.__queryLog.length;

    await mcpTool(name)({ presentationId: DECK_ID, ...writer.args });

    const row = storedDeck(db);
    assert.equal(presentationUpdates(db, from), 1, `${name}: one update`);
    assert.equal(calls.length, writer.answer ? 1 : 0, `${name}: model calls`);
    assert.deepEqual(titles({ slides: row.slides }), writer.after, name);
    assert.deepEqual(titles(row.i18n.versions.nl), writer.after, name);
    assert.deepEqual(
      titles(row.i18n.versions.de),
      ['Hallo', 'Zwei', 'Drei'],
      `${name}: the German version is untouched`,
    );
    assert.equal(row.title, 'Roadmap', name);
    assert.equal(row.i18n.active, 'nl', name);
    assert.equal(row.theme, 'default', name);
  }
});

test('every writer: with active ≠ dominant the active (German) version keeps its own text (the seam reads top-level as the active buffer)', async (t) => {
  for (const [name, writer] of Object.entries(WRITERS)) {
    const db = await installDb({ active: 'de' });
    stubModel(t, writer.answer);

    await mcpTool(name)({ presentationId: DECK_ID, ...writer.args });

    const row = storedDeck(db);
    // Every tool used to write the loaded deck back whole, whose top-level
    // fields hold the dominant (Dutch) text; the seam then stored that text
    // (and the new slide order) as the German version.
    assert.equal(row.i18n.versions.de.title, 'Fahrplan', name);
    assert.deepEqual(
      titles(row.i18n.versions.de),
      ['Hallo', 'Zwei', 'Drei'],
      name,
    );
    assert.deepEqual(titles(row.i18n.versions.nl), writer.after, name);
    assert.equal(row.i18n.dominant, 'nl', name);
    assert.equal(row.i18n.active, 'de', name);
    assert.deepEqual(titles({ slides: row.slides }), writer.after, name);
  }
});

test('the answers describe the stored deck', async (t) => {
  await installDb();
  assert.deepEqual(
    await mcpTool('remove_slide')({ presentationId: DECK_ID, slideIndex: 1 }),
    {
      removed: true,
      slideIndex: 1,
      removedType: 'content-slide',
      removedTitle: 'Twee',
      totalSlides: 2,
    },
  );

  await installDb();
  assert.deepEqual(
    await mcpTool('reorder_slides')({
      presentationId: DECK_ID,
      fromIndex: 0,
      toIndex: 2,
    }),
    {
      moved: true,
      slide: { type: 'title-slide', title: 'Hoi' },
      from: 0,
      to: 2,
    },
  );

  await installDb();
  stubModel(t, APPEND_ANSWER);
  const appended = await mcpTool('append_slides')({
    presentationId: DECK_ID,
    content: 'Een vierde punt',
  });
  assert.deepEqual(appended, {
    appended: 1,
    insertedAt: 3,
    totalSlides: 4,
    newSlides: [{ type: 'content-slide', title: 'Vier' }],
  });

  await installDb();
  stubModel(t, COMPRESS_ANSWER);
  const compressed = await mcpTool('compress_presentation')({
    presentationId: DECK_ID,
    apply: true,
  });
  assert.equal(compressed.applied, true);
  assert.equal(compressed.removals, 1);
  assert.equal(compressed.slidesAfter, 2);

  await installDb();
  stubModel(t, ITERATE_ANSWER);
  const iterated = await mcpTool('iterate_presentation')({
    presentationId: DECK_ID,
    command: 'shorten everything',
  });
  assert.equal(iterated.applied, true);
  assert.equal(iterated.totalSlides, 3);
});

test('append_slides: a generated slide is composed by the factory (fresh id, canonical type) before it is stored', async (t) => {
  const db = await installDb();
  stubModel(t, APPEND_ANSWER);
  await mcpTool('append_slides')({
    presentationId: DECK_ID,
    content: 'Een vierde punt',
  });
  const added = storedDeck(db).slides[3];
  assert.equal(typeof added.id, 'string');
  assert.ok(added.id.length > 0);
  assert.ok(!['slide-1', 'slide-2', 'slide-3'].includes(added.id));
  assert.equal(added.type, 'content-slide');
});

test('compress_presentation without apply reads and writes nothing', async (t) => {
  const db = await installDb();
  stubModel(t, COMPRESS_ANSWER);
  const from = db.__queryLog.length;
  const answer = await mcpTool('compress_presentation')({
    presentationId: DECK_ID,
  });
  assert.equal(answer.applied, false);
  assert.equal(answer.slidesAfter, undefined);
  assert.equal(presentationUpdates(db, from), 0);
});

// =============================================================================
// Refusals: before the work, nothing written
// =============================================================================

test('every writer: an outsider is refused before the model call and nothing is written', async (t) => {
  for (const [name, writer] of Object.entries(WRITERS)) {
    const db = await installDb();
    const calls = stubModel(t, writer.answer);
    const before = structuredClone(storedDeck(db));

    await assert.rejects(
      mcpTool(
        name,
        OUTSIDER_EMAIL,
      )({ presentationId: DECK_ID, ...writer.args }),
      (err) => {
        assert.equal(err.statusCode, 403, `${name}: ${err.message}`);
        return true;
      },
    );
    assert.equal(calls.length, 0, `${name}: no model call`);
    assert.deepEqual(storedDeck(db), before, `${name}: nothing written`);
  }
});

test('every writer: a deck over the size limit is a 409 limit_exceeded and nothing is written (the refused write used to answer as stored)', async (t) => {
  // reorder and remove do not grow the deck; a limit below the current size
  // refuses them as it refuses an editor save of the same deck.
  for (const [name, writer] of Object.entries(WRITERS)) {
    const db = await installDb();
    stubModel(t, writer.answer);
    const before = structuredClone(storedDeck(db));

    await withSlideLimit(1, () =>
      assert.rejects(
        mcpTool(name)({ presentationId: DECK_ID, ...writer.args }),
        (err) => {
          assert.equal(err.statusCode, 409, `${name}: ${err.message}`);
          assert.equal(err.code, 'limit_exceeded', name);
          return true;
        },
      ),
    );
    assert.deepEqual(storedDeck(db), before, `${name}: nothing written`);
  }
});

test('remove_slide: an index out of range names the range; the last slide is not removed', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    mcpTool('remove_slide')({ presentationId: DECK_ID, slideIndex: 3 }),
    /Slide index 3 out of range \(0-2\)/,
  );
  await assert.rejects(
    mcpTool('remove_slide')({ presentationId: DECK_ID, slideIndex: 1.5 }),
    /Slide index 1\.5 out of range/,
  );
  assert.deepEqual(storedDeck(db), before);

  const remove = mcpTool('remove_slide');
  await remove({ presentationId: DECK_ID, slideIndex: 0 });
  await remove({ presentationId: DECK_ID, slideIndex: 0 });
  await assert.rejects(
    remove({ presentationId: DECK_ID, slideIndex: 0 }),
    /Cannot delete the last slide/,
  );
  assert.deepEqual(titles({ slides: storedDeck(db).slides }), ['Drie']);
});

test('reorder_slides: fromIndex and toIndex out of range are refused by name', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    mcpTool('reorder_slides')({
      presentationId: DECK_ID,
      fromIndex: 5,
      toIndex: 0,
    }),
    /fromIndex 5 out of range \(0-2\)/,
  );
  await assert.rejects(
    mcpTool('reorder_slides')({
      presentationId: DECK_ID,
      fromIndex: 0,
      toIndex: -1,
    }),
    /toIndex -1 out of range \(0-2\)/,
  );
  assert.deepEqual(storedDeck(db), before);
});

test('iterate_presentation: a plan that removes every slide is refused, not stored as an empty deck', async (t) => {
  const db = await installDb();
  stubModel(t, {
    summary: 'Alles weg',
    modifications: [0, 1, 2].map((slideIndex) => ({
      slideIndex,
      action: 'remove',
    })),
  });
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    mcpTool('iterate_presentation')({
      presentationId: DECK_ID,
      command: 'shorten everything',
    }),
    /Cannot leave a presentation without slides/,
  );
  assert.deepEqual(storedDeck(db), before);
});

test('iterate_presentation: a rewritten slide of an unknown type is refused, not stored', async (t) => {
  const db = await installDb();
  stubModel(t, {
    summary: 'Raar',
    modifications: [
      {
        slideIndex: 1,
        action: 'replace',
        slide: { type: 'no-such-slide', content: { title: 'X' } },
      },
    ],
  });
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    mcpTool('iterate_presentation')({
      presentationId: DECK_ID,
      command: 'shorten everything',
    }),
    /Unknown slide type: no-such-slide/,
  );
  assert.deepEqual(storedDeck(db), before);
});

// =============================================================================
// The service's own input rules
// =============================================================================

const { replaceSlides, reorderSlides } =
  await import('../server/services/slides.js');
const SCOPE = { repoRoot: process.cwd(), organizationId: ORG };
const OWNER = {
  actor: {
    id: userIdFor(OWNER_EMAIL),
    email: OWNER_EMAIL,
    organizationId: ORG,
  },
};

test('replaceSlides refuses a repeated id and a non-array; an unchanged stored slide passes as it is', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    replaceSlides(SCOPE, OWNER, {
      presentationId: DECK_ID,
      slides: [NL.slides[0], NL.slides[0]],
    }),
    /Duplicate slide id: slide-1/,
  );
  await assert.rejects(
    replaceSlides(SCOPE, OWNER, { presentationId: DECK_ID, slides: null }),
    /slides must be an array/,
  );
  assert.deepEqual(storedDeck(db), before);

  const { slides } = await replaceSlides(SCOPE, OWNER, {
    presentationId: DECK_ID,
    slides: [NL.slides[2], NL.slides[0]],
  });
  assert.deepEqual(slides, [NL.slides[2], NL.slides[0]]);
});

test('reorderSlides takes slideIds or move, not both', async () => {
  await installDb();
  await assert.rejects(
    reorderSlides(SCOPE, OWNER, {
      presentationId: DECK_ID,
      slideIds: ['slide-2'],
      move: { fromIndex: 0, toIndex: 1 },
    }),
    /Send slideIds or move, not both/,
  );
  await assert.rejects(
    reorderSlides(SCOPE, OWNER, { presentationId: DECK_ID }),
    /slideIds must be an array/,
  );
});

/** Run `fn` with the hard slide limit at `limit`. */
async function withSlideLimit(limit, fn) {
  const previous = process.env.PRESENTATION_HARD_SLIDE_LIMIT;
  process.env.PRESENTATION_HARD_SLIDE_LIMIT = String(limit);
  try {
    return await fn();
  } finally {
    if (previous === undefined)
      delete process.env.PRESENTATION_HARD_SLIDE_LIMIT;
    else process.env.PRESENTATION_HARD_SLIDE_LIMIT = previous;
  }
}

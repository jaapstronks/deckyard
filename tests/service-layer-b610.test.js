/**
 * B610: one deck translate on three writers.
 *
 * The editor's `POST /api/presentations/:id/translate` (and its
 * `/translate/missing`), the public `POST /api/v1/presentations/:id/translate`
 * and the translate queue worker each seeded the source version, resolved the
 * language pair, called the model and wrote the deck back on their own, and
 * differed where nobody looked: the editor and the worker guessed a missing
 * `to` and replaced an unknown `from` with the active language, the worker
 * skipped the size limit and threw bare `Error`s, only v1 wrote the
 * `i18n.translation` marker. Now all of them ask `translatePresentation`
 * (`server/services/translate.js`) and only parse and answer (A7.4,
 * D252–D256).
 *
 * The store: OWNER's Dutch deck with a complete German version, shared with
 * COLLAB at `edit`, and nobody else's. The model is the one way out, so the
 * provider's `fetch` is swapped for a double that answers one translation
 * (ids echoed, titles in the target), following tests/service-layer-b609.test.js.
 * Every refusal is asserted against the store and the model call count, not
 * read off the status code alone.
 *
 * Run with: node --test tests/service-layer-b610.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b610']
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
const COLLAB_EMAIL = 'collab@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';
const DECK_ID = 'd0000610-0000-4000-8000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handlePresentations: handleInternalPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleTranslation: handleV1Translation } =
  await import('../server/routes/public-api/v1/translate.js');
const { processTranslateJob } =
  await import('../server/jobs/queue/workers/translate-worker.js');

const actor = (email) => ({
  id: userIdFor(email),
  email,
  name: email.split('@')[0],
  role: 'user',
  organizationId: ORG,
});
const OWNER = actor(OWNER_EMAIL);
const COLLAB = actor(COLLAB_EMAIL);
const OUTSIDER = actor(OUTSIDER_EMAIL);

// --- The store ----------------------------------------------------------------

const slide = (id, title, type) => ({ id, type, content: { title } });

const NL = {
  title: 'Roadmap',
  slides: [
    slide('slide-1', 'Hoi', 'title-slide'),
    slide('slide-2', 'Twee', 'content-slide'),
  ],
};
const DE = {
  title: 'Fahrplan',
  slides: [
    slide('slide-1', 'Hallo', 'title-slide'),
    slide('slide-2', 'Zwei', 'content-slide'),
  ],
};

/**
 * @param {Object} [opts]
 * @param {string} [opts.active='nl'] - The stored active language.
 * @param {Object} [opts.de=DE] - The German version (`null` for none).
 */
async function installDb({ active = 'nl', de = DE } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, COLLAB_EMAIL, OUTSIDER_EMAIL),
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
          versions: {
            nl: structuredClone(NL),
            ...(de ? { de: structuredClone(de) } : {}),
          },
        },
        slides: structuredClone(NL.slides),
        published: null,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    presentation_collaborators: [
      {
        id: 'collab-1',
        presentation_id: DECK_ID,
        organization_id: ORG,
        user_email: COLLAB_EMAIL,
        user_id: null,
        permission: 'edit',
        invited_by: OWNER_EMAIL,
        invited_at: '2026-08-05T00:00:00.000Z',
        accepted_at: '2026-08-05T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-08-05T00:00:00.000Z',
      },
    ],
    activity_events: [],
    api_usage_daily: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const storedDeck = (db) =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);

/** The presentation writes since `from` in the query log, by kind. */
function presentationWrites(db, from = 0) {
  const writes = db.__queryLog
    .slice(from)
    .filter((q) => q.table === 'presentations' && q.op !== 'select');
  return {
    inserts: writes.filter((q) => q.op === 'insert').length,
    updates: writes.filter((q) => q.op === 'update').length,
  };
}

const titles = (version) => version.slides.map((s) => s.content.title);

// --- The model ----------------------------------------------------------------

/** One translation, whichever prompt asks: the deck's ids, French titles. */
const MODEL_ANSWER = JSON.stringify({
  title: 'Feuille de route',
  slides: [
    { id: 'slide-1', type: 'title-slide', content: { title: 'Bonjour' } },
    { id: 'slide-2', type: 'content-slide', content: { title: 'Deux' } },
  ],
});

/** Swap the provider's `fetch` for a double for one test; counts the calls. */
function stubModel(t) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts = {}) => {
    calls.push(opts);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: MODEL_ANSWER } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

// --- The three writers --------------------------------------------------------

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(String(payload)) : null;
    },
  };
}

function makeReq(body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = 'POST';
  req.headers = { host: 'deck.example', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '203.0.113.9' };
  return req;
}

/** The editor's translate (or `translate/missing`), as `as`. */
async function editorPost(as, body, path = 'translate') {
  const res = makeRes();
  await handleInternalPresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req: makeReq(body),
    res,
    url: new URL(`http://deck.example/api/presentations/${DECK_ID}/${path}`),
    authedUser: as,
  });
  return res;
}

/** A v1 translate with `as`'s AI-capable key already authenticated. */
async function v1Post(as, body) {
  const res = makeRes();
  await handleV1Translation({
    req: makeReq(body),
    res,
    url: new URL(
      `http://deck.example/api/v1/presentations/${DECK_ID}/translate`,
    ),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: as.id,
      actorEmail: as.email,
    },
    apiKey: {
      id: 'key-1',
      name: 'Test key',
      tier: 'free',
      ownerEmail: as.email,
      permissions: ['read', 'write', 'ai'],
      organizationId: ORG,
    },
    authedUser: as,
  });
  return res;
}

/** The queue worker's handler with a job double, as `as`. */
function workerJob(as, data) {
  return processTranslateJob({
    id: 'job-1',
    data: {
      presentationId: DECK_ID,
      organizationId: ORG,
      repoRoot: process.cwd(),
      actorEmail: as.email,
      ...data,
    },
    updateProgress: async () => {},
  });
}

/** v1 spells the pair its own way; the other two share the service's. */
const v1Body = ({ from, to, ...rest }) => ({
  ...(from !== undefined ? { sourceLang: from } : {}),
  ...(to !== undefined ? { targetLang: to } : {}),
  ...rest,
});
const V1_FIELD = { from: 'sourceLang', to: 'targetLang' };

/**
 * One translate per contract, answered as `{ status, field, result }`: the
 * HTTP status (worker: the thrown error's), the refused field if any, and
 * the contract's own success payload.
 */
const CONTRACTS = {
  editor: async (as, body) => {
    const res = await editorPost(as, body);
    return {
      status: res.statusCode,
      field: res.body?.details?.field ?? null,
      error: res.body?.error ?? null,
      result: res.body,
    };
  },
  v1: async (as, body) => {
    const res = await v1Post(as, v1Body(body));
    return {
      status: res.statusCode,
      field: res.body?.details?.field ?? null,
      error: res.body?.error ?? null,
      result: res.body,
    };
  },
  worker: async (as, body) => {
    try {
      const result = await workerJob(as, body);
      return { status: 200, field: null, error: null, result };
    } catch (err) {
      return {
        status: err.statusCode ?? 500,
        field: err.details?.field ?? null,
        error: err.code ?? null,
        result: null,
        message: err.message,
      };
    }
  },
};

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

// =============================================================================
// One translate: the same version, marker and trail on every contract
// =============================================================================

test('every contract: the owner translates nl → fr in one write; the version and the marker land, the other versions stay', async (t) => {
  for (const [name, translate] of Object.entries(CONTRACTS)) {
    const db = await installDb();
    const calls = stubModel(t);
    const from = db.__queryLog.length;

    const answer = await translate(OWNER, { from: 'nl', to: 'fr' });
    assert.equal(answer.status, 200, `${name}: ${JSON.stringify(answer)}`);
    assert.equal(calls.length, 1, `${name}: one model call`);
    assert.deepEqual(
      presentationWrites(db, from),
      { inserts: 0, updates: 1 },
      `${name}: one write`,
    );

    const row = storedDeck(db);
    assert.equal(row.i18n.versions.fr.title, 'Feuille de route', name);
    assert.deepEqual(titles(row.i18n.versions.fr), ['Bonjour', 'Deux'], name);
    assert.deepEqual(
      row.i18n.versions.fr.slides.map((s) => s.id),
      ['slide-1', 'slide-2'],
      `${name}: the ids are the deck's`,
    );
    assert.equal(row.i18n.translation.fr.status, 'done', `${name}: marker`);
    assert.equal(row.i18n.translation.fr.from, 'nl', `${name}: marker`);
    assert.deepEqual(titles(row.i18n.versions.nl), ['Hoi', 'Twee'], name);
    assert.deepEqual(titles(row.i18n.versions.de), ['Hallo', 'Zwei'], name);
    assert.equal(row.title, 'Roadmap', `${name}: top-level stays dominant`);
    assert.equal(row.revision, 2, name);
  }
});

test('the contracts answer in their own envelope', async (t) => {
  const db = await installDb();
  stubModel(t);

  const editor = await editorPost(OWNER, { from: 'nl', to: 'fr' });
  assert.equal(editor.statusCode, 200);
  assert.equal(editor.body.ok, true);
  assert.equal(editor.body.from, 'nl');
  assert.equal(editor.body.to, 'fr');
  assert.equal(
    editor.body.presentation.i18n.versions.fr.title,
    'Feuille de route',
  );

  const v1 = await v1Post(OWNER, { targetLang: 'es' });
  assert.equal(v1.statusCode, 200, JSON.stringify(v1.body));
  assert.equal(v1.body.translated, true);
  assert.equal(v1.body.from, 'nl', 'the active version is the source');
  assert.equal(v1.body.to, 'es');
  assert.deepEqual(Object.keys(v1.body.presentation).sort(), [
    'i18n',
    'id',
    'revision',
    'title',
  ]);
  assert.equal(v1.body.presentation.revision, storedDeck(db).revision);

  const job = await workerJob(OWNER, { from: 'nl', to: 'it' });
  assert.deepEqual(job, {
    from: 'nl',
    to: 'it',
    presentationId: DECK_ID,
    success: true,
    ownerEmail: OWNER_EMAIL,
  });
});

// =============================================================================
// Who may translate: the same answer on every contract
// =============================================================================

test('every contract: an edit collaborator translates; an outsider is refused with 403, no model call, nothing written', async (t) => {
  for (const [name, translate] of Object.entries(CONTRACTS)) {
    const db = await installDb();
    const calls = stubModel(t);

    const collab = await translate(COLLAB, { from: 'nl', to: 'fr' });
    assert.equal(collab.status, 200, `${name}: ${JSON.stringify(collab)}`);
    assert.equal(storedDeck(db).i18n.versions.fr.title, 'Feuille de route');

    const before = structuredClone(storedDeck(db));
    const from = db.__queryLog.length;
    const outsider = await translate(OUTSIDER, { from: 'nl', to: 'es' });
    assert.equal(outsider.status, 403, name);
    assert.equal(calls.length, 1, `${name}: the outsider cost no model call`);
    assert.deepEqual(presentationWrites(db, from), { inserts: 0, updates: 0 });
    assert.deepEqual(storedDeck(db), before, `${name}: nothing written`);
  }
});

// =============================================================================
// Refused before the model call, naming the field, on every contract
// =============================================================================

test('every contract: a bad pair or flag is 400 invalid naming the field, before any model call', async (t) => {
  const cases = [
    [
      { to: undefined },
      'to',
      'no target (the editor and the worker used to guess the other of nl/en-GB)',
    ],
    [{ to: 'zz' }, 'to', 'an unknown target'],
    [
      { from: 'zz', to: 'fr' },
      'from',
      'an unknown source (used to fall back to the active language)',
    ],
    [{ from: 'fr', to: 'de' }, 'from', 'a source the deck has no version of'],
    [{ from: 'nl', to: 'nl' }, 'to', 'source equal to target'],
    [
      { to: 'de', fillMissing: false },
      'to',
      'an existing target without overwrite',
    ],
    [{ to: 'fr', overwrite: 'yes' }, 'overwrite', 'a non-boolean flag'],
    [{ to: 'fr', fillMissing: 1 }, 'fillMissing', 'a non-boolean flag'],
  ];
  for (const [name, translate] of Object.entries(CONTRACTS)) {
    for (const [body, field, why] of cases) {
      const db = await installDb();
      const calls = stubModel(t);
      const before = structuredClone(storedDeck(db));

      const answer = await translate(OWNER, body);
      const expectedField = name === 'v1' ? (V1_FIELD[field] ?? field) : field;
      assert.equal(
        answer.status,
        400,
        `${name}: ${why}: ${JSON.stringify(answer)}`,
      );
      assert.equal(answer.error, 'invalid', `${name}: ${why}`);
      assert.equal(answer.field, expectedField, `${name}: ${why}`);
      assert.equal(calls.length, 0, `${name}: ${why}: the model was called`);
      assert.deepEqual(
        storedDeck(db),
        before,
        `${name}: ${why}: nothing written`,
      );
    }
  }
});

test('an absent source is the active version when the deck carries it, else the source version', async (t) => {
  // Active 'de' with a German version: a translate from "whatever is on screen".
  const db = await installDb({ active: 'de' });
  const calls = stubModel(t);
  const res = await editorPost(OWNER, { to: 'fr' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.from, 'de');
  assert.equal(calls.length, 1);
  assert.equal(storedDeck(db).i18n.translation.fr.from, 'de');

  // Active names a version the deck does not have: the dominant one.
  const db2 = await installDb({ active: 'de', de: null });
  const res2 = await editorPost(OWNER, { to: 'fr' });
  assert.equal(res2.statusCode, 200, JSON.stringify(res2.body));
  assert.equal(res2.body.from, 'nl');
  assert.equal(storedDeck(db2).i18n.translation.fr.from, 'nl');
});

// =============================================================================
// The write is consistent with the seam: no version is overwritten
// =============================================================================

test('translating from a non-dominant version keeps that version (the seam reads top-level as the active buffer)', async (t) => {
  const db = await installDb();
  stubModel(t);

  const res = await editorPost(OWNER, { from: 'de', to: 'fr' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const row = storedDeck(db);
  // Every writer used to set `active = from` and write the loaded deck back,
  // whose top-level fields hold the dominant (Dutch) text; the seam then
  // stored that text as the German version.
  assert.equal(row.i18n.versions.de.title, 'Fahrplan');
  assert.deepEqual(titles(row.i18n.versions.de), ['Hallo', 'Zwei']);
  assert.deepEqual(titles(row.i18n.versions.nl), ['Hoi', 'Twee']);
  assert.deepEqual(titles(row.i18n.versions.fr), ['Bonjour', 'Deux']);
  assert.equal(row.i18n.dominant, 'nl', 'the source version does not move');
  assert.equal(row.title, 'Roadmap');
  assert.deepEqual(titles({ slides: row.slides }), ['Hoi', 'Twee']);
});

// =============================================================================
// The size limit is a save's limit, on every contract
// =============================================================================

test('every contract: a translation over the size limit is 409 limit_exceeded and nothing is written (the worker used to skip the limit)', async (t) => {
  for (const [name, translate] of Object.entries(CONTRACTS)) {
    const db = await installDb();
    stubModel(t);
    const before = structuredClone(storedDeck(db));

    const answer = await withSlideLimit(1, () =>
      translate(OWNER, { from: 'nl', to: 'fr' }),
    );
    assert.equal(answer.status, 409, `${name}: ${JSON.stringify(answer)}`);
    assert.equal(answer.error, 'limit_exceeded', name);
    assert.deepEqual(storedDeck(db), before, `${name}: nothing written`);
  }
});

// =============================================================================
// translate/missing: the gaps only, with the running → done marker
// =============================================================================

const DE_WITH_GAP = {
  title: 'Fahrplan',
  slides: [
    slide('slide-1', 'Hallo', 'title-slide'),
    slide('slide-2', '', 'content-slide'),
  ],
};

test('translate/missing (wait): fills the gap only, marks running then done in two writes; nothing missing is no model call', async (t) => {
  const db = await installDb({ de: DE_WITH_GAP });
  const calls = stubModel(t);
  const from = db.__queryLog.length;

  const res = await editorPost(
    OWNER,
    { from: 'nl', to: 'de' },
    'translate/missing',
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.updated, true);
  assert.equal(res.body.started, false);
  assert.equal(res.body.missingCount, 1);
  assert.equal(calls.length, 1, 'one model call');
  assert.deepEqual(
    presentationWrites(db, from),
    { inserts: 0, updates: 2 },
    'the running marker, then the result',
  );

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.de.slides[0].content.title, 'Hallo', 'kept');
  assert.equal(row.i18n.versions.de.slides[1].content.title, 'Deux', 'filled');
  assert.equal(row.i18n.translation.de.status, 'done');
  assert.equal(row.i18n.translation.de.missingCount, 0);
  assert.equal(res.body.presentation.i18n.translation.de.status, 'done');

  // Nothing left to fill: answered without the model and without a write.
  const again = await editorPost(
    OWNER,
    { from: 'nl', to: 'de' },
    'translate/missing',
  );
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body, {
    ok: true,
    from: 'nl',
    to: 'de',
    updated: false,
    missingCount: 0,
  });
  assert.equal(calls.length, 1, 'no second model call');
});

test('translate/missing (background): answers with the count and the fill lands after the response', async (t) => {
  const db = await installDb({ de: DE_WITH_GAP });
  const calls = stubModel(t);

  const res = await editorPost(
    OWNER,
    { from: 'nl', to: 'de', mode: 'background' },
    'translate/missing',
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    ok: true,
    from: 'nl',
    to: 'de',
    updated: true,
    started: true,
    missingCount: 1,
  });

  const deadline = Date.now() + 2000;
  while (storedDeck(db).i18n?.translation?.de?.status !== 'done') {
    assert.ok(Date.now() < deadline, 'the background fill never landed');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(calls.length, 1);
  assert.equal(storedDeck(db).i18n.versions.de.slides[1].content.title, 'Deux');
});

test('translate/missing: an outsider is refused with 403 before any work, a missing target is 400 invalid naming `to`', async (t) => {
  const db = await installDb({ de: DE_WITH_GAP });
  const calls = stubModel(t);
  const before = structuredClone(storedDeck(db));

  const outsider = await editorPost(
    OUTSIDER,
    { from: 'nl', to: 'de' },
    'translate/missing',
  );
  assert.equal(outsider.statusCode, 403);

  const noTarget = await editorPost(
    OWNER,
    { from: 'nl', mode: 'background' },
    'translate/missing',
  );
  assert.equal(noTarget.statusCode, 400);
  assert.equal(noTarget.body.error, 'invalid');
  assert.equal(noTarget.body.details.field, 'to');

  assert.equal(calls.length, 0);
  assert.deepEqual(storedDeck(db), before);
});

// =============================================================================
// The worker acts as someone
// =============================================================================

test('worker: a job without an actorEmail is refused, not run as the operator', async (t) => {
  const db = await installDb();
  const calls = stubModel(t);
  const before = structuredClone(storedDeck(db));
  await assert.rejects(
    () =>
      processTranslateJob({
        id: 'job-2',
        data: {
          presentationId: DECK_ID,
          organizationId: ORG,
          from: 'nl',
          to: 'fr',
        },
        updateProgress: async () => {},
      }),
    /actorEmail/,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(storedDeck(db), before);
});

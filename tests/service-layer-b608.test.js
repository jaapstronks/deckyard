/**
 * B608: one deck save on two contracts. The public `PUT /api/v1/presentations/:id`
 * and the editor's `PUT /api/presentations/:id` each loaded and decided on
 * their own: v1 dropped `ownerEmail`/`createdBy` without a word, answered a
 * storage refusal (`{ ok:false }`) with a 200, loaded the deck twice on a
 * theme switch and left no activity row; the editor's route alone carried the
 * merge options and the trail. Now both ask `savePresentation`
 * (`server/services/save-presentation.js`) and only parse and answer
 * (A7.4, D252–D256).
 *
 * The store: OWNER's deck, shared with COLLAB at `edit`, and nobody else's.
 * Every refusal is asserted against the store, not read off the status code:
 * a refused save leaves the deck as it was.
 *
 * Handler-import level against the database double, like
 * tests/service-layer-b575.test.js and tests/service-layer-b607.test.js.
 *
 * Run with: node --test tests/service-layer-b608.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b608']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.APP_URL = 'https://deck.example';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const COLLAB_EMAIL = 'collab@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';
const DECK_ID = 'd0000608-0000-4000-8000-000000000001';
const MIDNIGHT = '11111111-1111-4111-8111-111111111111';
const AMETHYST = '22222222-2222-4222-8222-222222222222';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handlePresentations: handleInternalPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');

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

const slide = (id, title, type = 'content-slide') => ({
  id,
  type,
  content: { title },
  parentId: null,
});

const themeRow = (id, slug) => ({
  id,
  organization_id: null,
  slug,
  label: slug,
  colors: {},
  fonts: {},
  config: {},
});

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, COLLAB_EMAIL, OUTSIDER_EMAIL),
    themes: [themeRow(MIDNIGHT, 'midnight'), themeRow(AMETHYST, 'amethyst')],
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
        title: 'Roadmap',
        description: null,
        theme: MIDNIGHT,
        lang: 'nl',
        visibility: 'private',
        is_view_only: false,
        revision: 1,
        settings: {},
        i18n: null,
        slides: [
          slide('slide-1', 'Hoi', 'title-slide'),
          slide('slide-2', 'Twee'),
        ],
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
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const storedDeck = (db) =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);

/** Assert a refused save left the deck exactly as it was. */
function assertUnchanged(db, before, why) {
  const after = storedDeck(db);
  assert.equal(after.revision, before.revision, `${why} (nothing was written)`);
  assert.equal(after.title, before.title, `${why} (title)`);
  assert.equal(after.theme, before.theme, `${why} (theme)`);
  assert.equal(after.lang, before.lang, `${why} (lang)`);
}

/** The activity rows of one type, once the fire-and-forget writes landed. */
async function activity(db, eventType) {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return (db.__tables.activity_events || []).filter(
    (row) => row.event_type === eventType,
  );
}

// --- The two contracts --------------------------------------------------------

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

function makeReq(method, body, headers = {}) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = {
    host: 'deck.example',
    'content-type': 'application/json',
    ...headers,
  };
  req.socket = { remoteAddress: '203.0.113.9' };
  return req;
}

/** The editor's PUT, as `as`, with If-Match `revision` and extra headers. */
async function editorSave(as, body, { revision = 1, headers = {} } = {}) {
  const res = makeRes();
  await handleInternalPresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req: makeReq('PUT', body, { 'if-match': String(revision), ...headers }),
    res,
    url: new URL(`http://deck.example/api/presentations/${DECK_ID}`),
    authedUser: as,
  });
  return res;
}

/** The editor's GET, as `as`. */
async function editorRead(as) {
  const res = makeRes();
  await handleInternalPresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req: makeReq('GET'),
    res,
    url: new URL(`http://deck.example/api/presentations/${DECK_ID}`),
    authedUser: as,
  });
  return res;
}

/** A v1 PUT with `as`'s key already authenticated. */
async function v1Save(as, body) {
  const res = makeRes();
  await handleV1Presentations({
    req: makeReq('PUT', body),
    res,
    url: new URL(`http://deck.example/api/v1/presentations/${DECK_ID}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: as.id,
      actorEmail: as.email,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: as.email,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: as,
  });
  return res;
}

// =============================================================================
// Who may save: the same answer on both contracts
// =============================================================================

test('v1 and editor: the owner and an edit collaborator save, an outsider is refused', async () => {
  for (const contract of ['v1', 'editor']) {
    const db = await installDb();
    const put = (as, body) =>
      contract === 'v1'
        ? v1Save(as, body)
        : editorSave(as, body, { revision: storedDeck(db).revision });

    const owner = await put(OWNER, { title: `Owner via ${contract}` });
    assert.equal(owner.statusCode, 200, contract);
    assert.equal(storedDeck(db).title, `Owner via ${contract}`);

    const collab = await put(COLLAB, { title: `Collab via ${contract}` });
    assert.equal(collab.statusCode, 200, contract);
    assert.equal(storedDeck(db).title, `Collab via ${contract}`);

    const before = structuredClone(storedDeck(db));
    const outsider = await put(OUTSIDER, { title: 'Outsider' });
    assert.equal(outsider.statusCode, 403, contract);
    assertUnchanged(db, before, `${contract}: an outsider may not save`);
  }
});

// =============================================================================
// What a save may not carry: refused with the field, on both contracts
// =============================================================================

test('refusals: another lang, owner or creator and a retired name are 400 invalid naming the field', async () => {
  const cases = [
    [{ lang: 'en' }, 'lang'],
    [{ ownerEmail: COLLAB_EMAIL }, 'ownerEmail'],
    [{ createdBy: { id: userIdFor(COLLAB_EMAIL) } }, 'createdBy'],
    [{ createdBy: COLLAB_EMAIL }, 'createdBy'],
    [{ themeId: AMETHYST }, 'themeId'],
    [{ language: 'en' }, 'language'],
  ];
  for (const [refused, field] of cases) {
    const db = await installDb();
    const before = structuredClone(storedDeck(db));

    const v1 = await v1Save(OWNER, { title: 'Changed', ...refused });
    assert.equal(v1.statusCode, 400, `v1 ${field}`);
    assert.equal(v1.body.error, 'invalid', `v1 ${field}`);
    assert.equal(v1.body.details.field, field, `v1 ${field}`);
    assertUnchanged(db, before, `v1 refuses ${field}`);

    // The editor never moves its owner (stale after a transfer), so it does
    // not send one on; everything else is refused the same way.
    if (field === 'ownerEmail') continue;
    const editor = await editorSave(OWNER, { title: 'Changed', ...refused });
    assert.equal(editor.statusCode, 400, `editor ${field}`);
    assert.equal(editor.body.error, 'invalid', `editor ${field}`);
    assert.equal(editor.body.details.field, field, `editor ${field}`);
    assertUnchanged(db, before, `editor refuses ${field}`);
  }
});

test('echoes: the deck own owner, creator and lang sent back from a read are a plain save', async () => {
  const db = await installDb();
  const read = (await editorRead(COLLAB)).body;

  // v1 hands the owner its own address and everyone else `null`.
  for (const ownerEmail of [OWNER_EMAIL, OWNER_EMAIL.toUpperCase(), null]) {
    const res = await v1Save(OWNER, {
      title: `Echo ${ownerEmail}`,
      ownerEmail,
      lang: 'nl',
    });
    assert.equal(res.statusCode, 200, String(ownerEmail));
    assert.equal(storedDeck(db).owner_email, OWNER_EMAIL);
  }

  // The editor sends back the whole deck it read, display pair included.
  const editor = await editorSave(
    COLLAB,
    { ...read, title: 'Whole deck echoed' },
    { revision: storedDeck(db).revision },
  );
  assert.equal(editor.statusCode, 200);
  assert.equal(storedDeck(db).title, 'Whole deck echoed');
  assert.equal(storedDeck(db).owner_email, OWNER_EMAIL);
  assert.equal(storedDeck(db).created_by, OWNER_EMAIL);
});

test('editor: a stale owner in the body is not a claim (a transfer may have moved it)', async () => {
  const db = await installDb();
  const res = await editorSave(OWNER, {
    title: 'After a transfer elsewhere',
    ownerEmail: COLLAB_EMAIL,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(storedDeck(db).owner_email, OWNER_EMAIL);
});

// =============================================================================
// A storage refusal is a refusal, not a 200
// =============================================================================

test('v1 and editor: a deck over the size limit is 409 limit_exceeded and nothing is written', async () => {
  const previous = process.env.PRESENTATION_HARD_SLIDE_LIMIT;
  process.env.PRESENTATION_HARD_SLIDE_LIMIT = '2';
  try {
    const db = await installDb();
    const before = structuredClone(storedDeck(db));
    const slides = [
      slide('slide-1', 'Hoi', 'title-slide'),
      slide('slide-2', 'Twee'),
      slide('slide-3', 'Drie'),
    ];

    // v1 used to answer this with a 200 and `{ ok:false }` for a presentation.
    const v1 = await v1Save(OWNER, { slides });
    assert.equal(v1.statusCode, 409);
    assert.equal(v1.body.error, 'limit_exceeded');
    assert.match(v1.body.message, /slide/i);
    assertUnchanged(db, before, 'v1 over the limit');

    const editor = await editorSave(OWNER, { slides });
    assert.equal(editor.statusCode, 409);
    assert.equal(editor.body.error, 'limit_exceeded');
    assertUnchanged(db, before, 'editor over the limit');
  } finally {
    if (previous === undefined)
      delete process.env.PRESENTATION_HARD_SLIDE_LIMIT;
    else process.env.PRESENTATION_HARD_SLIDE_LIMIT = previous;
  }
});

// =============================================================================
// The editor's merge options reach the store
// =============================================================================

test('editor: the merge headers reach the store (a stale tab merges a disjoint edit)', async () => {
  const db = await installDb();
  // Someone else saved slide 1 since this tab read revision 1.
  const elsewhere = await editorSave(COLLAB, {
    slides: [
      slide('slide-1', 'Hoi van elders', 'title-slide'),
      slide('slide-2', 'Twee'),
    ],
  });
  assert.equal(elsewhere.statusCode, 200);
  assert.equal(storedDeck(db).revision, 2);

  const staleBody = {
    slides: [
      slide('slide-1', 'Hoi', 'title-slide'),
      slide('slide-2', 'Twee bewerkt'),
    ],
  };

  // Without the headers a stale tab is a plain revision conflict.
  const plain = await editorSave(OWNER, staleBody, { revision: 1 });
  assert.equal(plain.statusCode, 409);
  assert.equal(plain.body.error, 'conflict');

  // With them the store merges: slide 2 is this tab's, slide 1 stays the
  // other editor's.
  const merged = await editorSave(OWNER, staleBody, {
    revision: 1,
    headers: {
      'x-modified-slides': JSON.stringify(['slide-2']),
      'x-slides-order-changed': '0',
    },
  });
  assert.equal(merged.statusCode, 200);
  const titles = storedDeck(db).slides.map((s) => s.content.title);
  assert.deepEqual(titles, ['Hoi van elders', 'Twee bewerkt']);
});

// =============================================================================
// The trail: the same rows whoever saved
// =============================================================================

test('v1 and editor: adding a slide leaves a slide.added row on both contracts', async () => {
  for (const [contract, put] of [
    ['v1', (body) => v1Save(OWNER, body)],
    ['editor', (body) => editorSave(OWNER, body)],
  ]) {
    const db = await installDb();
    const res = await put({
      slides: [
        slide('slide-1', 'Hoi', 'title-slide'),
        slide('slide-2', 'Twee'),
        slide(`slide-new-${contract}`, 'Nieuw'),
      ],
    });
    assert.equal(res.statusCode, 200, contract);
    const rows = await activity(db, 'slide.added');
    assert.equal(rows.length, 1, `${contract} leaves the row`);
    const data =
      typeof rows[0].data === 'string'
        ? JSON.parse(rows[0].data)
        : rows[0].data;
    assert.deepEqual(data.slideIds, [`slide-new-${contract}`]);
  }
});

// =============================================================================
// A theme switch loads the deck once
// =============================================================================

test('v1: a theme switch reads the deck no more often than a plain save', async () => {
  const reads = (db) =>
    db.__queryLog.filter(
      (q) => q.op === 'select' && q.table === 'presentations',
    ).length;

  const plainDb = await installDb();
  const plain = await v1Save(OWNER, { title: 'Plain' });
  assert.equal(plain.statusCode, 200);
  const plainReads = reads(plainDb);

  const db = await installDb();
  const res = await v1Save(OWNER, { theme: AMETHYST, title: 'Switched' });
  assert.equal(res.statusCode, 200);
  assert.equal(storedDeck(db).theme, AMETHYST);
  assert.equal(storedDeck(db).title, 'Switched');
  assert.equal(storedDeck(db).revision, 2, 'one write');
  // It used to load once for the lang/theme comparison and again in
  // changeTheme (D316 (3)).
  assert.equal(reads(db), plainReads);
});

/**
 * One deck save on two contracts (B608). The public
 * `PUT /api/v1/presentations/:id` and the editor's `PUT /api/presentations/:id`
 * each loaded and decided on their own: v1 dropped `ownerEmail`/`createdBy`
 * without a word, answered a storage refusal (`{ ok:false }`) with a 200,
 * loaded the deck twice on a theme switch and left no activity row; the
 * editor's route alone carried the merge options and the trail. Now both ask
 * `savePresentation` (`server/services/save-presentation.js`) and only parse
 * and answer (A7.4, D252–D256).
 *
 * The store: OWNER's deck, shared with COLLAB at `edit`, and nobody else's.
 * Every refusal is asserted against the store, not read off the status code:
 * a refused save leaves the deck as it was.
 *
 * Handler-import level against the database double, like
 * tests/service-layer-deck-operations.test.js and tests/service-layer-presentation-list.test.js.
 *
 * Run with: node --test tests/service-layer-presentation-save.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { createSaveManager } from '../client/views/editor/save-manager.js';
import { normalizeLang } from '../shared/i18n-utils.js';
import { validateSlideFields } from '../shared/slide-types/presentation.js';

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
const { initializeStorage } = await import('../server/db/lifecycle.js');
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
  content: { title, ...(type === 'content-slide' ? { body: 'Body' } : {}) },
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
  const res = createMockRes();
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
  const res = createMockRes();
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
  const res = createMockRes();
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
    assert.equal(v1.json().error, 'invalid', `v1 ${field}`);
    assert.equal(v1.json().details.field, field, `v1 ${field}`);
    assertUnchanged(db, before, `v1 refuses ${field}`);

    // The editor never moves its owner (stale after a transfer), so it does
    // not send one on; everything else is refused the same way.
    if (field === 'ownerEmail') continue;
    const editor = await editorSave(OWNER, { title: 'Changed', ...refused });
    assert.equal(editor.statusCode, 400, `editor ${field}`);
    assert.equal(editor.json().error, 'invalid', `editor ${field}`);
    assert.equal(editor.json().details.field, field, `editor ${field}`);
    assertUnchanged(db, before, `editor refuses ${field}`);
  }
});

test('echoes: the deck own owner, creator and lang sent back from a read are a plain save', async () => {
  const db = await installDb();
  const read = (await editorRead(COLLAB)).json();

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
    assert.equal(v1.json().error, 'limit_exceeded');
    assert.match(v1.json().message, /slide/i);
    assertUnchanged(db, before, 'v1 over the limit');

    const editor = await editorSave(OWNER, { slides });
    assert.equal(editor.statusCode, 409);
    assert.equal(editor.json().error, 'limit_exceeded');
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
  assert.equal(plain.json().error, 'conflict');

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

// B315: the same declared field vocabulary on editor, v1 and MCP writes.
const { handleSlides: handleV1Slides } =
  await import('../server/routes/public-api/v1/slides.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

async function writeContact(contract, content, db) {
  if (contract === 'editor') {
    return editorSave(
      OWNER,
      {
        slides: [{ id: 'slide-1', type: 'end-slide', content }],
      },
      { revision: storedDeck(db).revision },
    );
  }
  if (contract === 'v1') {
    const res = createMockRes();
    await handleV1Slides({
      req: makeReq('PUT', { type: 'end-slide', content }),
      res,
      url: new URL(
        `http://deck.example/api/v1/presentations/${DECK_ID}/slides/slide-1`,
      ),
      repoRoot: process.cwd(),
      storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
      storageContext: {
        organizationId: ORG,
        actorUserId: OWNER.id,
        actorEmail: OWNER.email,
      },
      apiKey: {
        id: 'key-1',
        tier: 'free',
        ownerEmail: OWNER.email,
        permissions: ['read', 'write'],
        organizationId: ORG,
      },
      authedUser: OWNER,
    });
    return res;
  }
  const server = new McpServer({ name: 'test', version: '1' });
  registerTools(server, { repoRoot: process.cwd() });
  await server.tools.get('update_slide').handler(
    {
      presentationId: DECK_ID,
      slideIndex: 0,
      type: 'end-slide',
      content,
    },
    { ownerEmail: OWNER.email, organizationId: ORG },
  );
  return null;
}

for (const contract of ['editor', 'v1', 'mcp']) {
  for (const contactUrl of [
    'javascript:alert(1)',
    'data:text/html,test',
    'example.com',
  ]) {
    test(`${contract}: refuses declared URL ${contactUrl} without writing`, async () => {
      const db = await installDb();
      // Keep the same type so this tests values, not unsupported conversion.
      storedDeck(db).slides[0] = {
        id: 'slide-1',
        type: 'end-slide',
        content: { title: 'Contact' },
      };
      const before = structuredClone(storedDeck(db));
      let details;
      if (contract === 'mcp') {
        await assert.rejects(
          writeContact(contract, { title: 'Contact', contactUrl }, db),
          (err) => {
            assert.equal(err.statusCode, 400);
            details = err.details;
            return true;
          },
        );
      } else {
        const res = await writeContact(
          contract,
          { title: 'Contact', contactUrl },
          db,
        );
        assert.equal(res.statusCode, 400, JSON.stringify(res.json()));
        details = res.json().details;
      }
      assert.equal(details.field, 'contactUrl');
      assert.equal(details.slideId, 'slide-1');
      assert.ok(details.errors.length);
      assertUnchanged(db, before, contract);
      assert.deepEqual(storedDeck(db).slides, before.slides);
    });
  }
  for (const contactUrl of [
    'https://example.com',
    'mailto:hello@example.com',
    '/contact',
    '#2',
    '#slide:slide-2',
    '',
  ]) {
    test(`${contract}: accepts declared URL ${JSON.stringify(contactUrl)}`, async () => {
      const db = await installDb();
      storedDeck(db).slides[0] = {
        id: 'slide-1',
        type: 'end-slide',
        content: { title: 'Contact' },
      };
      const res = await writeContact(
        contract,
        { title: 'Contact', contactUrl },
        db,
      );
      if (res) assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
      assert.equal(storedDeck(db).slides[0].content.contactUrl, contactUrl);
    });
  }
}

test('editor: legacy invalid slide loads, survives metadata/other-slide saves, refuses its own edit, and can be fixed', async () => {
  const db = await installDb();
  storedDeck(db).slides[0] = {
    id: 'slide-1',
    type: 'end-slide',
    content: { title: 'Contact', contactUrl: 'example.com' },
  };
  const read = await editorRead(OWNER);
  assert.equal(read.statusCode, 200);
  const loaded = read.json();
  assert.equal(loaded.slides[0].content.contactUrl, 'example.com');
  const put = (body) =>
    editorSave(OWNER, body, { revision: storedDeck(db).revision });
  assert.equal((await put({ title: 'Metadata only' })).statusCode, 200);
  loaded.slides[1].content.title = 'Other slide edited';
  assert.equal((await put({ slides: loaded.slides })).statusCode, 200);
  assert.equal(storedDeck(db).slides[0].content.contactUrl, 'example.com');
  loaded.slides[0].notes = 'Changed the legacy slide';
  assert.equal((await put({ slides: loaded.slides })).statusCode, 400);
  loaded.slides[0].content.contactUrl = 'https://example.com';
  assert.equal((await put({ slides: loaded.slides })).statusCode, 200);
});

test('editor: translated legacy values are compared with their own language, and changed off-screen buffers are checked', async () => {
  const db = await installDb();
  const nl = [
    {
      id: 'slide-1',
      type: 'end-slide',
      content: { title: 'Contact', contactUrl: 'https://example.com' },
    },
  ];
  const de = [
    {
      id: 'slide-1',
      type: 'end-slide',
      content: { title: 'Kontakt', contactUrl: 'example.de' },
    },
  ];
  storedDeck(db).slides = nl;
  storedDeck(db).i18n = {
    dominant: 'nl',
    active: 'de',
    versions: {
      nl: { title: 'NL', slides: nl },
      de: { title: 'DE', slides: de },
    },
  };
  const put = (body) =>
    editorSave(OWNER, body, { revision: storedDeck(db).revision });
  const read = (await editorRead(OWNER)).json();
  const body = { slides: structuredClone(de), i18n: read.i18n };
  assert.equal(
    (await put(body)).statusCode,
    200,
    'unchanged German invalid value survives',
  );
  body.slides[0].notes = 'changed';
  const invalid = await put(body);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().details.lang, 'de');
  body.slides[0].content.contactUrl = 'https://example.de';
  assert.equal((await put(body)).statusCode, 200);
  body.i18n.versions.nl.slides[0].content.contactUrl = 'javascript:alert(1)';
  const hiddenInvalid = await put(body);
  assert.equal(hiddenInvalid.statusCode, 400);
  assert.equal(hiddenInvalid.json().details.lang, 'nl');
});

test('editor save-manager persists empty translation prose when adding a language and a slide, but refuses an unsafe off-screen URL', async () => {
  const db = await installDb();
  storedDeck(db).slides = [
    {
      id: 'contact-1',
      type: 'end-slide',
      content: { title: 'Contact', contactUrl: 'https://example.com' },
    },
  ];
  const pres = (await editorRead(OWNER)).json();
  pres.i18n = {
    active: 'nl',
    dominant: 'nl',
    versions: { nl: { title: pres.title, slides: pres.slides } },
  };
  const failures = [];
  let lastPayload;
  const mgr = createSaveManager({
    api: async (_path, opts) => {
      lastPayload = structuredClone(opts.body);
      const response = await editorSave(OWNER, opts.body, {
        revision: Number(opts.headers['If-Match']),
      });
      if (response.statusCode !== 200) {
        const error = Object.assign(
          new Error(response.json().message),
          response.json(),
        );
        failures.push(error);
        throw error;
      }
      return response.json();
    },
    toast: { info() {}, success() {}, error() {} },
    pres,
    id: pres.id,
    SLIDE_TYPES: {
      'end-slide': {
        fields: [
          { key: 'title', type: 'string', required: true },
          { key: 'contactUrl', type: 'url' },
        ],
      },
    },
    normalizeLang,
    getSelectedSlideId: () => 'contact-1',
  });

  pres.i18n.versions['en-GB'] = { title: pres.title, slides: [] };
  mgr.markDirty({ slideId: 'contact-1' });
  await mgr.requestSave();
  assert.equal(failures.length, 0);
  assert.equal(pres.i18n.versions['en-GB'].slides[0].content.title ?? '', '');
  assert.equal(
    storedDeck(db).i18n.versions['en-GB'].slides[0].content.title ?? '',
    '',
  );

  pres.slides.push({
    id: 'contact-2',
    type: 'end-slide',
    content: { title: 'New contact', contactUrl: 'https://deck.example' },
  });
  mgr.markDirty({ slideId: 'contact-2' });
  await mgr.requestSave();
  assert.equal(failures.length, 0);
  assert.equal(pres.i18n.versions['en-GB'].slides[1].content.title ?? '', '');
  assert.equal(storedDeck(db).i18n.versions['en-GB'].slides.length, 2);

  const unsafe = structuredClone(lastPayload);
  unsafe.i18n.versions['en-GB'].slides[1].content.contactUrl =
    'javascript:alert(1)';
  const rejected = await editorSave(OWNER, unsafe, {
    revision: storedDeck(db).revision,
  });
  mgr.cancelAutosave();
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().details.field, 'contactUrl');
  assert.equal(rejected.json().details.lang, 'en-GB');
  assert.equal(
    storedDeck(db).i18n.versions['en-GB'].slides[1].content.contactUrl,
    'https://deck.example',
  );
});

test('translation field validation permits nested prose gaps while keeping structural and URL checks', () => {
  const slideTypes = {
    custom: {
      fields: [
        {
          key: 'rows',
          type: 'items',
          required: true,
          itemFields: [
            { key: 'title', type: 'string', required: true },
            { key: 'link', type: 'url', required: true },
          ],
        },
      ],
    },
  };
  const slide = {
    id: 'nested',
    type: 'custom',
    content: { rows: [{ title: '', link: 'https://example.com' }] },
  };
  assert.equal(validateSlideFields(slide, { slideTypes })[0].field, 'rows');
  assert.deepEqual(
    validateSlideFields(slide, {
      slideTypes,
      allowMissingTranslationText: true,
    }),
    [],
  );
  slide.content.rows[0].link = 'javascript:alert(1)';
  assert.equal(
    validateSlideFields(slide, {
      slideTypes,
      allowMissingTranslationText: true,
    })[0].field,
    'rows',
  );
  slide.content.rows = [];
  assert.equal(
    validateSlideFields(slide, {
      slideTypes,
      allowMissingTranslationText: true,
    })[0].field,
    'rows',
  );
});

test('editor: collection URL values use the declared validator too', async () => {
  const db = await installDb();
  const res = await editorSave(OWNER, {
    slides: [
      {
        id: 'slide-1',
        type: 'content-slide',
        content: {
          title: 'Actions',
          body: 'Body',
          actions: [{ label: 'Bad', url: 'javascript:alert(1)' }],
        },
      },
    ],
  });
  assert.equal(res.statusCode, 400, JSON.stringify(res.json()));
  assert.equal(res.json().details.field, 'actions');
  assert.equal(storedDeck(db).revision, 1);
});

// B693: a new deck meets the same declared field rules. A create carrying
// slides and a JSON import refuse what the editor's save refuses, naming the
// slide and the field, before any deck exists.

/** An internal POST (create or import), as OWNER. */
async function editorPost(path, body) {
  const res = createMockRes();
  await handleInternalPresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
    req: makeReq('POST', body),
    res,
    url: new URL(`http://deck.example${path}`),
    authedUser: OWNER,
  });
  return res;
}

/** A v1 create with OWNER's key already authenticated. */
async function v1Create(body) {
  const res = createMockRes();
  await handleV1Presentations({
    req: makeReq('POST', body),
    res,
    url: new URL('http://deck.example/api/v1/presentations'),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: OWNER.id,
      actorEmail: OWNER.email,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER.email,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: OWNER,
  });
  return res;
}

const NEW_DECK_CONTRACTS = {
  create: (slides) =>
    editorPost('/api/presentations', { title: 'Nieuw', lang: 'nl', slides }),
  'v1 create': (slides) => v1Create({ title: 'Nieuw', lang: 'nl', slides }),
  'json import': (slides) =>
    editorPost('/api/presentations/import/json', {
      deck: { title: 'Nieuw', lang: 'nl', theme: MIDNIGHT, slides },
    }),
};

test('create, v1 create and JSON import refuse the field the editor save refuses, writing nothing', async () => {
  const content = { title: 'Contact', contactUrl: 'javascript:alert(1)' };
  const db = await installDb();
  const editor = await writeContact('editor', content, db);
  assert.equal(editor.statusCode, 400, JSON.stringify(editor.json()));
  const refusal = editor.json();

  for (const [name, send] of Object.entries(NEW_DECK_CONTRACTS)) {
    const fresh = await installDb();
    const decks = fresh.__tables.presentations.length;
    const res = await send([
      { type: 'title-slide', content: { title: 'Hoi' } },
      { type: 'end-slide', content },
    ]);
    assert.equal(res.statusCode, 400, `${name}: ${JSON.stringify(res.json())}`);
    const body = res.json();
    assert.equal(body.error, refusal.error, name);
    assert.equal(body.message, refusal.message, name);
    assert.equal(body.details.field, 'contactUrl', name);
    assert.deepEqual(body.details.errors, refusal.details.errors, name);
    assert.equal(body.details.index, 1, `${name} names the slide`);
    assert.equal(body.details.lang, 'nl', name);
    assert.equal(fresh.__tables.presentations.length, decks, `${name} wrote`);
  }
});

test('create, v1 create and JSON import accept a valid deck', async () => {
  for (const [name, send] of Object.entries(NEW_DECK_CONTRACTS)) {
    await installDb();
    const res = await send([
      { type: 'title-slide', content: { title: 'Hoi' } },
      {
        type: 'end-slide',
        content: { title: 'Contact', contactUrl: 'https://example.com' },
      },
    ]);
    assert.equal(res.statusCode, 201, `${name}: ${JSON.stringify(res.json())}`);
  }
});

test('a new deck may leave translation prose empty, never its source language', async () => {
  await installDb();
  const created = await editorPost('/api/presentations', {
    title: 'Nieuw',
    lang: 'nl',
    slides: [
      {
        type: 'title-slide',
        content: { title: 'Hoi' },
        contentByLang: { nl: { title: 'Hoi' }, 'en-GB': { title: '' } },
      },
    ],
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.json()));

  const imported = await editorPost('/api/presentations/import/json', {
    deck: {
      title: 'Nieuw',
      lang: 'nl',
      theme: MIDNIGHT,
      translations: { 'en-GB': { title: 'New' } },
      slides: [
        {
          type: 'title-slide',
          content: { title: 'Hoi' },
          translations: { 'en-GB': { notes: 'Untranslated title.' } },
        },
      ],
    },
  });
  assert.equal(imported.statusCode, 201, JSON.stringify(imported.json()));

  const source = await editorPost('/api/presentations', {
    title: 'Nieuw',
    lang: 'nl',
    slides: [
      {
        type: 'title-slide',
        content: { title: 'Hello' },
        contentByLang: { nl: { title: '' }, 'en-GB': { title: 'Hello' } },
      },
    ],
  });
  assert.equal(source.statusCode, 400, JSON.stringify(source.json()));
  assert.equal(source.json().details.field, 'title');
  assert.equal(source.json().details.lang, 'nl');
});

test('v1 and editor: a save never moves the publication column, so an echoed copy without the preview proof keeps it', async () => {
  // The editor rebuilds `pres.published` from the publish and regenerate
  // answers, which carry no `previewFingerprint`; an autosave echoing that copy
  // must not erase the proof the public preview is served on (B769.4).
  const proof = {
    id: 'abcd1234',
    slug: 'roadmap',
    ogImageUrl:
      '/uploads/og-v2-abcd1234-0123456789abcdef0123-00000000-0000-4000-8000-000000000002.png',
    previewFingerprint: 'proof-of-the-rendered-slide',
    created: '2026-07-02T00:00:00.000Z',
    modified: '2026-07-02T00:00:00.000Z',
  };
  const echoes = [
    { id: proof.id, slug: proof.slug, ogImageUrl: proof.ogImageUrl },
    null,
    { id: 'other000', slug: 'elsewhere', ogImageUrl: '/uploads/LEGACY.png' },
  ];
  for (const save of [editorSave, v1Save]) {
    for (const published of echoes) {
      const db = await installDb();
      storedDeck(db).published = structuredClone(proof);
      const res = await save(OWNER, { title: 'Changed', published });
      const why = `${save.name} ${JSON.stringify(published)}`;
      assert.equal(res.statusCode, 200, why);
      assert.equal(storedDeck(db).title, 'Changed', why);
      assert.deepEqual(storedDeck(db).published, proof, why);
    }
  }
});

/**
 * Routes that write a loaded deck back keep the active language version (B748).
 *
 * The write seam (`normalizeI18n`) takes top-level `title`/`slides` as the
 * buffer of `i18n.active`; a loaded deck carries the dominant version there.
 * Six internal routes wrote a loaded deck back with its stored `i18n`: the
 * image import, applying a comment's proposed slide, promoting an audience
 * question, renaming the published slug, regenerating the preview and
 * restoring a saved version. On a deck whose active language is not the
 * dominant one, the dominant text landed in `versions[active]`. The slide
 * writers now go through `dominantSlidesBody`, the restore aligns the
 * snapshot to its active version, and the publish routes write only the
 * publication column, as the shared publish flow does.
 *
 * The store: OWNER's Dutch deck with a German version, edited last in German
 * (`active = de`), in the shape of the dominant-version write test (B740).
 * Each case drives one route through its exported handler over the fake
 * database and reads the stored row. The preview regenerate route needs a
 * live media provider and is covered by its shared shape with the slug route.
 *
 * Run with: node --test tests/routes-active-language-writeback.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMockRes } from './helpers/http-mocks.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import {
  translationFieldKey,
  translationSource,
} from '../shared/translation-provenance.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b748']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const DECK_ID = 'd0000748-0000-4000-8000-000000000001';
const PUBLISH_ID = 'pub748';
const REPO_ROOT = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { withErrorHandler } = await import('../server/utils/http.js');
const { getPresentation, createPresentationVersion } =
  await import('../server/storage/presentations/index.js');
const { upsertPublishedEntry } = await import('../server/storage/published.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createQuestion } = await import('../server/storage/questions.js');
const { handlePresentationImportSlidesAsImages } =
  await import('../server/routes/api/presentations/import-slides-as-images.js');
const { handlePresentationCommentApply } =
  await import('../server/routes/api/presentations/comments-actions.js');
const { handlePresentationRestoreVersion } =
  await import('../server/routes/api/presentations/restore.js');
const { handleQuestions } = await import('../server/routes/api/questions.js');
const { handlePublish } = await import('../server/routes/api/publish.js');

let PptxGenJS = null;
try {
  PptxGenJS = (await import('pptxgenjs')).default;
  // eslint-disable-next-line no-restricted-syntax -- an install without optional dependencies has no deck writer; the image-import case skips
} catch {
  // skipped below
}

const OWNER = {
  id: userIdFor(OWNER_EMAIL),
  email: OWNER_EMAIL,
  name: 'owner',
  role: 'user',
  organizationId: ORG,
};

const slide = (id, title, type = 'content-slide') => ({
  id,
  type,
  content: { title },
});
const NL = {
  title: 'Roadmap',
  slides: [slide('slide-1', 'Hoi', 'title-slide'), slide('slide-2', 'Twee')],
};
const DE = {
  title: 'Fahrplan',
  slides: [slide('slide-1', 'Hallo', 'title-slide'), slide('slide-2', 'Zwei')],
  translationSources: {
    [translationFieldKey('slide-1', ['title'])]: translationSource('nl', 'Hoi'),
  },
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

async function installDb({ comments = [] } = {}) {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL),
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
          active: 'de',
          versions: { nl: structuredClone(NL), de: structuredClone(DE) },
        },
        slides: structuredClone(NL.slides),
        published: { id: PUBLISH_ID, slug: 'roadmap' },
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    presentation_collaborators: [],
    presentation_comments: comments,
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
}

test.after(() => {
  __setTestDb(null);
});

const scope = () => createStorageScope(OWNER, { repoRoot: REPO_ROOT });
const storedDeck = () =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);
const titles = (slides) => slides.map((s) => s.content.title);

/**
 * Both versions' slides that were stored before the route ran still carry
 * their own language, and the pointers are as stored.
 */
function assertVersionsKept(row) {
  assert.deepEqual(
    row.i18n.versions.de.translationSources,
    DE.translationSources,
  );
  const keptTitles = (version, ids) =>
    titles(version.slides.filter((s) => ids.includes(s.id)));
  const ids = ['slide-1', 'slide-2'];
  assert.equal(row.i18n.versions.de.title, 'Fahrplan');
  assert.deepEqual(keptTitles(row.i18n.versions.de, ids), ['Hallo', 'Zwei']);
  assert.equal(row.i18n.versions.nl.title, 'Roadmap');
  assert.deepEqual(keptTitles(row.i18n.versions.nl, ids), ['Hoi', 'Twee']);
  assert.deepEqual(keptTitles(row, ids), ['Hoi', 'Twee']);
  assert.equal(row.i18n.active, 'de');
  assert.equal(row.i18n.dominant, 'nl');
}

function makeReq(method, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    headers: {
      host: 'decks.example.test',
      'content-type': 'application/json',
      ...headers,
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
}

/** Drive a handler the way the router mounts it, under `withErrorHandler`. */
async function call(handler, { method = 'POST', body, headers, path, args }) {
  const res = createMockRes();
  await withErrorHandler('b748-test', handler)(
    {
      repoRoot: REPO_ROOT,
      storageScope: scope(),
      req: makeReq(method, body, headers),
      res,
      url: new URL(`http://decks.example.test${path || '/'}`),
      authedUser: OWNER,
    },
    ...(args || []),
  );
  return res;
}

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.chunks = [];
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    res.chunks.push(String(chunk));
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.chunks.push(String(chunk));
    res.writableEnded = true;
    res.writable = false;
  };
  return res;
}

test(
  'importing slides as images keeps the active version',
  { skip: PptxGenJS ? false : 'pptxgenjs is not installed' },
  async () => {
    await installDb();
    const pptx = new PptxGenJS();
    pptx.addSlide().addNotes('Imported notes');
    const buffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
    const res = makeSseRes();
    await handlePresentationImportSlidesAsImages(
      {
        repoRoot: REPO_ROOT,
        storageScope: scope(),
        req: makeReq('POST', {
          pptxDataUrl:
            'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,' +
            buffer.toString('base64'),
          pptxFilename: 'talk.pptx',
        }),
        res,
        authedUser: OWNER,
      },
      DECK_ID,
    );
    assert.match(res.chunks.join(''), /event: complete/, res.chunks.join(''));

    const row = storedDeck();
    assert.equal(row.slides.length, 3, 'the image slide joins the deck');
    assert.equal(row.i18n.versions.nl.slides.length, 3);
    assertVersionsKept(row);
  },
);

test('applying a proposed slide keeps the active version', async () => {
  await installDb({
    comments: [
      {
        id: 'cm-ai',
        presentation_id: DECK_ID,
        organization_id: ORG,
        slide_id: 'slide-1',
        parent_id: null,
        author_email: 'ai@deckyard.local',
        author_name: 'Deckyard AI',
        author_user_id: null,
        author_guest_id: null,
        body: 'Split this slide',
        status: 'open',
        position_x: null,
        position_y: null,
        comment_type: 'ai_suggestion',
        suggestion_category: 'clarity',
        proposed_slide: {
          type: 'content-slide',
          content: { title: 'Voorstel' },
        },
        slide_snapshot: null,
        mentions: [],
        resolved_by: null,
        resolved_at: null,
        created_at: '2026-07-02T00:00:00.000Z',
        updated_at: '2026-07-02T00:00:00.000Z',
      },
    ],
  });
  const res = await call(handlePresentationCommentApply, {
    args: [DECK_ID, 'cm-ai'],
  });
  assert.equal(res.statusCode, 200, String(res.body));

  const row = storedDeck();
  assert.deepEqual(titles(row.slides), ['Hoi', 'Voorstel', 'Twee']);
  assertVersionsKept(row);
});

test('promoting an audience question keeps the active version', async () => {
  await installDb();
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: DECK_ID },
  );
  await updateLiveSessionState(
    { repoRoot: REPO_ROOT, organizationId: ORG },
    session.sessionId,
    {
      slideId: 'slide-1',
      slideIndex: 0,
      slideType: 'title-slide',
      updatedAt: Date.now(),
    },
  );
  const asked = await createQuestion(scope(), session.sessionId, {
    text: 'Komt dit op het examen?',
    authorId: 'device-anon-1',
    authorName: 'Anon',
  });
  const path = `/api/moderate/${DECK_ID}/questions/${asked.question.id}/promote`;
  const res = await call(handleQuestions, { body: { position: 'end' }, path });
  assert.equal(res.statusCode, 200, String(res.body));

  const row = storedDeck();
  assert.equal(row.slides.length, 3, 'the question slide joins the deck');
  assert.equal(row.i18n.versions.de.slides.length, 3);
  assertVersionsKept(row);
});

test('renaming the published slug keeps the active version', async () => {
  await installDb();
  await upsertPublishedEntry(scope(), {
    publishId: PUBLISH_ID,
    presentationId: DECK_ID,
    title: NL.title,
  });
  const res = await call(handlePublish, {
    method: 'PATCH',
    body: { slug: 'fahrplan' },
    path: `/api/presentations/${DECK_ID}/publish/slug`,
  });
  assert.equal(res.statusCode, 200, String(res.body));

  const row = storedDeck();
  assert.equal(row.published.slug, 'fahrplan');
  assert.equal(row.published.id, PUBLISH_ID);
  assertVersionsKept(row);
});

test('restoring a saved version keeps the active version', async () => {
  await installDb();
  const pres = await getPresentation(scope(), DECK_ID);
  const snap = await createPresentationVersion(scope(), DECK_ID, pres, {
    actorEmail: OWNER_EMAIL,
    reason: 'manual',
  });
  const res = await call(handlePresentationRestoreVersion, {
    headers: { 'if-match': String(storedDeck().revision) },
    args: [DECK_ID, snap.id],
  });
  assert.equal(res.statusCode, 200, String(res.body));

  assertVersionsKept(storedDeck());
});

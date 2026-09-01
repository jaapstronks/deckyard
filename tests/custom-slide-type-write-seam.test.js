/**
 * B129: a deck using an organization's DB-backed custom slide type is saveable.
 *
 * The Settings → Slide Types builder stores a type in `custom_slide_types` and
 * the editor inserts it as `custom-<slug>`. The storage write seam
 * (`normalizeSlides`) resolved every slide type against the process-wide
 * `SLIDE_TYPES` map — core plus file-based `custom/slide-types/` — which a
 * per-organization DB row can never be in. So the editor let you add the slide
 * and every autosave after it answered 400, with the deck unsaveable until the
 * slide was removed.
 *
 * The fix is not a second, more tolerant validation route for `custom-*` ids:
 * it is that the seam validates against the organization's registry, built by
 * the same `buildMergedSlideTypes` every server-side read path (export,
 * published viewer, thumbnails) already used. These pin both halves of that —
 * the type resolves, and everything that is *not* one of the org's published
 * types is still a 400.
 *
 * Postgres-mode storage behaviour, so this runs against the in-memory database
 * double (tests/helpers/fake-db.js), the same harness as
 * public-api-slide-type-validation.
 *
 * Run with: node --test tests/custom-slide-type-write-seam.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-custom-type';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { buildMergedSlideTypes } =
  await import('../server/utils/custom-slide-type-runtime.js');
const { customSlideTypeKey } =
  await import('../shared/slide-types/custom-type-runtime.js');

/**
 * One `custom_slide_types` row. `template` is set on purpose: building the
 * registry must not compile it (the write path only needs the key to exist).
 * @param {object} over - Column overrides
 * @returns {object}
 */
function customTypeRow(over = {}) {
  return {
    id: 'cst-partner-wall',
    organization_id: ORG,
    slug: 'partner-wall',
    label: 'Partner wall',
    base_type: null,
    fields: [{ key: 'title', type: 'string', label: 'Titel' }],
    defaults: {},
    defaults_by_lang: null,
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
    css: null,
    usage: null,
    is_published: true,
    sort_order: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    created_by: null,
    ...over,
  };
}

/** Install a freshly seeded double and point the storage facade at Postgres. */
async function installDb(customSlideTypes = [customTypeRow()]) {
  const db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: userRows(OWNER),
    custom_slide_types: customSlideTypes,
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        owner_user_id: userIdFor(OWNER),
        created_by_user_id: userIdFor(OWNER),
        updated_by_user_id: userIdFor(OWNER),
        title: 'A deck',
        theme: 'default',
        lang: 'nl',
        visibility: 'private',
        revision: 1,
        slides: [
          {
            id: 'slide-1',
            type: 'title-slide',
            content: { title: 'Hoi' },
            parentId: null,
          },
        ],
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/** The stored row, straight from the double. */
function storedDeck(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID);
}

/** The organization's storage scope, as a route would build it. */
function scopeFor(organizationId = ORG) {
  return {
    repoRoot: process.cwd(),
    organizationId,
    actorUserId: userIdFor(OWNER),
    actorEmail: OWNER,
  };
}

/** Request context for the public-API router, key already authenticated. */
function makeCtx(method, pathname, body = null) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: scopeFor(),
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

/** PUT the whole deck with one slide of `type`. */
async function putSlideType(type) {
  const ctx = makeCtx('PUT', `/api/v1/presentations/${DECK_ID}`, {
    slides: [{ id: 'slide-1', type, content: { title: 'x' } }],
  });
  await handlePresentations(ctx);
  return ctx.res;
}

test('a deck using a published custom slide type saves', async () => {
  const db = await installDb();

  const res = await putSlideType('custom-partner-wall');

  assert.equal(
    res.statusCode,
    200,
    `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`,
  );
  assert.equal(
    storedDeck(db).slides[0].type,
    'custom-partner-wall',
    'the custom type is stored under its own key, unchanged',
  );
});

test('the language versions accept it too', async () => {
  const db = await installDb();

  const ctx = makeCtx('PUT', `/api/v1/presentations/${DECK_ID}`, {
    slides: [
      { id: 'slide-1', type: 'custom-partner-wall', content: { title: 'nl' } },
    ],
    i18n: {
      dominant: 'nl',
      versions: {
        nl: {
          title: 'A deck',
          slides: [
            {
              id: 'slide-1',
              type: 'custom-partner-wall',
              content: { title: 'nl' },
            },
          ],
        },
        'en-GB': {
          title: 'A deck',
          slides: [
            {
              id: 'slide-1',
              type: 'custom-partner-wall',
              content: { title: 'en' },
            },
          ],
        },
      },
    },
  });
  await handlePresentations(ctx);

  assert.equal(
    ctx.res.statusCode,
    200,
    `expected 200, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`,
  );
  assert.equal(
    storedDeck(db).i18n.versions['en-GB'].slides[0].type,
    'custom-partner-wall',
  );
});

test('a deck created with a custom-type slide is accepted', async () => {
  await installDb();

  const created = await createPresentation(scopeFor(), {
    title: 'New deck',
    ownerEmail: OWNER,
    slides: [{ type: 'custom-partner-wall', content: { title: 'x' } }],
  });

  assert.equal(created?.ok !== false, true, JSON.stringify(created));
  const pres = created.presentation || created;
  assert.equal(pres.slides[0].type, 'custom-partner-wall');
});

test('an unpublished custom type is still rejected', async () => {
  const db = await installDb([customTypeRow({ is_published: false })]);

  const res = await putSlideType('custom-partner-wall');

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(
    storedDeck(db).slides[0].type,
    'title-slide',
    'the stored deck is untouched',
  );
});

test("another organization's custom type is rejected", async () => {
  const db = await installDb([customTypeRow({ organization_id: OTHER_ORG })]);

  const res = await putSlideType('custom-partner-wall');

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(storedDeck(db).slides[0].type, 'title-slide');
});

test('an unknown type is still a 400 — no tolerance for `custom-` ids', async () => {
  const db = await installDb();

  for (const type of ['custom-not-a-type', 'not-a-real-type']) {
    const res = await putSlideType(type);
    assert.equal(res.statusCode, 400, `${type}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(storedDeck(db).slides[0].type, 'title-slide');
});

test('the registry key the editor publishes is the key the seam resolves', async () => {
  await installDb();

  const registry = await buildMergedSlideTypes(scopeFor());
  const key = customSlideTypeKey({ slug: 'partner-wall' });

  assert.ok(
    Object.prototype.hasOwnProperty.call(registry, key),
    `${key} missing from the org registry`,
  );
  assert.equal(registry[key].isCustom, true);
  assert.equal(registry[key].customId, 'cst-partner-wall');
});

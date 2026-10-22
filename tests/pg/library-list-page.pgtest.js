/**
 * The slide library, the collections and the image library in SQL, on the
 * list-page contract, against real PostgreSQL (B822, D358).
 *
 * Each list used to read the organization's whole set; the internal routes
 * answered it as one array, v1 filtered the trash and the search in
 * JavaScript and sliced. Now every predicate is in the query and the page is
 * a keyset page (`server/storage/keyset.js`). This file is the gate, through
 * the real routes:
 *
 * the six checks every list carries (brief `db-level-pagination.md` § Checks),
 * for the organization shelf, a personal shelf, the trash, both collection
 * shelves and the image library:
 *
 *  1. completeness and 2. order: every row exactly once, in
 *     `(<time> desc, id desc)`, across rows made in one identical microsecond;
 *  3. stability: a row added between pages does not move page 2;
 *  4. org isolation: a cursor from org A used in org B shows only B rows;
 *  5. refusal: `offset`, `limit` 0, 101 and not a number, a broken cursor, a
 *     cursor of another list and a cursor made under other filters;
 *  6. full pages: every page but the last has exactly `limit` rows, also
 *     under a narrowing filter;
 *
 * plus what used to be decided in the browser or after the read and is SQL
 * now: the slide library's type, tag, language and search filters and its
 * facets, a collection's members, the image library's sections, tag and
 * search, the v1 `search`/`category` filters and the categories list; and
 * migration 098 and an `EXPLAIN` on 10 000 rows per list showing each page
 * walks its keyset index without a sort.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { CompiledQuery, sql } from 'kysely';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { createMockRes } from '../helpers/http-mocks.js';
import { keysetPage } from '../../server/storage/keyset.js';
import { handleSlideLibrary } from '../../server/routes/api/slide-library.js';
import { handleSlideCollections } from '../../server/routes/api/slide-collections.js';
import { handleImageLibrary } from '../../server/routes/api/image-library.js';
import { handleResources } from '../../server/routes/public-api/v1/resources.js';
import { handleSlideLibrary as handleV1SlideLibrary } from '../../server/routes/public-api/v1/slide-library.js';
import { __libraryList } from '../../server/storage/slide-library.js';
import { __collectionList } from '../../server/storage/collections.js';
import { __imageList } from '../../server/storage/image-library.js';
import {
  down as migrate098Down,
  up as migrate098Up,
} from '../../server/db/migrations/098_library_list_keyset.js';

const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';

const person = (name, extra = {}) => ({
  id: crypto.randomUUID(),
  email: `${name}@example.com`,
  name,
  isAdmin: false,
  ...extra,
});
const OWNER = person('owner');
const OTHER = person('other');

/** A time `n` microseconds after SAME_MOMENT, distinct per n. */
const micro = (n) =>
  `2026-10-01 12:00:00.${String(123456 + n).padStart(6, '0')}+00`;

pgDescribe(
  'library lists in SQL on the list-page contract (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;
    let orgA;
    let orgB;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(
        db,
        'organizations',
        'users',
        'slide_library',
        'slide_library_tags',
        'tags',
        'slide_collections',
        'slide_collection_items',
        'image_library',
        'image_library_favorites',
      );
      orgA = await seedDefaultOrganization(db);
      orgB = crypto.randomUUID();
      await db
        .insertInto('organizations')
        .values({ id: orgB, name: 'Other Org', slug: 'other-org' })
        .execute();
      await db
        .insertInto('users')
        .values(
          [OWNER, OTHER].map((p) => ({
            id: p.id,
            organization_id: orgA,
            email: p.email,
            name: p.name,
            role: 'user',
          })),
        )
        .execute();
    });

    const scopeOf = (organizationId, actor = {}) => ({
      repoRoot: process.cwd(),
      organizationId,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
    });

    // ───────────────────────────── fixtures

    async function insertItem({
      organizationId = orgA,
      shelf = 'organization',
      owner = null,
      createdAt = SAME_MOMENT,
      trashedAt = null,
      slideType = 'content-slide',
      name = 'Item',
      description = '',
      content = {},
      i18n = {},
    } = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('slide_library')
        .values({
          id,
          organization_id: organizationId,
          shelf,
          owner_email: owner?.email ?? null,
          name,
          description,
          slide_type: slideType,
          content: JSON.stringify(content),
          i18n: JSON.stringify(i18n),
          created_at: createdAt,
          trashed_at: trashedAt,
        })
        .execute();
      return id;
    }

    async function tagItem(itemId, name, organizationId = orgA) {
      let tag = await db
        .selectFrom('tags')
        .select('id')
        .where('organization_id', '=', organizationId)
        .where(sql`lower(name)`, '=', name.toLowerCase())
        .executeTakeFirst();
      if (!tag) {
        tag = await db
          .insertInto('tags')
          .values({ organization_id: organizationId, name })
          .returning('id')
          .executeTakeFirstOrThrow();
      }
      await db
        .insertInto('slide_library_tags')
        .values({ slide_library_id: itemId, tag_id: tag.id })
        .execute();
    }

    async function insertCollection({
      organizationId = orgA,
      shelf = 'organization',
      owner = null,
      createdAt = SAME_MOMENT,
      slideIds = [],
    } = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('slide_collections')
        .values({
          id,
          organization_id: organizationId,
          shelf,
          owner_email: owner?.email ?? null,
          name: 'Collection',
          created_at: createdAt,
        })
        .execute();
      for (const [position, slideId] of slideIds.entries()) {
        await db
          .insertInto('slide_collection_items')
          .values({
            collection_id: id,
            slide_library_id: slideId,
            position,
          })
          .execute();
      }
      return id;
    }

    async function insertImage({
      organizationId = orgA,
      createdAt = SAME_MOMENT,
      tags = [],
      title = 'Image',
      uploadedBy = null,
      alts = {},
    } = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('image_library')
        .values({
          id,
          organization_id: organizationId,
          url: `https://example.com/${id}.png`,
          title,
          tags: sql`${tags}::text[]`,
          alts: JSON.stringify(alts),
          uploaded_by: uploadedBy,
          created_at: createdAt,
        })
        .execute();
      return id;
    }

    // ───────────────────────────── the routes

    /** Call a route handler; answers status and parsed body. */
    async function call(handler, path, actor = OWNER, organizationId = orgA) {
      const res = createMockRes();
      const url = new URL(`http://deck.example${path}`);
      await handler({
        req: {
          method: 'GET',
          headers: { host: 'deck.example' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res,
        url,
        repoRoot: process.cwd(),
        storageScope: scopeOf(organizationId, actor),
        authedUser: actor,
        apiKey: {
          id: 'key-1',
          tier: 'free',
          ownerEmail: actor?.email,
          permissions: ['read'],
          organizationId,
        },
      });
      return { status: res.statusCode, body: res.json() };
    }

    const LISTS = {
      organization: {
        handler: handleSlideLibrary,
        path: '/api/slide-library/organization',
      },
      personal: {
        handler: handleSlideLibrary,
        path: '/api/slide-library/personal',
      },
      collections: {
        handler: handleSlideCollections,
        path: '/api/slide-collections/organization',
      },
      personalCollections: {
        handler: handleSlideCollections,
        path: '/api/slide-collections/personal',
      },
      images: { handler: handleImageLibrary, path: '/api/image-library' },
    };

    const withQuery = (path, query) =>
      `${path}${path.includes('?') ? '&' : '?'}${query}`;

    /** Walk a list to the end; answers the pages as id lists. */
    async function walk(list, { limit, filters = '', actor, org, key } = {}) {
      const { handler, path } = LISTS[list];
      const pages = [];
      let cursor = null;
      for (let guard = 0; guard < 200; guard++) {
        const query = [
          filters,
          `limit=${limit}`,
          cursor ? `cursor=${encodeURIComponent(cursor)}` : '',
        ]
          .filter(Boolean)
          .join('&');
        const { status, body } = await call(
          handler,
          withQuery(path, query),
          actor,
          org,
        );
        assert.equal(status, 200, JSON.stringify(body));
        pages.push(body[key || 'items'].map((row) => row.id));
        cursor = body.nextCursor;
        if (cursor === null) return pages;
      }
      throw new Error('the list never ended');
    }

    /** Rows of a table in the contract order, straight from SQL. */
    async function contractOrder(table, where, column = 'created_at') {
      const { rows } = await sql`
        SELECT id FROM ${sql.table(table)} WHERE ${where}
        ORDER BY ${sql.ref(column)} DESC, id DESC
      `.execute(db);
      return rows.map((row) => row.id);
    }

    /** Assert 1, 2 and 6 for one walk against the expected ids. */
    function assertWalk(pages, expected, limit, label) {
      for (const page of pages.slice(0, -1)) {
        assert.equal(page.length, limit, `${label}: a full page`);
      }
      const seen = pages.flat();
      assert.equal(new Set(seen).size, seen.length, `${label}: no row twice`);
      assert.deepEqual(seen, expected, `${label}: every row once, in order`);
    }

    /**
     * 10 rows in one microsecond, 5 a microsecond apart, 8 on other days:
     * 23 rows, not divisible by the limits used.
     */
    const SPREAD = [
      ...Array.from({ length: 10 }, () => SAME_MOMENT),
      ...Array.from({ length: 5 }, (_, i) => micro(i + 1)),
      ...Array.from({ length: 8 }, (_, i) => `2026-09-${10 + i} 08:00:00+00`),
    ];

    // ───────────────────────────── slide library

    it('1+2+6 slide library: each shelf and the trash, every item once, in order, full pages', async () => {
      const shelfIds = [];
      for (const createdAt of SPREAD) {
        shelfIds.push(await insertItem({ createdAt }));
      }
      const personalIds = [];
      for (const createdAt of SPREAD.slice(0, 13)) {
        personalIds.push(
          await insertItem({ shelf: 'personal', owner: OWNER, createdAt }),
        );
      }
      const trashIds = [];
      for (const [i, createdAt] of SPREAD.entries()) {
        trashIds.push(
          await insertItem({
            createdAt,
            trashedAt: i < 10 ? SAME_MOMENT : micro(100 + i),
          }),
        );
      }
      // Left out of every list above: someone else's personal item, the
      // owner's trashed personal item, another organization's item.
      await insertItem({ shelf: 'personal', owner: OTHER });
      await insertItem({
        shelf: 'personal',
        owner: OWNER,
        trashedAt: SAME_MOMENT,
      });
      await insertItem({ organizationId: orgB });

      assertWalk(
        await walk('organization', { limit: 5 }),
        await contractOrder(
          'slide_library',
          sql`organization_id = ${orgA} AND shelf = 'organization' AND trashed_at IS NULL`,
        ),
        5,
        'organization shelf',
      );
      assert.equal(
        (await walk('organization', { limit: 5 })).flat().length,
        23,
      );
      assert.deepEqual(
        [...(await walk('organization', { limit: 5 })).flat()].sort(),
        [...shelfIds].sort(),
      );

      const personal = await walk('personal', { limit: 4 });
      assertWalk(
        personal,
        await contractOrder(
          'slide_library',
          sql`organization_id = ${orgA} AND shelf = 'personal' AND owner_email = ${OWNER.email} AND trashed_at IS NULL`,
        ),
        4,
        'personal shelf',
      );
      assert.deepEqual([...personal.flat()].sort(), [...personalIds].sort());
      assert.deepEqual(
        (await walk('personal', { limit: 4, actor: OTHER })).flat().length,
        1,
        "someone else's personal shelf is theirs alone",
      );

      const trash = await walk('organization', {
        limit: 6,
        filters: 'view=trash',
      });
      assertWalk(
        trash,
        await contractOrder(
          'slide_library',
          sql`organization_id = ${orgA} AND shelf = 'organization' AND trashed_at IS NOT NULL`,
          'trashed_at',
        ),
        6,
        'trash',
      );
      assert.deepEqual([...trash.flat()].sort(), [...trashIds].sort());
    });

    it('slide library filters are SQL: type, every tag, language and search, with full pages', async () => {
      const want = {
        type: [],
        tags: [],
        lang: [],
        qName: [],
        qContent: [],
        qTag: [],
      };
      for (let i = 0; i < 24; i++) {
        const even = i % 2 === 0;
        const id = await insertItem({
          createdAt: micro(i),
          slideType: even ? 'quote-slide' : 'content-slide',
          name: i % 3 === 0 ? `Growth story ${i}` : `Item ${i}`,
          content:
            i % 4 === 0
              ? { title: 'Revenue grew 40%', bullets: ['one', 'two'] }
              : { title: 'Plain' },
          i18n:
            i % 5 === 0
              ? {
                  dominant: 'en-GB',
                  versions: { nl: { content: { title: 'Hallo' } } },
                }
              : { dominant: 'en-GB' },
        });
        if (even) want.type.push(id);
        if (i % 3 === 0) want.qName.push(id);
        if (i % 4 === 0) want.qContent.push(id);
        if (i % 5 === 0) want.lang.push(id);
        if (i % 2 === 0) await tagItem(id, 'Intro');
        if (i % 3 === 0) await tagItem(id, 'q3');
        if (i % 2 === 0 && i % 3 === 0) want.tags.push(id);
        if (i % 3 === 0) want.qTag.push(id);
      }
      // Not on the shelf: a trashed match.
      await insertItem({ slideType: 'quote-slide', trashedAt: SAME_MOMENT });
      const all = await contractOrder(
        'slide_library',
        sql`organization_id = ${orgA} AND shelf = 'organization' AND trashed_at IS NULL`,
      );

      const order = async (ids) =>
        (
          await contractOrder(
            'slide_library',
            sql`organization_id = ${orgA} AND shelf = 'organization' AND trashed_at IS NULL`,
          )
        ).filter((id) => ids.includes(id));

      for (const [label, filters, ids] of [
        ['type', 'type=quote-slide', want.type],
        ['every tag', 'tag=intro&tag=Q3', want.tags],
        ['language', 'lang=nl', want.lang],
        ['the language it is written in', 'lang=en-GB', await order(all)],
        ['search in the name', 'q=growth', want.qName],
        ['search in a content string', 'q=revenue', want.qContent],
      ]) {
        assertWalk(
          await walk('organization', { limit: 3, filters }),
          await order(ids),
          3,
          label,
        );
      }
      // The search reads values, not keys: every item has a `title` key.
      assert.deepEqual(
        (await walk('organization', { limit: 50, filters: 'q=title' })).flat(),
        [],
      );
      // A tag name is searched too; a LIKE wildcard is a character.
      assert.deepEqual(
        (await walk('organization', { limit: 50, filters: 'q=Q3' })).flat(),
        await order(want.qTag),
      );
      assert.deepEqual(
        (await walk('organization', { limit: 50, filters: 'q=%25' })).flat(),
        await order(want.qContent),
        '"%" matches the literal 40%, not everything',
      );

      // The facets are their own query over the untrashed shelf.
      const facets = await call(
        handleSlideLibrary,
        '/api/slide-library/organization/facets',
      );
      assert.equal(facets.status, 200);
      assert.equal(facets.body.total, 24);
      assert.deepEqual(facets.body.types, [
        { slideType: 'content-slide', count: 12 },
        { slideType: 'quote-slide', count: 12 },
      ]);
      assert.deepEqual(facets.body.tags, [
        { name: 'Intro', count: 12 },
        { name: 'q3', count: 8 },
      ]);
      const nl = await call(
        handleSlideLibrary,
        '/api/slide-library/organization/facets?lang=nl',
      );
      assert.equal(nl.body.total, 24, 'the total ignores the language');
      assert.equal(
        nl.body.types.reduce((sum, row) => sum + row.count, 0),
        want.lang.length,
      );
    });

    it('3: an item saved between pages does not move page 2', async () => {
      for (let i = 0; i < 9; i++) {
        await insertItem({ createdAt: `2026-09-${10 + i} 08:00:00+00` });
      }
      const path = LISTS.organization.path;
      const first = await call(handleSlideLibrary, `${path}?limit=3`);
      const page2 = `${path}?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`;
      const before = await call(handleSlideLibrary, page2);
      await insertItem({ createdAt: '2026-10-22 09:00:00.000001+00' });
      assert.deepEqual(
        (await call(handleSlideLibrary, page2)).body,
        before.body,
      );
    });

    it('5: the library routes refuse offset, a wild limit, a foreign cursor and an unknown filter', async () => {
      for (let i = 0; i < 3; i++) await insertItem({ createdAt: micro(i) });
      for (let i = 0; i < 3; i++) {
        await insertCollection({ createdAt: micro(i) });
        await insertImage({ createdAt: micro(i) });
      }
      const cursorOf = async (handler, path) =>
        (await call(handler, withQuery(path, 'limit=1'))).body.nextCursor;
      const library = await cursorOf(
        handleSlideLibrary,
        LISTS.organization.path,
      );
      const quotes = await cursorOf(
        handleSlideLibrary,
        `${LISTS.organization.path}?type=content-slide`,
      );
      const collections = await cursorOf(
        handleSlideCollections,
        LISTS.collections.path,
      );
      const images = await cursorOf(handleImageLibrary, LISTS.images.path);
      assert.ok(library && quotes && collections && images);

      for (const [list, query, field] of [
        ['organization', 'offset=1', 'offset'],
        ['organization', 'limit=0', 'limit'],
        ['organization', 'limit=101', 'limit'],
        ['organization', 'limit=abc', 'limit'],
        ['organization', 'cursor=broken', 'cursor'],
        ['organization', `cursor=${encodeURIComponent(collections)}`, 'cursor'],
        ['organization', `cursor=${encodeURIComponent(quotes)}`, 'cursor'],
        [
          'organization',
          `view=trash&cursor=${encodeURIComponent(library)}`,
          'cursor',
        ],
        ['personal', `cursor=${encodeURIComponent(library)}`, 'cursor'],
        ['organization', 'view=bin', 'view'],
        ['organization', 'lang=xx', 'lang'],
        ['collections', 'offset=1', 'offset'],
        ['collections', `cursor=${encodeURIComponent(images)}`, 'cursor'],
        ['images', 'limit=500', 'limit'],
        ['images', `cursor=${encodeURIComponent(library)}`, 'cursor'],
        ['images', `q=sea&cursor=${encodeURIComponent(images)}`, 'cursor'],
        ['images', 'section=everything', 'section'],
      ]) {
        const { handler, path } = LISTS[list];
        const { status, body } = await call(handler, withQuery(path, query));
        assert.equal(status, 400, `${list} ${query}`);
        assert.equal(body.error, 'invalid', `${list} ${query}`);
        assert.equal(body.details.field, field, `${list} ${query}`);
        if (field === 'offset') assert.equal(body.details.use, 'cursor');
      }
    });

    // ───────────────────────────── collections

    it('1+2+6 collections: each shelf, every collection once, in order, full pages', async () => {
      for (const createdAt of SPREAD) await insertCollection({ createdAt });
      for (const createdAt of SPREAD.slice(0, 11)) {
        await insertCollection({ shelf: 'personal', owner: OWNER, createdAt });
      }
      await insertCollection({ shelf: 'personal', owner: OTHER });
      await insertCollection({ organizationId: orgB });

      assertWalk(
        await walk('collections', { limit: 5 }),
        await contractOrder(
          'slide_collections',
          sql`organization_id = ${orgA} AND shelf = 'organization'`,
        ),
        5,
        'organization collections',
      );
      assertWalk(
        await walk('personalCollections', { limit: 4 }),
        await contractOrder(
          'slide_collections',
          sql`organization_id = ${orgA} AND shelf = 'personal' AND owner_email = ${OWNER.email}`,
        ),
        4,
        'personal collections',
      );
      assert.equal((await walk('collections', { limit: 5 })).flat().length, 23);
      assert.equal(
        (await walk('personalCollections', { limit: 4 })).flat().length,
        11,
      );
    });

    it("a collection's slides are its members the reader may see, in its order", async () => {
      const team = await insertItem({ name: 'Team' });
      const mine = await insertItem({ shelf: 'personal', owner: OWNER });
      const theirs = await insertItem({ shelf: 'personal', owner: OTHER });
      const trashed = await insertItem({ trashedAt: SAME_MOMENT });
      const collection = await insertCollection({
        slideIds: [theirs, trashed, mine, team],
      });
      const { status, body } = await call(
        handleSlideCollections,
        `/api/slide-collections/organization/${collection}/slides`,
      );
      assert.equal(status, 200);
      assert.deepEqual(
        body.items.map((it) => it.id),
        [trashed, mine, team],
        "someone else's personal slide is left out; the order is the collection's",
      );
      assert.ok(body.items[0].trashedAt, 'a trashed member says so');
      const fromB = await call(
        handleSlideCollections,
        `/api/slide-collections/organization/${collection}/slides`,
        OWNER,
        orgB,
      );
      assert.equal(
        fromB.status,
        404,
        'another organization has no such collection',
      );
    });

    // ───────────────────────────── image library

    it('1+2+6 image library: every image once, in order, full pages, under each section', async () => {
      const ids = [];
      for (const [i, createdAt] of SPREAD.entries()) {
        ids.push(
          await insertImage({
            createdAt,
            tags: i % 2 === 0 ? ['Logo-dark', 'brand'] : ['photo'],
            uploadedBy: i % 3 === 0 ? OWNER.email : OTHER.email,
            alts: i % 4 === 0 ? { nl: 'Een zonsondergang' } : {},
          }),
        );
      }
      await insertImage({ organizationId: orgB, tags: ['logo'] });
      for (const [i, id] of ids.entries()) {
        if (i % 5 === 0) {
          await db
            .insertInto('image_library_favorites')
            .values({
              image_id: id,
              user_email: OWNER.email,
              organization_id: orgA,
            })
            .execute();
        }
      }
      const all = await contractOrder(
        'image_library',
        sql`organization_id = ${orgA}`,
      );
      const pick = (keep) => all.filter((id) => keep(ids.indexOf(id)));

      for (const [label, filters, expected] of [
        ['all', '', all],
        ['mine', 'section=mine', pick((i) => i % 3 === 0)],
        ['favorites', 'section=favorites', pick((i) => i % 5 === 0)],
        ['logos', 'section=logos', pick((i) => i % 2 === 0)],
        ['icons', 'section=icons', []],
        ['tag', 'tag=BRAND', pick((i) => i % 2 === 0)],
        ['search in an alt text', 'q=zonsondergang', pick((i) => i % 4 === 0)],
      ]) {
        assertWalk(
          await walk('images', { limit: 4, filters }),
          expected,
          4,
          label,
        );
      }
      assert.deepEqual(
        (
          await walk('images', { limit: 4, filters: 'section=mine', actor: {} })
        ).flat(),
        [],
        'no reader, no uploads of their own',
      );

      const tags = await call(handleImageLibrary, '/api/image-library/tags');
      assert.deepEqual(tags.body.tags, [
        { name: 'brand', count: 12 },
        { name: 'Logo-dark', count: 12 },
        { name: 'photo', count: 11 },
      ]);
    });

    it('v1 image library: search and category in SQL, categories as their own list', async () => {
      const sea = await insertImage({
        createdAt: micro(1),
        title: 'Sea',
        tags: ['nature', 'water'],
      });
      const city = await insertImage({
        createdAt: micro(2),
        title: 'City lights',
        tags: ['urban'],
      });
      await insertImage({ organizationId: orgB, tags: ['nature', 'foreign'] });

      const v1 = (path) => call(handleResources, path);
      assert.deepEqual(
        (await v1('/api/v1/image-library?search=city')).body.images.map(
          (i) => i.id,
        ),
        [city],
      );
      assert.deepEqual(
        (await v1('/api/v1/image-library?search=WATER')).body.images.map(
          (i) => i.id,
        ),
        [sea],
      );
      assert.deepEqual(
        (await v1('/api/v1/image-library?category=Nature')).body.images.map(
          (i) => i.id,
        ),
        [sea],
      );
      const categories = await v1('/api/v1/image-library/categories');
      assert.equal(categories.status, 200);
      assert.deepEqual(categories.body.categories, [
        'nature',
        'urban',
        'water',
      ]);
    });

    it('v1 slide library: the trash is left out in the query, so every page is full', async () => {
      for (let i = 0; i < 12; i++) {
        await insertItem({
          createdAt: micro(i),
          trashedAt: i % 2 === 0 ? SAME_MOMENT : null,
        });
      }
      const pages = [];
      let cursor = null;
      do {
        const { status, body } = await call(
          handleV1SlideLibrary,
          `/api/v1/slide-library?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        assert.equal(status, 200);
        pages.push(body.items.map((it) => it.id));
        cursor = body.nextCursor;
      } while (cursor);
      assertWalk(
        pages,
        await contractOrder(
          'slide_library',
          sql`organization_id = ${orgA} AND shelf = 'organization' AND trashed_at IS NULL`,
        ),
        4,
        'v1',
      );
      assert.deepEqual(
        pages.map((p) => p.length),
        [4, 2],
      );
    });

    // ───────────────────────────── stability and isolation, every list

    it('3+4: a row added between pages does not move page 2, and a cursor from org A shows only B rows in B', async () => {
      const kinds = {
        organization: (org, createdAt) =>
          insertItem({ organizationId: org, createdAt }),
        collections: (org, createdAt) =>
          insertCollection({ organizationId: org, createdAt }),
        images: (org, createdAt) =>
          insertImage({ organizationId: org, createdAt }),
      };
      for (const [list, insert] of Object.entries(kinds)) {
        const { handler, path } = LISTS[list];
        const idsA = [];
        for (let i = 0; i < 6; i++) {
          idsA.push(await insert(orgA, `2026-09-${10 + i} 08:00:00+00`));
        }
        const idsB = [];
        for (const createdAt of [
          '2026-09-30 00:00:00+00',
          '2026-09-11 00:00:00+00',
          '2026-08-01 00:00:00+00',
        ]) {
          idsB.push(await insert(orgB, createdAt));
        }

        const first = await call(handler, withQuery(path, 'limit=2'));
        const page2 = withQuery(
          path,
          `limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        );
        const before = await call(handler, page2);
        await insert(orgA, '2026-10-22 09:00:00.000001+00');
        assert.deepEqual(
          (await call(handler, page2)).body,
          before.body,
          `${list}: page 2 stays`,
        );

        const inB = await call(
          handler,
          withQuery(
            path,
            `limit=100&cursor=${encodeURIComponent(first.body.nextCursor)}`,
          ),
          OWNER,
          orgB,
        );
        assert.equal(inB.status, 200);
        const seen = inB.body.items.map((row) => row.id);
        assert.ok(seen.length > 0, `${list}: the position applies`);
        for (const id of seen) {
          assert.ok(idsB.includes(id), `${list}: only B rows`);
          assert.ok(!idsA.includes(id), `${list}: never an A row`);
        }
      }
    });

    // ───────────────────────────── migration and plans

    it('migration 098 makes created_at NOT NULL, folds uploader addresses and adds the keyset indexes, idempotently', async () => {
      const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
      const INDEXES = [
        'idx_slide_library_list_keyset',
        'idx_slide_library_trash_keyset',
        'idx_slide_collections_list_keyset',
        'idx_image_library_list_keyset',
      ];
      const indexes = async () =>
        (
          await sql`SELECT indexname FROM pg_indexes WHERE indexname IN (${sql.join(INDEXES)})`.execute(
            db,
          )
        ).rows.length;
      const notNull = async (table) =>
        (
          await sql`SELECT is_nullable FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = 'created_at'`.execute(
            db,
          )
        ).rows[0].is_nullable === 'NO';
      try {
        await runInTx(migrate098Down);
        await runInTx(migrate098Down);
        assert.equal(await indexes(), 0);
        assert.equal(await notNull('image_library'), false);
        const legacy = await insertImage({
          uploadedBy: '  Owner@Example.COM ',
        });
        await sql`UPDATE image_library SET created_at = NULL WHERE id = ${legacy}`.execute(
          db,
        );
        await runInTx(migrate098Up);
        await runInTx(migrate098Up);
        assert.equal(await indexes(), 4);
        for (const table of [
          'slide_library',
          'slide_collections',
          'image_library',
        ]) {
          assert.equal(await notNull(table), true, table);
        }
        const row = await db
          .selectFrom('image_library')
          .select(['uploaded_by', 'created_at'])
          .where('id', '=', legacy)
          .executeTakeFirstOrThrow();
        assert.equal(row.uploaded_by, OWNER.email);
        assert.ok(row.created_at, 'a NULL creation time is backfilled');
      } finally {
        await runInTx(migrate098Up);
      }
    });

    it('each page query walks its keyset index without a sort (10 000 rows per list)', async () => {
      await sql`
        INSERT INTO slide_library (organization_id, shelf, owner_email, name, slide_type, created_at, trashed_at)
        SELECT CASE WHEN g % 10 = 0 THEN ${orgB}::uuid ELSE ${orgA}::uuid END,
          CASE WHEN g % 3 = 0 THEN 'personal' ELSE 'organization' END,
          CASE WHEN g % 3 = 0 THEN ${OWNER.email} END,
          'bulk', 'content-slide',
          timestamptz '2026-01-01' + (g * interval '1 minute'),
          CASE WHEN g % 4 = 0 THEN timestamptz '2026-06-01' + (g * interval '1 minute') END
        FROM generate_series(1, 20000) AS g
      `.execute(db);
      await sql`
        INSERT INTO slide_collections (organization_id, shelf, owner_email, name, created_at)
        SELECT CASE WHEN g % 10 = 0 THEN ${orgB}::uuid ELSE ${orgA}::uuid END,
          CASE WHEN g % 3 = 0 THEN 'personal' ELSE 'organization' END,
          CASE WHEN g % 3 = 0 THEN ${OWNER.email} END,
          'bulk', timestamptz '2026-01-01' + (g * interval '1 minute')
        FROM generate_series(1, 20000) AS g
      `.execute(db);
      await sql`
        INSERT INTO image_library (organization_id, url, created_at)
        SELECT CASE WHEN g % 10 = 0 THEN ${orgB}::uuid ELSE ${orgA}::uuid END,
          'https://example.com/bulk.png',
          timestamptz '2026-01-01' + (g * interval '1 minute')
        FROM generate_series(1, 20000) AS g
      `.execute(db);
      await sql`ANALYZE slide_library`.execute(db);
      await sql`ANALYZE slide_collections`.execute(db);
      await sql`ANALYZE image_library`.execute(db);

      const after = {
        value: '2026-01-04 00:00:00+00',
        id: crypto.randomUUID(),
      };
      const cases = [
        [
          'organization shelf',
          __libraryList.libraryListQuery(db, orgA, { shelf: 'organization' }),
          'created_at',
          /idx_slide_library_list_keyset/,
        ],
        [
          'personal shelf',
          __libraryList.libraryListQuery(db, orgA, {
            shelf: 'personal',
            ownerEmail: OWNER.email,
          }),
          'created_at',
          /idx_slide_library_list_keyset/,
        ],
        [
          'trash',
          __libraryList.libraryListQuery(db, orgA, {
            shelf: 'organization',
            trashed: true,
          }),
          'trashed_at',
          /idx_slide_library_trash_keyset/,
        ],
        [
          'collections',
          __collectionList.collectionListQuery(db, orgA, {
            shelf: 'organization',
          }),
          'created_at',
          /idx_slide_collections_list_keyset/,
        ],
        [
          'images',
          __imageList.imageListQuery(db, orgA, {}),
          'created_at',
          /idx_image_library_list_keyset/,
        ],
      ];
      const plans = {};
      for (const [label, qb, column, index] of cases) {
        const page = keysetPage(qb, { column, after, limit: 50 }).compile();
        const plan = await db.executeQuery(
          CompiledQuery.raw(`EXPLAIN ${page.sql}`, [...page.parameters]),
        );
        const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
        plans[label] = text;
        assert.match(text, index, `${label}\n${text}`);
        assert.doesNotMatch(text, /\bSort\b/, `${label}\n${text}`);
      }
      if (process.env.DECK_LIST_PRINT_PLANS) {
        console.log(
          Object.entries(plans)
            .map(([k, v]) => `-- ${k}\n${v}`)
            .join('\n\n'),
        );
      }
    });
  },
);

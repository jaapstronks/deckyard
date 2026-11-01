/**
 * Library provenance links and revision notifications (B904, D223) against
 * real PostgreSQL.
 *
 * A slide inserted from the library carries `libraryRef`; every deck write
 * rebuilds that deck's `slide_library_links` rows from it, and a new item
 * revision notifies the owner of each deck with an older copy, once per
 * (deck, item) however many revisions follow while it is unread.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  updatePresentation,
} from '../../server/storage/presentations/index.js';
import {
  createOrganizationLibraryItem,
  createPersonalLibraryItem,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';
import { listDecksBehindLibraryItem } from '../../server/storage/slide-library-links.js';
import { notifyLibraryItemRevision } from '../../server/services/library-revision-notifications.js';

const scope = testScope();
const MAKER = 'maker@example.com';
const OWNER = 'owner@example.com';

async function linkRows(db, presentationId) {
  return db
    .selectFrom('slide_library_links')
    .select(['slide_id', 'item_id', 'revision', 'ignored_revision'])
    .where('presentation_id', '=', presentationId)
    .orderBy('slide_id')
    .execute();
}

async function libraryNotices(db, email) {
  return db
    .selectFrom('user_notifications')
    .selectAll()
    .where('user_email', '=', email)
    .where('notification_type', '=', 'library_update')
    .execute();
}

/** Raise the item's revision the way the route does. */
async function revise(item, title) {
  const r = await updateOrganizationLibraryItem(
    scope,
    item.id,
    { content: { title } },
    {
      actorEmail: MAKER,
      expectedRevision: item.revision,
      allowEdit: () => true,
    },
  );
  assert.equal(r.ok, true);
  return r.item;
}

function linkedSlide(item, extra = {}) {
  return {
    type: 'content-slide',
    content: { title: 'Team' },
    libraryRef: { itemId: item.id, revision: item.revision },
    ...extra,
  };
}

pgDescribe('slide-library links (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let item;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_library', 'user_notifications', 'organizations');
    await seedDefaultOrganization(db);
    const created = await createOrganizationLibraryItem(
      scope,
      { name: 'Team', slideType: 'content-slide', content: { title: 'Team' } },
      { actorEmail: MAKER },
    );
    item = created.item;
  });

  it('a composed deck is linked from its first write, in every version', async () => {
    const pres = await createPresentation(scope, {
      title: 'Deck',
      ownerEmail: OWNER,
      lang: 'nl',
      slides: [
        {
          ...linkedSlide(item),
          contentByLang: { nl: { title: 'Team' }, 'en-GB': { title: 'Team' } },
        },
        { type: 'content-slide', content: { title: 'Own' } },
      ],
    });
    const stored = await getPresentation(scope, pres.id);
    const [first, second] = stored.slides;
    assert.deepEqual(first.libraryRef, { itemId: item.id, revision: 0 });
    assert.equal(second.libraryRef, undefined);
    assert.deepEqual(
      stored.i18n.versions['en-GB'].slides[0].libraryRef,
      first.libraryRef,
    );
    assert.deepEqual(await linkRows(db, pres.id), [
      {
        slide_id: first.id,
        item_id: item.id,
        revision: 0,
        ignored_revision: null,
      },
    ]);
  });

  it('a deck write rebuilds the rows; dropping the ref unlinks the slide', async () => {
    const pres = await createPresentation(scope, {
      title: 'Deck',
      ownerEmail: OWNER,
      slides: [linkedSlide(item)],
    });
    const stored = await getPresentation(scope, pres.id);
    const ignored = stored.slides.map((s) => ({
      ...s,
      libraryRef: { ...s.libraryRef, ignoredRevision: 3 },
    }));
    await updatePresentation(scope, pres.id, { slides: ignored });
    assert.equal((await linkRows(db, pres.id))[0].ignored_revision, 3);

    const unlinked = stored.slides.map(({ libraryRef: _ref, ...s }) => s);
    await updatePresentation(scope, pres.id, { slides: unlinked });
    assert.deepEqual(await linkRows(db, pres.id), []);
  });

  it('only live decks behind the revision, and not ignoring it, are listed', async () => {
    const behind = await createPresentation(scope, {
      title: 'Behind',
      ownerEmail: OWNER,
      slides: [linkedSlide(item)],
    });
    const trashed = await createPresentation(scope, {
      title: 'Trashed',
      ownerEmail: OWNER,
      slides: [linkedSlide(item)],
    });
    await deletePresentation(scope, trashed.id);
    const ignoring = await createPresentation(scope, {
      title: 'Ignoring',
      ownerEmail: OWNER,
      slides: [
        linkedSlide(item, {
          libraryRef: { itemId: item.id, revision: 0, ignoredRevision: 1 },
        }),
      ],
    });
    assert.ok(ignoring.id);

    assert.deepEqual(await listDecksBehindLibraryItem(scope, item.id, 0), []);
    const decks = await listDecksBehindLibraryItem(scope, item.id, 1);
    assert.deepEqual(
      decks.map((d) => d.presentationId),
      [behind.id],
    );
    assert.equal(decks[0].ownerEmail, OWNER);
    // The ignored revision silences that one only.
    const later = await listDecksBehindLibraryItem(scope, item.id, 2);
    assert.equal(later.length, 2);
  });

  it('two revisions give the owner one unread notification for the deck', async () => {
    const pres = await createPresentation(scope, {
      title: 'Quarterly',
      ownerEmail: OWNER,
      slides: [linkedSlide(item)],
    });
    const actor = { email: MAKER, name: 'Maker' };

    const r1 = await revise(item, 'Team v1');
    assert.equal(
      await notifyLibraryItemRevision({ scope, item: r1, actor }),
      1,
    );
    const r2 = await revise(r1, 'Team v2');
    assert.equal(
      await notifyLibraryItemRevision({ scope, item: r2, actor }),
      1,
    );

    const notices = await libraryNotices(db, OWNER);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].presentation_id, pres.id);
    assert.equal(notices[0].is_read, false);
    assert.equal(notices[0].data.itemId, item.id);
    assert.equal(notices[0].data.revision, 2);
    assert.match(notices[0].title, /"Team".*"Quarterly"/);
    assert.match(
      notices[0].action_url,
      new RegExp(`^/app/${pres.id}\\?slideId=`),
    );
  });

  it('the maker of a revision is not notified about their own deck', async () => {
    await createPresentation(scope, {
      title: 'Mine',
      ownerEmail: MAKER,
      slides: [linkedSlide(item)],
    });
    const r1 = await revise(item, 'Team v1');
    assert.equal(
      await notifyLibraryItemRevision({
        scope,
        item: r1,
        actor: { email: MAKER },
      }),
      0,
    );
    assert.deepEqual(await libraryNotices(db, MAKER), []);
  });

  it("someone else's personal item notifies nobody, whatever the ref says", async () => {
    const personal = (
      await createPersonalLibraryItem(
        scope,
        MAKER,
        {
          name: 'Private',
          slideType: 'content-slide',
          content: { title: 'P' },
        },
        { actorEmail: MAKER },
      )
    ).item;
    await createPresentation(scope, {
      title: 'Deck',
      ownerEmail: OWNER,
      slides: [linkedSlide(personal)],
    });
    const sent = await notifyLibraryItemRevision({
      scope,
      item: { ...personal, revision: personal.revision + 1 },
      actor: { email: MAKER },
    });
    assert.equal(sent, 0);
    assert.deepEqual(await libraryNotices(db, OWNER), []);
  });
});

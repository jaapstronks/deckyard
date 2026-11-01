/**
 * The thread on a shared library item (B906, D369) against real PostgreSQL.
 *
 * A member writes on a colleague's organization-shelf item, the maker hears
 * about it, and the thread is exactly as readable as the item: a personal
 * item of someone else, or an item in another organization, has no thread
 * the reader can see or write in.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
  createOrganizationLibraryItem,
  createPersonalLibraryItem,
  deleteOrganizationLibraryItem,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';
import {
  deleteLibraryItemMessage,
  listLibraryItemThread,
  postLibraryItemMessage,
} from '../../server/services/library-item-comments.js';

const scope = testScope();
const MAKER = {
  id: crypto.randomUUID(),
  email: 'maker@example.com',
  name: 'Maker',
};
const MEMBER = {
  id: crypto.randomUUID(),
  email: 'member@example.com',
  name: 'Member',
};
const OTHER = {
  id: crypto.randomUUID(),
  email: 'other@example.com',
  name: 'Other',
};
const ADMIN = {
  id: crypto.randomUUID(),
  email: 'admin@example.com',
  name: 'Admin',
  isAdmin: true,
};

async function notices(db, email) {
  return db
    .selectFrom('user_notifications')
    .selectAll()
    .where('user_email', '=', email)
    .where('notification_type', '=', 'library_comment')
    .execute();
}

/** Write a message the way the route does. */
async function post(actor, item, body) {
  return postLibraryItemMessage(scope, actor, { itemId: item.id, body });
}

/** The service notifies fire-and-forget; give the fan-out time to land. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

pgDescribe('library item thread (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let item;
  let orgId;

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
      'slide_library_comments',
      'slide_library',
      'user_notifications',
      'users',
      'organizations',
    );
    orgId = await seedDefaultOrganization(db);
    await db
      .insertInto('users')
      .values(
        [MAKER, MEMBER, OTHER, ADMIN].map((p) => ({
          id: p.id,
          organization_id: orgId,
          email: p.email,
          name: p.name,
          role: p.isAdmin ? 'admin' : 'user',
        })),
      )
      .execute();
    const created = await createOrganizationLibraryItem(
      scope,
      { name: 'Team', slideType: 'content-slide', content: { title: 'Team' } },
      { actorEmail: MAKER.email },
    );
    item = created.item;
  });

  it('a member writes on a shared item and the maker is notified', async () => {
    const message = await post(
      MEMBER,
      item,
      '  Jan is missing from the team.  ',
    );
    assert.equal(message.body, 'Jan is missing from the team.');
    assert.equal(message.author.id, MEMBER.id);
    assert.equal(message.author.displayName, 'Member');
    assert.equal(message.canDelete, true);
    assert.equal('authorEmail' in message, false);
    await settle();

    const [notice] = await notices(db, MAKER.email);
    assert.ok(notice, 'the maker has a notification');
    assert.equal(
      notice.action_url,
      `/app/slide-library/organization/${item.id}`,
    );
    assert.match(notice.title, /Member commented on "Team"/);
    assert.equal(notice.body, 'Jan is missing from the team.');
    assert.deepEqual(await notices(db, MEMBER.email), []);

    const thread = await listLibraryItemThread(scope, MAKER, item.id);
    assert.deepEqual(
      thread.map((m) => [m.body, m.canDelete]),
      [['Jan is missing from the team.', false]],
    );
  });

  it('a reply reaches the maker and every earlier writer, never the writer', async () => {
    for (const [actor, body] of [
      [MEMBER, 'First'],
      [MAKER, 'Thanks, fixing it'],
      [OTHER, 'Also Piet'],
    ]) {
      await post(actor, item, body);
      await settle();
    }
    assert.equal((await notices(db, MAKER.email)).length, 2);
    assert.equal((await notices(db, MEMBER.email)).length, 2);
    assert.equal((await notices(db, OTHER.email)).length, 0);
    const thread = await listLibraryItemThread(scope, MEMBER, item.id);
    assert.deepEqual(
      thread.map((m) => m.body),
      ['First', 'Thanks, fixing it', 'Also Piet'],
    );
  });

  it('the maker is found by user id after an address change', async () => {
    await db
      .updateTable('users')
      .set({ email: 'maker.new@example.com' })
      .where('id', '=', MAKER.id)
      .execute();
    await post(MEMBER, item, 'Hello');
    await settle();
    assert.equal((await notices(db, 'maker.new@example.com')).length, 1);
    assert.deepEqual(await notices(db, MAKER.email), []);
  });

  it("someone else's personal item has no thread for the reader", async () => {
    const personal = await createPersonalLibraryItem(
      scope,
      MAKER.email,
      { name: 'Mine', slideType: 'content-slide', content: { title: 'Mine' } },
      { actorEmail: MAKER.email },
    );
    await assert.rejects(
      listLibraryItemThread(scope, MEMBER, personal.item.id),
      { statusCode: 404 },
    );
    await assert.rejects(post(MEMBER, personal.item, 'Hi'), {
      statusCode: 404,
    });
    // Not even its owner: a personal item has one reader, and no thread.
    await assert.rejects(
      listLibraryItemThread(scope, MAKER, personal.item.id),
      { statusCode: 404 },
    );
  });

  it('an item in another organization is not found, and its thread stays unseen', async () => {
    await post(MEMBER, item, 'Internal remark');
    const otherOrg = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other Org', slug: 'other-org' })
      .execute();
    const outsiderScope = { repoRoot: null, organizationId: otherOrg };
    const outsider = { id: crypto.randomUUID(), email: 'out@example.com' };
    await assert.rejects(
      listLibraryItemThread(outsiderScope, outsider, item.id),
      { statusCode: 404 },
    );
    await assert.rejects(
      postLibraryItemMessage(outsiderScope, outsider, {
        itemId: item.id,
        body: 'x',
      }),
      { statusCode: 404 },
    );
    const [message] = await listLibraryItemThread(scope, MEMBER, item.id);
    await assert.rejects(
      deleteLibraryItemMessage(
        outsiderScope,
        { ...outsider, isAdmin: true },
        {
          itemId: item.id,
          messageId: message.id,
        },
      ),
      { statusCode: 404 },
    );
  });

  it('only the author or an admin deletes a message', async () => {
    const message = await post(MEMBER, item, 'Typo');
    await assert.rejects(
      deleteLibraryItemMessage(scope, MAKER, {
        itemId: item.id,
        messageId: message.id,
      }),
      { statusCode: 403 },
    );
    await deleteLibraryItemMessage(scope, MEMBER, {
      itemId: item.id,
      messageId: message.id,
    });
    const second = await post(MEMBER, item, 'Again');
    await deleteLibraryItemMessage(scope, ADMIN, {
      itemId: item.id,
      messageId: second.id,
    });
    assert.deepEqual(await listLibraryItemThread(scope, MEMBER, item.id), []);
  });

  it('a message id names a message on this item only', async () => {
    const message = await post(MEMBER, item, 'On Team');
    const other = await createOrganizationLibraryItem(
      scope,
      { name: 'Agenda', slideType: 'content-slide', content: { title: 'A' } },
      { actorEmail: MAKER.email },
    );
    await assert.rejects(
      deleteLibraryItemMessage(scope, ADMIN, {
        itemId: other.item.id,
        messageId: message.id,
      }),
      { statusCode: 404 },
    );
  });

  it('a trashed item keeps its thread readable but takes no new message', async () => {
    await post(MEMBER, item, 'Before');
    const r = await updateOrganizationLibraryItem(
      scope,
      item.id,
      { trashed: true },
      { actorEmail: MAKER.email, allowEdit: () => true },
    );
    assert.equal(r.ok, true);
    assert.equal(
      (await listLibraryItemThread(scope, MEMBER, item.id)).length,
      1,
    );
    await assert.rejects(post(MEMBER, item, 'After'), { statusCode: 409 });
  });

  it('deleting the item deletes its thread', async () => {
    await post(MEMBER, item, 'Gone soon');
    await updateOrganizationLibraryItem(
      scope,
      item.id,
      { trashed: true },
      { actorEmail: MAKER.email, allowEdit: () => true },
    );
    const r = await deleteOrganizationLibraryItem(scope, item.id, {
      allowDelete: () => true,
    });
    assert.equal(r.ok, true);
    const rows = await db
      .selectFrom('slide_library_comments')
      .selectAll()
      .execute();
    assert.deepEqual(rows, []);
  });

  it('an empty or oversized body is refused', async () => {
    await assert.rejects(post(MEMBER, item, '   '), { statusCode: 400 });
    await assert.rejects(post(MEMBER, item, 'x'.repeat(5001)), {
      statusCode: 400,
    });
  });
});

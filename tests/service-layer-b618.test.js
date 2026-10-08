/**
 * B618: the cross-deck recent comments read the actor's deck list. MCP
 * `list_recent_comments` used to build its own deck set
 * (`listAccessiblePresentationRefs`): `owned` was a bare e-mail comparison on
 * the owner column, so a deck the actor made but no longer owns was left out,
 * `all` skipped every organization-visible deck, and `collection` did not
 * exist. Now the comment service asks `listPresentationsForActor` for the deck
 * set, the one list every contract reads (B607, D317): the same four
 * `ownership` values, matched on `users.id` and maker, and a value outside
 * them is a 400 `invalid` naming the field.
 *
 * The store: OWNER's deck, a deck OWNER made that STRANGER owns, STRANGER's
 * deck shared with OWNER, STRANGER's organization deck and STRANGER's private
 * deck. Each carries one comment, so the deck set reads off the comment ids.
 *
 * Handler-import level against the database double, like
 * tests/service-layer-b607.test.js.
 *
 * Run with: node --test tests/service-layer-b618.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b618']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const STRANGER_EMAIL = 'stranger@example.com';

const OWN = 'd0000618-0000-4000-8000-000000000001';
const MADE = 'd0000618-0000-4000-8000-000000000002';
const SHARED = 'd0000618-0000-4000-8000-000000000003';
const ORG_DECK = 'd0000618-0000-4000-8000-000000000004';
const HIDDEN = 'd0000618-0000-4000-8000-000000000005';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

function deckRow({ id, owner, creator = owner, visibility = 'private' }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: creator,
    updated_by: creator,
    owner_user_id: userIdFor(owner),
    created_by_user_id: userIdFor(creator),
    updated_by_user_id: userIdFor(creator),
    title: `Deck ${id.slice(-1)}`,
    description: null,
    theme: null,
    lang: 'en',
    visibility,
    is_view_only: false,
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      { id: 'slide-1', type: 'title-slide', content: {}, parentId: null },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-08-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/** One open top-level comment on `deck`, its id `c-<deck>`. */
function commentRow(deck, createdAt) {
  return {
    id: `c-${deck}`,
    presentation_id: deck,
    organization_id: ORG,
    slide_id: 'slide-1',
    parent_id: null,
    author_email: 'reviewer@example.com',
    author_name: 'Reviewer',
    body: 'Looks good',
    status: 'open',
    resolved_by: null,
    resolved_at: null,
    position_x: null,
    position_y: null,
    comment_type: 'human',
    suggestion_category: null,
    proposed_slide: null,
    slide_snapshot: null,
    mentions: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, STRANGER_EMAIL),
    presentations: [
      deckRow({ id: OWN, owner: OWNER_EMAIL }),
      deckRow({ id: MADE, owner: STRANGER_EMAIL, creator: OWNER_EMAIL }),
      deckRow({ id: SHARED, owner: STRANGER_EMAIL }),
      deckRow({
        id: ORG_DECK,
        owner: STRANGER_EMAIL,
        visibility: 'organization',
      }),
      deckRow({ id: HIDDEN, owner: STRANGER_EMAIL }),
    ],
    presentation_collaborators: [
      {
        id: 'collab-1',
        presentation_id: SHARED,
        organization_id: ORG,
        user_email: OWNER_EMAIL,
        user_id: null,
        permission: 'comment',
        invited_by: STRANGER_EMAIL,
        invited_at: '2026-08-05T00:00:00.000Z',
        accepted_at: '2026-08-05T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-08-05T00:00:00.000Z',
      },
    ],
    presentation_comments: [
      commentRow(OWN, '2026-08-05T00:00:00.000Z'),
      commentRow(MADE, '2026-08-04T00:00:00.000Z'),
      commentRow(SHARED, '2026-08-03T00:00:00.000Z'),
      commentRow(ORG_DECK, '2026-08-02T00:00:00.000Z'),
      commentRow(HIDDEN, '2026-08-01T00:00:00.000Z'),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/** Call an MCP tool as a session owned by `ownerEmail` (none: stdio operator). */
function mcp(tool, args, ownerEmail) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: ownerEmail });
  return server.tools
    .get(tool)
    .handler(args, { ownerEmail, organizationId: ORG });
}

/** The decks the recent comments came from, newest comment first. */
async function decksOf(args, ownerEmail = OWNER_EMAIL) {
  const { comments } = await mcp('list_recent_comments', args, ownerEmail);
  return comments.map((c) => c.presentationId);
}

test('MCP list_recent_comments reads the deck list under each ownership value', async () => {
  await installDb();

  // `owned` matches on users.id and maker: the deck OWNER made counts, though
  // its owner column names someone else.
  assert.deepEqual(await decksOf({ ownership: 'owned' }), [OWN, MADE]);
  assert.deepEqual(await decksOf({ ownership: 'collection' }), [
    OWN,
    MADE,
    ORG_DECK,
  ]);
  assert.deepEqual(await decksOf({ ownership: 'shared' }), [SHARED]);
  // `all` (the default) is every deck the actor can open, organization decks
  // included; a private deck nobody shared stays out.
  const all = [OWN, MADE, SHARED, ORG_DECK];
  assert.deepEqual(await decksOf({ ownership: 'all' }), all);
  assert.deepEqual(await decksOf({}), all);
});

test('MCP list_recent_comments: the session address matches whatever its case', async () => {
  await installDb();
  assert.deepEqual(await decksOf({ ownership: 'owned' }, 'Owner@Example.com'), [
    OWN,
    MADE,
  ]);
});

test('MCP list_recent_comments: the auth-off operator reads every deck', async () => {
  await installDb();
  assert.deepEqual(await decksOf({ ownership: 'owned' }, null), [
    OWN,
    MADE,
    SHARED,
    ORG_DECK,
    HIDDEN,
  ]);
});

test('MCP list_recent_comments refuses an ownership outside the vocabulary', async () => {
  await installDb();
  await assert.rejects(
    mcp('list_recent_comments', { ownership: 'everyone' }, OWNER_EMAIL),
    (err) => err.code === 'invalid' && err.details?.field === 'ownership',
  );
});

test('MCP list_recent_comments declares the four ownership values', () => {
  const server = new McpServer();
  registerTools(server, {});
  const { enum: values } = server.tools.get('list_recent_comments').inputSchema
    .properties.ownership;
  assert.deepEqual([...values].sort(), [
    'all',
    'collection',
    'owned',
    'shared',
  ]);
});

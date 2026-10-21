/**
 * MCP collaborator tools — private sharing with a colleague (B807).
 *
 * `list_collaborators` and `add_collaborator` give an agent the editor's share
 * dialog, not a way around it: the same service (`server/services/
 * collaborators.js`), the same `manage` right on the deck, the same
 * organization boundary and identity lookup, with the MCP session owner as
 * the actor. What this file pins:
 *
 * - the owner, and an `admin` collaborator as the permission model allows,
 *   give an existing colleague `edit`; reading back shows that permission;
 * - an actor without the `manage` right, a deck in another organization, an
 *   invitee outside the organization and an unknown address are refused, and
 *   the refusal is a tool error that writes nothing;
 * - the API key's owner lends the acting user nothing: a session acting as
 *   an editor is refused even when the key belongs to the deck owner;
 * - an identical repeat changes nothing and announces nothing twice; a
 *   different permission for an existing collaborator is refused, not
 *   applied;
 * - sharing privately leaves the deck private and creates no share link;
 * - the invite mail goes out only with `sendInvitation: true`;
 * - discovery hides the tools from a key without their scope.
 *
 * Every person, deck and address is synthetic; the Brevo endpoint is a stub
 * that records calls and never reaches the network.
 *
 * Run with: node --test tests/mcp/mcp-collaborator-tools.test.js
 */

import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage } = await import('../../server/db/lifecycle.js');
const { McpServer } = await import('../../server/mcp/protocol.js');
const { registerTools } = await import('../../server/mcp/tools.js');
const { invalidatePermission } =
  await import('../../server/storage/cache/permission-cache.js');
const { resetRateLimitBuckets } =
  await import('../../server/utils/rate-limit.js');
const { BREVO_API_URL } =
  await import('../../server/integrations/email/core.js');

const DECK = {
  owned: '0000d0c0-0000-4000-8000-0000000000b1',
  foreign: '0000d0c0-0000-4000-8000-0000000000b2',
};

/** @param {string} email @param {string} name @param {string} org */
function person(email, name, org = ORG) {
  return { id: `user-${email.split('@')[0]}`, email, name, org };
}

const P = {
  owner: person('owner@example.test', 'Olive'),
  admin: person('admin@example.test', 'Ada'),
  editor: person('editor@example.test', 'Ed'),
  colleague: person('colleague@example.test', 'Cora'),
  outsider: person('outsider@other.example.test', 'Otto', OTHER_ORG),
};

const ALL_SCOPES = [
  'read',
  'write',
  'collaborators:read',
  'collaborators:write',
];

/** @type {ReturnType<typeof createFakeDb>} */
let db;
/** @type {Array<{to: string}>} */
let mails;
const realFetch = globalThis.fetch;

function userRow(p) {
  return {
    id: p.id,
    organization_id: p.org,
    email: p.email,
    name: p.name,
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function deckRow(id, owner, org = ORG) {
  return {
    id,
    organization_id: org,
    title: `Deck ${id.slice(-2)}`,
    owner_email: owner.email,
    created_by: owner.email,
    updated_by: owner.email,
    owner_user_id: owner.id,
    created_by_user_id: owner.id,
    updated_by_user_id: owner.id,
    visibility: 'private',
    theme: 'default',
    lang: 'en',
    revision: 1,
    is_view_only: false,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'Hi' } }],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
  };
}

function collaboratorRow(id, p, permission) {
  return {
    id,
    organization_id: ORG,
    presentation_id: DECK.owned,
    user_email: p.email,
    user_id: p.id,
    permission,
    invited_by: P.owner.email,
    invited_at: '2026-02-01T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
  };
}

before(async () => {
  // A configured key so a requested invite mail reaches the (stubbed) wire.
  process.env.BREVO_API_KEY = 'synthetic-test-key';
  globalThis.fetch = async (url, init) => {
    if (String(url) === BREVO_API_URL) {
      mails.push({ to: JSON.parse(init.body).to[0].email });
      return new Response(JSON.stringify({ messageId: 'synthetic' }), {
        status: 201,
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  __setTestDb(createFakeDb({}));
  await initializeStorage();
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.BREVO_API_KEY;
  __setTestDb(null);
});

beforeEach(async () => {
  mails = [];
  resetRateLimitBuckets();
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(P).map(userRow),
    presentations: [
      deckRow(DECK.owned, P.owner),
      deckRow(DECK.foreign, P.outsider, OTHER_ORG),
    ],
    presentation_collaborators: [
      collaboratorRow('c-admin', P.admin, 'admin'),
      collaboratorRow('c-editor', P.editor, 'edit'),
    ],
    presentation_share_links: [],
    user_notifications: [],
    activity_events: [],
    auth_audit_log: [],
    app_settings: [],
    api_usage_daily: [],
  });
  __setTestDb(db);
  for (const deck of Object.values(DECK)) {
    for (const p of Object.values(P)) await invalidatePermission(deck, p.email);
  }
});

/**
 * A keyed (SSE) session: acting as `as`, with a key owned by `keyOwner`.
 * The fork's `X-On-Behalf-Of` lands here as the session owner; the key's own
 * owner is a different person on purpose where a test says so.
 */
function session(as, { keyOwner = as, scopes = ALL_SCOPES } = {}) {
  return {
    ownerEmail: as.email,
    organizationId: as.org,
    apiKey: {
      id: `key-${keyOwner.id}`,
      tier: 'enterprise',
      ownerEmail: keyOwner.email,
      permissions: scopes,
    },
  };
}

function buildServer() {
  const server = new McpServer();
  registerTools(server, {});
  return server;
}

/**
 * Call a tool and unwrap the result.
 * @returns {Promise<{isError: boolean, text: string, data: Object|null}>}
 */
async function callTool(name, args, context) {
  const raw = await buildServer().handleMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    context,
  );
  const result = JSON.parse(raw).result;
  const text = result?.content?.[0]?.text || '';
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // An error result is prose, not JSON.
    data = null;
  }
  return { isError: result?.isError === true, text, data };
}

/** Let fire-and-forget work (the invite mail) settle. */
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}

function activeRows(email) {
  return db.__tables.presentation_collaborators.filter(
    (r) => r.user_email === email && !r.revoked_at,
  );
}

function share(as, args, opts) {
  return callTool(
    'add_collaborator',
    { presentationId: DECK.owned, userEmail: P.colleague.email, ...args },
    session(as, opts),
  );
}

describe('add_collaborator — who may share', () => {
  test('the owner gives an existing colleague edit, and reading back shows it', async () => {
    const res = await share(P.owner, { permission: 'edit' });

    assert.equal(res.isError, false, res.text);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.status, 'added');
    assert.equal(res.data.collaborator.email, P.colleague.email);
    assert.equal(res.data.collaborator.permission, 'edit');
    assert.equal(res.data.collaborator.invitedBy, P.owner.email);
    assert.equal(res.data.collaborator.name, 'Cora');
    assert.equal(activeRows(P.colleague.email).length, 1);

    const list = await callTool(
      'list_collaborators',
      { presentationId: DECK.owned },
      session(P.owner),
    );
    assert.equal(list.isError, false, list.text);
    const colleague = list.data.collaborators.find(
      (c) => c.email === P.colleague.email,
    );
    assert.deepEqual(
      { permission: colleague.permission, name: colleague.name },
      { permission: 'edit', name: 'Cora' },
    );
  });

  test('an admin collaborator may share, as the permission model allows', async () => {
    const res = await share(P.admin, { permission: 'edit' });
    assert.equal(res.isError, false, res.text);
    assert.equal(res.data.collaborator.invitedBy, P.admin.email);
  });

  test('an edit collaborator may not share, and nothing is written', async () => {
    const res = await share(P.editor, { permission: 'edit' });
    assert.equal(res.isError, true);
    assert.equal(res.data?.ok, undefined, 'no success is claimed');
    assert.equal(activeRows(P.colleague.email).length, 0);
    assert.equal(db.__tables.user_notifications.length, 0);
  });

  test('the key owner lends the acting user nothing', async () => {
    // The key belongs to the deck owner, the session acts as the editor
    // (X-On-Behalf-Of in the fork): the editor's rights decide.
    const res = await share(
      P.editor,
      { permission: 'edit' },
      { keyOwner: P.owner },
    );
    assert.equal(res.isError, true);
    assert.equal(activeRows(P.colleague.email).length, 0);
  });

  test('a deck in another organization is absent', async () => {
    const res = await callTool(
      'add_collaborator',
      {
        presentationId: DECK.foreign,
        userEmail: P.colleague.email,
        permission: 'edit',
      },
      session(P.owner),
    );
    assert.equal(res.isError, true);
    assert.match(res.text, /not found/i);
    assert.equal(
      db.__tables.presentation_collaborators.filter(
        (r) => r.presentation_id === DECK.foreign,
      ).length,
      0,
    );
  });

  test('a person outside the organization is refused, not invited', async () => {
    const res = await share(P.owner, {
      userEmail: P.outsider.email,
      permission: 'edit',
    });
    assert.equal(res.isError, true);
    assert.match(res.text, /No member of this organization/);
    assert.equal(activeRows(P.outsider.email).length, 0);
  });

  test('an unknown address is refused, not invited', async () => {
    const res = await share(P.owner, {
      userEmail: 'nobody@example.test',
      permission: 'edit',
    });
    assert.equal(res.isError, true);
    assert.equal(activeRows('nobody@example.test').length, 0);
    assert.equal(db.__tables.user_notifications.length, 0);
  });

  test('an unsupported permission is refused', async () => {
    const res = await share(P.owner, { permission: 'owner' });
    assert.equal(res.isError, true);
    assert.match(res.text, /Invalid permission/);
    assert.equal(activeRows(P.colleague.email).length, 0);
  });

  test('a session without an acting user cannot share', async () => {
    const raw = await buildServer().handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'add_collaborator',
        arguments: {
          presentationId: DECK.owned,
          userEmail: P.colleague.email,
          permission: 'edit',
        },
      },
    });
    const result = JSON.parse(raw).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /acting user email/);
  });
});

describe('add_collaborator — repeats and existing access', () => {
  test('an identical repeat changes nothing and announces nothing twice', async () => {
    await share(P.owner, { permission: 'edit' });
    const again = await share(P.owner, {
      permission: 'edit',
      sendInvitation: true,
    });

    assert.equal(again.isError, false, again.text);
    assert.equal(again.data.status, 'unchanged');
    assert.equal(again.data.collaborator.permission, 'edit');
    // Even when asked for: an unchanged grant sends no mail.
    assert.equal(again.data.invitationEmail, 'not_sent');
    assert.equal(activeRows(P.colleague.email).length, 1);
    assert.equal(
      db.__tables.user_notifications.filter(
        (n) => n.user_email === P.colleague.email,
      ).length,
      1,
    );
    assert.equal(
      db.__tables.activity_events.filter(
        (e) => e.event_type === 'collaborator.added',
      ).length,
      1,
    );
  });

  test('a different permission for an existing collaborator is refused, not applied', async () => {
    const res = await callTool(
      'add_collaborator',
      {
        presentationId: DECK.owned,
        userEmail: P.editor.email,
        permission: 'view',
      },
      session(P.owner),
    );
    assert.equal(res.isError, true);
    assert.match(res.text, /already has edit access/);
    assert.equal(activeRows(P.editor.email)[0].permission, 'edit');
  });
});

describe('add_collaborator — private stays private', () => {
  test('sharing leaves the deck private and creates no share link', async () => {
    await share(P.owner, { permission: 'edit' });
    const deck = db.__tables.presentations.find((p) => p.id === DECK.owned);
    assert.equal(deck.visibility, 'private');
    assert.equal(db.__tables.presentation_share_links.length, 0);
  });

  test('without sendInvitation no mail goes out; the in-app notice does', async () => {
    const res = await share(P.owner, { permission: 'comment' });
    await settle();
    assert.equal(res.data.invitationEmail, 'not_requested');
    assert.deepEqual(mails, []);
    const notice = db.__tables.user_notifications.find(
      (n) => n.user_email === P.colleague.email,
    );
    assert.equal(notice.notification_type, 'share_received');
  });

  test('sendInvitation: true sends exactly one mail, to the invitee', async () => {
    const res = await share(P.owner, {
      permission: 'edit',
      sendInvitation: true,
    });
    await settle();
    assert.equal(res.data.invitationEmail, 'queued');
    assert.deepEqual(mails, [{ to: P.colleague.email }]);
  });
});

describe('list_collaborators', () => {
  test('an actor who may not manage the deck cannot read its access list', async () => {
    const res = await callTool(
      'list_collaborators',
      { presentationId: DECK.owned },
      session(P.editor),
    );
    assert.equal(res.isError, true);
    assert.equal(res.data?.collaborators, undefined);
  });
});

describe('discovery and key scopes', () => {
  async function listed(scopes) {
    const raw = await buildServer().handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      session(P.owner, { scopes }),
    );
    return JSON.parse(raw).result.tools.map((t) => t.name);
  }

  test('a key without the collaborator scopes is not offered the tools', async () => {
    const names = await listed(['read', 'write']);
    assert.ok(!names.includes('add_collaborator'));
    assert.ok(!names.includes('list_collaborators'));
  });

  test('collaborators:read offers reading only', async () => {
    const names = await listed(['collaborators:read']);
    assert.ok(names.includes('list_collaborators'));
    assert.ok(!names.includes('add_collaborator'));
  });

  test('a call without the scope is refused before anything is written', async () => {
    const res = await share(
      P.owner,
      { permission: 'edit' },
      { scopes: ['read', 'write', 'collaborators:read'] },
    );
    assert.equal(res.isError, true);
    assert.match(res.text, /lacks required permission: collaborators:write/);
    assert.equal(activeRows(P.colleague.email).length, 0);
  });
});

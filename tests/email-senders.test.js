/**
 * What lands in someone's inbox (B151).
 *
 * The auth and collaboration senders decide three things nobody downstream can
 * correct: **who** the mail goes to, **which body** gets used (an admin's
 * override or the code default), and **in which language**. Fourteen modules
 * under `server/integrations/email*` had two of them under test, and none of
 * these three decisions.
 *
 * The fake transport here is `fetch` itself — the one seam `core.js` actually
 * has (`POST https://api.brevo.com/v3/smtp/email`). Stubbing that instead of
 * stubbing `sendEmail` means the assertions read the payload Brevo would
 * receive, so a sender that drops a recipient or a subject on the floor between
 * the template and the wire is still caught.
 *
 * Shapes asserted here are specified in `docs/reference/email-infrastructure.md`
 * § Flows.
 *
 * Run with: node --test tests/email-senders.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@deckyard.test';
process.env.BREVO_SENDER_NAME = 'Deckyard Test';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { BREVO_API_URL } = await import('../server/integrations/email/core.js');
const { sendPasswordResetEmail, sendMagicLinkEmail, sendUserInvitationEmail } =
  await import('../server/integrations/email/senders-auth.js');
const { sendCollaboratorInviteEmail, sendGuestInvitationEmail } =
  await import('../server/integrations/email/senders-collaboration.js');

// A repoRoot is what switches the override lookup on; the value is only ever
// passed to the storage scope, so any non-empty string does.
const REPO_ROOT = '/repo';

/**
 * Install the fake transport for one send and return the Brevo payload.
 * Also returns the sender's own result so "not configured" stays assertable.
 */
async function capture(send) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 201,
      text: async () => '',
      json: async () => ({ messageId: '<test>' }),
    };
  };
  try {
    const result = await send();
    return {
      result,
      calls,
      payload: calls[0] ? JSON.parse(calls[0].init.body) : null,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Seed the override store; `rows` are `{ type, locale, fields }`.
 * @returns {Object} the double, whose `__queryLog` records every table touched.
 */
function seedTemplates(rows = []) {
  const db = createFakeDb({
    email_templates: rows.map((row) => ({
      ...row,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Who it goes to
// ---------------------------------------------------------------------------

test('the recipient is the address the caller handed in, and only that one', async () => {
  seedTemplates();

  const { calls, payload } = await capture(() =>
    sendPasswordResetEmail({
      recipientEmail: 'alice@example.com',
      recipientName: 'Alice',
      resetUrl: 'https://deckyard.test/reset?token=abc',
    }),
  );

  assert.equal(calls.length, 1, 'exactly one send');
  assert.equal(calls[0].url, BREVO_API_URL);
  assert.deepEqual(payload.to, [{ email: 'alice@example.com', name: 'Alice' }]);
});

test('a nameless recipient sends no name field rather than an empty one', async () => {
  // sendMagicLinkEmail takes no recipientName at all; core.js must omit the
  // key instead of sending `name: ""`, which Brevo would display.
  const { payload } = await capture(() =>
    sendMagicLinkEmail({
      recipientEmail: 'bob@example.com',
      magicLinkUrl: 'https://deckyard.test/magic?token=xyz',
    }),
  );

  assert.deepEqual(payload.to, [{ email: 'bob@example.com' }]);
});

test('the sender identity comes from the env fallbacks when settings carry none', async () => {
  const { payload } = await capture(() =>
    sendGuestInvitationEmail({
      recipientEmail: 'guest@example.com',
      presentationTitle: 'Q3 review',
      shareUrl: 'https://deckyard.test/s/tok',
      inviterName: 'Alice',
    }),
  );

  assert.deepEqual(payload.sender, {
    email: 'noreply@deckyard.test',
    name: 'Deckyard Test',
  });
});

test('without an API key nothing is attempted and the reason says so', async () => {
  const key = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    const { calls, result } = await capture(() =>
      sendPasswordResetEmail({
        recipientEmail: 'alice@example.com',
        resetUrl: 'https://deckyard.test/reset?token=abc',
      }),
    );
    assert.equal(calls.length, 0, 'no request goes out');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_configured');
  } finally {
    process.env.BREVO_API_KEY = key;
  }
});

// ---------------------------------------------------------------------------
// Which body
// ---------------------------------------------------------------------------

test('with no repoRoot the code default is used and the store is never read', async () => {
  // An override exists and still must not be reached: `repoRoot` is what
  // switches the lookup on, and a sender that reads config without one would
  // be resolving instance settings on a path that has no place to get them.
  const db = seedTemplates([
    {
      type: 'passwordReset',
      locale: 'en',
      fields: { subject: 'Custom subject' },
    },
  ]);

  const { payload } = await capture(() =>
    sendPasswordResetEmail({
      recipientEmail: 'alice@example.com',
      resetUrl: 'https://deckyard.test/reset?token=abc',
    }),
  );

  assert.equal(payload.subject, 'Reset your password');
  assert.deepEqual(db.__queryLog, [], 'no query at all without a repoRoot');
});

test('an admin override replaces the code default for that type and locale', async () => {
  seedTemplates([
    {
      type: 'passwordReset',
      locale: 'en',
      fields: {
        subject: 'Your {name} reset link',
        greeting: 'Hello {name},',
        body: 'Use the button.',
        buttonLabel: 'Reset now',
        footer: 'Expires soon.',
      },
    },
  ]);

  const { payload } = await capture(() =>
    sendPasswordResetEmail({
      recipientEmail: 'alice@example.com',
      recipientName: 'Alice',
      resetUrl: 'https://deckyard.test/reset?token=abc',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.equal(payload.subject, 'Your Alice reset link');
  assert.match(payload.htmlContent, /Hello Alice,/);
  assert.match(payload.htmlContent, /Reset now/);
  assert.match(
    payload.htmlContent,
    /https:\/\/deckyard\.test\/reset\?token=abc/,
    'the action URL survives into the custom body',
  );
});

test('an override on one type leaves the other types on their defaults', async () => {
  seedTemplates([
    { type: 'passwordReset', locale: 'en', fields: { subject: 'Overridden' } },
  ]);

  const { payload } = await capture(() =>
    sendMagicLinkEmail({
      recipientEmail: 'bob@example.com',
      magicLinkUrl: 'https://deckyard.test/magic?token=xyz',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.equal(payload.subject, 'Your sign-in link');
});

test('a partial override inherits the fields it does not set', async () => {
  seedTemplates([
    {
      type: 'userInvitation',
      locale: 'en',
      fields: { subject: 'Join us, {name}' },
    },
  ]);

  const { payload } = await capture(() =>
    sendUserInvitationEmail({
      recipientEmail: 'carol@example.com',
      recipientName: 'Carol',
      invitedBy: 'Alice',
      setupUrl: 'https://deckyard.test/setup?token=t',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.equal(payload.subject, 'Join us, Carol');
  assert.match(
    payload.htmlContent,
    /https:\/\/deckyard\.test\/setup\?token=t/,
    'the inherited body still carries the action URL',
  );
});

test('a custom subject is plain text, entity-free, like the code defaults', () => {
  // The default senders build subjects through the translator, which escapes
  // nothing — a Brevo `subject` is a header, not markup. The override path has
  // to match, or the same deck reads `Q3 &amp; Q4` only when an admin has
  // customized the template.
  seedTemplates([
    {
      type: 'collaboratorInvite',
      locale: 'en',
      fields: { subject: '{inviter} shared "{presTitle}"' },
    },
  ]);

  return capture(() =>
    sendCollaboratorInviteEmail({
      recipientEmail: 'dave@example.com',
      presentationTitle: 'Q3 & Q4',
      inviterName: "O'Brien",
      permission: 'view',
      editUrl: 'https://deckyard.test/app/deck-1',
      repoRoot: REPO_ROOT,
    }),
  ).then(({ payload }) => {
    assert.equal(payload.subject, 'O\'Brien shared "Q3 & Q4"');
  });
});

// ---------------------------------------------------------------------------
// In which language
// ---------------------------------------------------------------------------

test('the locale picks the code default translation', async () => {
  seedTemplates();

  const { payload } = await capture(() =>
    sendPasswordResetEmail({
      recipientEmail: 'alice@example.com',
      resetUrl: 'https://deckyard.test/reset?token=abc',
      locale: 'nl',
    }),
  );

  assert.equal(payload.subject, 'Wachtwoord opnieuw instellen');
});

test('the locale picks the matching override, not the default-locale one', async () => {
  seedTemplates([
    { type: 'magicLink', locale: 'en', fields: { subject: 'English one' } },
    { type: 'magicLink', locale: 'nl', fields: { subject: 'Nederlandse' } },
  ]);

  const { payload } = await capture(() =>
    sendMagicLinkEmail({
      recipientEmail: 'bob@example.com',
      magicLinkUrl: 'https://deckyard.test/magic?token=xyz',
      locale: 'nl',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.equal(payload.subject, 'Nederlandse');
});

test('an unsupported locale falls back to en rather than sending nothing', async () => {
  seedTemplates([
    { type: 'magicLink', locale: 'en', fields: { subject: 'English one' } },
  ]);

  const { payload } = await capture(() =>
    sendMagicLinkEmail({
      recipientEmail: 'bob@example.com',
      magicLinkUrl: 'https://deckyard.test/magic?token=xyz',
      locale: 'kl',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.equal(payload.subject, 'English one');
});

// ---------------------------------------------------------------------------
// The collaboration family carries its own variables
// ---------------------------------------------------------------------------

test('the collaborator invite names the deck, the inviter and the access level', async () => {
  const { payload } = await capture(() =>
    sendCollaboratorInviteEmail({
      recipientEmail: 'dave@example.com',
      recipientName: 'Dave',
      presentationTitle: 'Q3 review',
      inviterName: 'Alice',
      permission: 'comment',
      editUrl: 'https://deckyard.test/app/deck-1',
    }),
  );

  assert.equal(payload.subject, 'Alice shared "Q3 review" with you');
  assert.match(payload.htmlContent, /https:\/\/deckyard\.test\/app\/deck-1/);
});

test('the permission the invite announces is the one that was granted', async () => {
  seedTemplates([
    {
      type: 'collaboratorInvite',
      locale: 'en',
      fields: {
        subject: 'Shared',
        body: 'You may {permission} it ({accessLevel}).',
        buttonLabel: 'Open',
      },
    },
  ]);

  const { payload } = await capture(() =>
    sendCollaboratorInviteEmail({
      recipientEmail: 'dave@example.com',
      presentationTitle: 'Q3 review',
      inviterName: 'Alice',
      permission: 'view',
      editUrl: 'https://deckyard.test/app/deck-1',
      repoRoot: REPO_ROOT,
    }),
  );

  assert.match(payload.htmlContent, /You may view it \(view access\)\./);
  assert.doesNotMatch(
    payload.htmlContent,
    /full editing access/,
    'a view invite never advertises edit',
  );
});

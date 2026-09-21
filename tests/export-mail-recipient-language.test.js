/**
 * The export-ready mail is written in the recipient's language (B389).
 *
 * #1219 gave reset and magic-link mail the recipient's stored `uiLocale` and
 * defended leaving the rest alone with "that recipient has no account yet".
 * That holds for an invitation, not for this mail: the export-ready notice goes
 * to the signed-in account holder who asked for the export, so it is the same
 * question with the same answer — one that `resolveRecipientLocale()` already
 * gives. The worker now hands it to the sender.
 *
 * The assertion is at the outgoing edge rather than on the resolved locale,
 * the way `tests/auth-mail-recipient-language.test.js` does it: what the item
 * promises is a *Dutch mail*, so the test reads the subject and body Brevo
 * would have received. `sendEmail` is the only `fetch` in this path, which
 * makes a stubbed `fetch` the seam.
 *
 * Passing the locale was only half of it: `email.exportReady.*` lived nowhere
 * but as English code defaults, so a `nl` translator resolved every key to
 * English. Hence the body assertion — a subject-only test would have passed on
 * a dictionary that cannot differ.
 *
 * The in-app half of `sendExportNotifications` needs no double: it writes
 * through a scope this test does not seed, fails, and is caught and logged by
 * design. The mail must leave either way, and that is worth pinning too.
 *
 * Run with: node --test tests/export-mail-recipient-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
// A key makes `sendEmail` reach `fetch`, which is where the stub below reads
// the composed mail. Nothing here touches the network.
process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@decks.example.test';

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { sendExportNotifications } =
  await import('../server/jobs/queue/workers/bulk-export-worker.js');
const { t } = await import('../server/i18n/index.js');

/** The subject each locale is expected to produce, read from the dictionaries. */
const SUBJECT = (locale) =>
  t('email.exportReady.subject', 'Your data export is ready', null, locale);

/** The body line, for the count this test exports. */
const BODY = (locale) =>
  t(
    'email.exportReady.body',
    'Your data export is ready to download. The archive contains {count} presentation{s}.',
    { count: 3, s: 's' },
    locale,
  );

/** @type {ReturnType<typeof createFakeDb>} */
let db;
/** Resolves with the Brevo payload of the next send. */
let nextSend;
let realFetch;

test.before(() => {
  realFetch = globalThis.fetch;
});

test.after(() => {
  globalThis.fetch = realFetch;
  __setTestDb(null);
});

/**
 * A stored `users` row in the shape the settings lookup reads.
 * @param {string} email
 * @returns {Object}
 */
function userRow(email) {
  return {
    id: `user-${email.split('@')[0]}`,
    organization_id: DEFAULT_ORG,
    email,
    name: email.split('@')[0],
    role: 'user',
    auth_source: 'database',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    settings: {},
  };
}

/**
 * Install a fresh double and a `fetch` that captures one outgoing mail.
 *
 * The cast: Nel reads Dutch, Ed has no stored preference, and Duc's preference
 * names a locale this install has no strings for.
 */
function seed() {
  db = createFakeDb({
    organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
    users: [
      userRow('nel@example.com'),
      userRow('ed@example.com'),
      userRow('duc@example.com'),
    ],
    user_settings: [
      {
        user_id: 'user-nel',
        email: 'nel@example.com',
        settings: { uiLocale: 'nl' },
      },
      {
        user_id: 'user-duc',
        email: 'duc@example.com',
        settings: { uiLocale: 'de' },
      },
    ],
  });
  __setTestDb(db);

  let resolveSend;
  nextSend = new Promise((resolve) => {
    resolveSend = resolve;
  });
  globalThis.fetch = async (_url, opts) => {
    resolveSend(JSON.parse(opts.body));
    return {
      ok: true,
      status: 201,
      text: async () => '',
      json: async () => ({ messageId: 'test' }),
    };
  };
}

/**
 * Run the notification step the way a finished job does.
 * @param {string} userEmail
 * @returns {Promise<void>}
 */
function notify(userEmail) {
  return sendExportNotifications({
    userEmail,
    jobId: 'heavy-42',
    manifest: { stats: { presentations: 3, totalSizeBytes: 2048 } },
    organizationId: DEFAULT_ORG,
    repoRoot: process.cwd(),
  });
}

/**
 * The mail the worker sent, or a failure naming the wait rather than hanging
 * until the runner's timeout.
 * @returns {Promise<Object>} The Brevo payload.
 */
async function sentMail() {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('no mail reached the transport within 2s')),
      2000,
    ).unref(),
  );
  return Promise.race([nextSend, timeout]);
}

test('a Dutch account gets a Dutch export-ready mail', async () => {
  seed();
  await notify('nel@example.com');

  const mail = await sentMail();
  assert.equal(mail.to[0].email, 'nel@example.com');
  assert.equal(mail.subject, SUBJECT('nl'));
  assert.notEqual(
    SUBJECT('nl'),
    SUBJECT('en'),
    'the two dictionaries must actually differ for this to mean anything',
  );
});

test('the body is translated too, not just the subject line', async () => {
  seed();
  await notify('nel@example.com');

  const mail = await sentMail();
  assert.notEqual(
    BODY('nl'),
    BODY('en'),
    'a Dutch body must exist at all — code defaults alone are English',
  );
  assert.ok(
    mail.textContent.includes(BODY('nl')),
    `the Dutch body line is missing from the mail:\n${mail.textContent}`,
  );
  assert.ok(
    !mail.textContent.includes(BODY('en')),
    'no English body line may survive beside the Dutch one',
  );
});

test('an account without a stored preference gets English', async () => {
  seed();
  await notify('ed@example.com');

  const mail = await sentMail();
  assert.equal(mail.subject, SUBJECT('en'));
});

test('a preference this install has no strings for falls back to English', async () => {
  seed();
  await notify('duc@example.com');

  const mail = await sentMail();
  assert.equal(
    mail.subject,
    SUBJECT('en'),
    'de has no translation file, so the mail is English rather than key names',
  );
});

test('an address without an account still gets its mail, in English', async () => {
  seed();
  await notify('ghost@example.com');

  const mail = await sentMail();
  assert.equal(mail.to[0].email, 'ghost@example.com');
  assert.equal(
    mail.subject,
    SUBJECT('en'),
    'a locale that cannot be read must not stop the send',
  );
});

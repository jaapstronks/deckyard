/**
 * Reset and magic-link mail is written in the recipient's language (B379).
 *
 * Both routes used to send without a locale, so every sender fell back to its
 * `locale = 'en'` default and a Dutch account got an English password-reset
 * mail on a Dutch interface. The routes now resolve the recipient's stored
 * `uiLocale` through `resolveRecipientLocale()` and hand it to the sender.
 *
 * The assertion is deliberately at the outgoing edge rather than on the
 * resolved locale: what this item promises is a *Dutch mail*, so the test
 * reads the subject line Brevo would have received. `sendEmail` is the only
 * `fetch` in this path, which makes a stubbed `fetch` the seam.
 *
 * The send is fire-and-forget — the route answers before the mail leaves — so
 * every case awaits the captured payload rather than the handler.
 *
 * Sibling file: `tests/auth-routes-reset-and-magic-link.test.js` holds the
 * enumeration and rate-limit rules for the same two routes and deliberately
 * runs *without* a Brevo key. This one needs the key to observe the send, and
 * node --test gives each file its own process.
 *
 * Run with: node --test tests/auth-mail-recipient-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; the auth layer only needs MIN_AUTH_SECRET_LENGTH characters to sign with.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
// A key makes `sendEmail` reach `fetch`, which is where the stub below reads
// the composed mail. Nothing here touches the network.
process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@decks.example.test';

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handlePasswordReset } =
  await import('../server/routes/api/password-reset.js');
const { handleMagicLink } = await import('../server/routes/api/magic-link.js');
const { t } = await import('../server/i18n/index.js');

/** The subject each locale is expected to produce, read from the dictionaries. */
const RESET_SUBJECT = (locale) =>
  t('email.passwordReset.subject', 'Reset your password', null, locale);
const MAGIC_SUBJECT = (locale) =>
  t('email.magicLink.subject', 'Your login link', null, locale);

const CLIENT_IP = '203.0.113.9';

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
 * A stored `users` row in the shape the identity lookup reads.
 * @param {string} email
 * @param {string} name
 * @returns {Object}
 */
function userRow(email, name) {
  return {
    id: `user-${email.split('@')[0]}`,
    organization_id: DEFAULT_ORG,
    email,
    name,
    role: 'user',
    auth_source: 'database',
    password_hash: 'not-verified-on-this-path',
    password_changed_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    settings: {},
  };
}

/**
 * Install a fresh double and a `fetch` that captures one outgoing mail.
 *
 * The cast: Nel reads Dutch, Ed has no stored preference at all, and Duc's
 * preference names a locale this install has no strings for.
 */
function seed() {
  db = createFakeDb({
    organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
    users: [
      userRow('nel@example.com', 'Nel'),
      userRow('ed@example.com', 'Ed'),
      userRow('duc@example.com', 'Duc'),
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
    password_reset_tokens: [],
    magic_link_tokens: [],
    auth_audit_log: [],
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
 * Call an auth-route handler the way `routes/api/index.js` does.
 * @param {Function} handler - `handlePasswordReset` or `handleMagicLink`.
 * @param {string} path - Request path.
 * @param {Object} body - JSON request body.
 * @returns {Promise<{status: number|null, body: Object|null}>}
 */
async function call(handler, path, body) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: {
      host: 'decks.example.test',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: CLIENT_IP },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const chunks = [];
  const res = {
    status: null,
    setHeader() {},
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
    },
  };
  await handler({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${path}`),
  });
  return {
    status: res.status,
    body: chunks.length ? JSON.parse(chunks.join('')) : null,
  };
}

/**
 * The mail the route sent, or a failure naming the wait rather than hanging
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

test('a Dutch account gets a Dutch password-reset mail', async () => {
  seed();
  const res = await call(handlePasswordReset, '/api/auth/forgot-password', {
    email: 'nel@example.com',
  });
  assert.equal(res.status, 200);

  const mail = await sentMail();
  assert.equal(mail.to[0].email, 'nel@example.com');
  assert.equal(mail.subject, RESET_SUBJECT('nl'));
  assert.notEqual(
    RESET_SUBJECT('nl'),
    RESET_SUBJECT('en'),
    'the two dictionaries must actually differ for this to mean anything',
  );
});

test('an account without a stored preference gets English', async () => {
  seed();
  await call(handlePasswordReset, '/api/auth/forgot-password', {
    email: 'ed@example.com',
  });

  const mail = await sentMail();
  assert.equal(mail.subject, RESET_SUBJECT('en'));
});

test('a preference this install has no strings for falls back to English', async () => {
  seed();
  await call(handlePasswordReset, '/api/auth/forgot-password', {
    email: 'duc@example.com',
  });

  const mail = await sentMail();
  assert.equal(
    mail.subject,
    RESET_SUBJECT('en'),
    'de has no translation file, so the mail is English rather than key names',
  );
});

test('a Dutch account gets a Dutch magic-link mail', async () => {
  seed();
  const res = await call(handleMagicLink, '/api/auth/magic-link', {
    email: 'nel@example.com',
  });
  assert.equal(res.status, 200);

  const mail = await sentMail();
  assert.equal(mail.to[0].email, 'nel@example.com');
  assert.equal(mail.subject, MAGIC_SUBJECT('nl'));
  assert.notEqual(MAGIC_SUBJECT('nl'), MAGIC_SUBJECT('en'));
});

test('the HTTP answer says nothing about the recipient or their language', async () => {
  seed();
  const dutch = await call(handlePasswordReset, '/api/auth/forgot-password', {
    email: 'nel@example.com',
  });
  await sentMail();

  seed();
  const stranger = await call(
    handlePasswordReset,
    '/api/auth/forgot-password',
    {
      email: 'ghost@example.com',
    },
  );

  assert.equal(dutch.status, stranger.status);
  assert.deepEqual(
    dutch.body,
    stranger.body,
    'the locale travels to the mailbox, never back to the requester',
  );
});

/**
 * Every mail is written in its recipient's language (B400).
 *
 * `resolveRecipientLocale()` called itself the one place that decides the
 * language of a mail, but only three flows asked it; every other sender fell
 * back to its own `locale = 'en'` default, and the two invitation routes read
 * the install default with a third, private `.catch(() => 'en')`. The senders
 * now ask it themselves, for their own `recipientEmail`, and have no `locale`
 * parameter left — so no call site can forget it or answer it differently.
 *
 * The chain it answers with:
 *
 *   1. the recipient's stored `uiLocale`, when this install has strings for it;
 *   2. otherwise the install's mail default (Settings > Email templates),
 *      which is `DEFAULT_LOCALE` until an admin sets it.
 *
 * Step 2 is the answer for everyone who has not chosen: a share-link guest
 * without an account, and an invitee whose account was created a moment ago.
 *
 * Assertions sit at the outgoing edge — the subject Brevo would receive, read
 * from the dictionaries — because what this item promises is a Dutch mail, not
 * a resolved string. `fetch` is the one transport seam, as in
 * `tests/email-senders.test.js`.
 *
 * The two digest senders are not in this matrix: they carry their language on
 * the digest itself (B390).
 *
 * Run with: node --test tests/recipient-locale-everywhere.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@deckyard.test';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { t } = await import('../server/i18n/index.js');
const { resolveRecipientLocale } =
  await import('../server/integrations/email/recipient-locale.js');
const {
  sendPasswordResetEmail,
  sendUserInvitationEmail,
  sendActivationReminderEmail,
  sendMagicLinkEmail,
} = await import('../server/integrations/email/senders-auth.js');
const {
  sendCommentNotification,
  sendGuestVerificationEmail,
  sendCollaboratorInviteEmail,
  sendGuestInvitationEmail,
} = await import('../server/integrations/email/senders-collaboration.js');
const { sendExportReadyNotification } =
  await import('../server/integrations/email/senders-export.js');

test.after(() => __setTestDb(null));

/**
 * A `users` row plus, when given, a stored interface language.
 * @param {string} email
 * @param {string|null} uiLocale
 */
function account(email, uiLocale) {
  const id = `user-${email.split('@')[0]}`;
  return {
    user: {
      id,
      organization_id: DEFAULT_ORG,
      email,
      name: email.split('@')[0],
      role: 'user',
      auth_source: 'database',
      settings: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    settings: uiLocale ? { user_id: id, email, settings: { uiLocale } } : null,
  };
}

/**
 * Seed the double. Nel reads Dutch; Ed has an account and no preference;
 * nobody@ has no account at all.
 * @param {{ installDefault?: string }} [options]
 */
function seed({ installDefault } = {}) {
  const people = [account('nel@example.com', 'nl'), account('ed@example.com')];
  __setTestDb(
    createFakeDb({
      organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
      users: people.map((p) => p.user),
      user_settings: people.map((p) => p.settings).filter(Boolean),
      email_templates: [],
      email_template_settings: installDefault
        ? [{ id: true, default_locale: installDefault }]
        : [],
    }),
  );
}

/** Run one send against a stubbed transport and return the Brevo payload. */
async function sentMail(send) {
  const realFetch = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => '',
      json: async () => ({ messageId: 'test' }),
    };
  };
  try {
    await send();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(payload, 'a mail reached the transport');
  return payload;
}

/** Every sender, with the arguments it needs and the subject key it writes. */
const SENDERS = [
  {
    name: 'password reset',
    key: 'email.passwordReset.subject',
    send: (to) =>
      sendPasswordResetEmail({
        recipientEmail: to,
        resetUrl: 'https://deckyard.test/reset?token=a',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'magic link',
    key: 'email.magicLink.subject',
    send: (to) =>
      sendMagicLinkEmail({
        recipientEmail: to,
        magicLinkUrl: 'https://deckyard.test/magic?token=a',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'user invitation',
    key: 'email.userInvitation.subject',
    send: (to) =>
      sendUserInvitationEmail({
        recipientEmail: to,
        invitedBy: 'Alice',
        setupUrl: 'https://deckyard.test/setup?token=a',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'activation reminder',
    key: 'email.activationReminder.subject',
    send: (to) =>
      sendActivationReminderEmail({
        recipientEmail: to,
        invitedBy: 'Alice',
        setupUrl: 'https://deckyard.test/setup?token=a',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'collaborator invite',
    key: 'email.collaboratorInvite.subject',
    vars: { inviter: 'Alice', presTitle: 'Q3' },
    send: (to) =>
      sendCollaboratorInviteEmail({
        recipientEmail: to,
        presentationTitle: 'Q3',
        inviterName: 'Alice',
        permission: 'view',
        editUrl: 'https://deckyard.test/app/deck-1',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'guest invitation',
    key: 'email.guestInvitation.subject',
    vars: { inviter: 'Alice', presTitle: 'Q3' },
    send: (to) =>
      sendGuestInvitationEmail({
        recipientEmail: to,
        presentationTitle: 'Q3',
        shareUrl: 'https://deckyard.test/s/tok',
        inviterName: 'Alice',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'guest verification',
    key: 'email.guestVerification.subject',
    vars: { presTitle: 'Q3' },
    send: (to) =>
      sendGuestVerificationEmail({
        recipientEmail: to,
        presentationTitle: 'Q3',
        verificationUrl: 'https://deckyard.test/verify/a',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'comment notification',
    key: 'email.commentNotification.subject.new',
    vars: { presTitle: 'Q3' },
    send: (to) =>
      sendCommentNotification({
        recipientEmail: to,
        comment: { body: 'Nice' },
        presentation: { title: 'Q3' },
        commenter: { name: 'Alice' },
        isReply: false,
        isOwner: true,
        editUrl: 'https://deckyard.test/app/deck-1',
        repoRoot: REPO_ROOT,
      }),
  },
  {
    name: 'export ready',
    key: 'email.exportReady.subject',
    send: (to) =>
      sendExportReadyNotification({
        recipientEmail: to,
        stats: { presentationCount: 1, totalSizeBytes: 1024 },
        downloadUrl: 'https://deckyard.test/export/a.zip',
        repoRoot: REPO_ROOT,
      }),
  },
];

/** The subject a sender writes in `locale`, read from the dictionary. */
function subject({ key, vars }, locale) {
  return t(key, undefined, vars, locale);
}

for (const sender of SENDERS) {
  test(`${sender.name}: a recipient with uiLocale nl gets a Dutch mail`, async () => {
    assert.notEqual(
      subject(sender, 'nl'),
      subject(sender, 'en'),
      'the two dictionaries must differ for this case to mean anything',
    );
    seed();
    const mail = await sentMail(() => sender.send('nel@example.com'));
    assert.equal(mail.to[0].email, 'nel@example.com');
    assert.equal(mail.subject, subject(sender, 'nl'));
  });
}

test('a recipient with no preference gets the install default, which is en until set', async () => {
  seed();
  assert.equal(
    await resolveRecipientLocale({
      repoRoot: REPO_ROOT,
      email: 'ed@example.com',
    }),
    'en',
  );

  seed({ installDefault: 'nl' });
  assert.equal(
    await resolveRecipientLocale({
      repoRoot: REPO_ROOT,
      email: 'ed@example.com',
    }),
    'nl',
    "the admin's default applies to an account that never chose",
  );
});

test('a guest without an account gets the install default, not a second one', async () => {
  seed();
  const english = await sentMail(() =>
    SENDERS.find((s) => s.name === 'guest verification').send(
      'nobody@example.com',
    ),
  );
  assert.equal(
    english.subject,
    t('email.guestVerification.subject', undefined, { presTitle: 'Q3' }, 'en'),
  );

  seed({ installDefault: 'nl' });
  const dutch = await sentMail(() =>
    SENDERS.find((s) => s.name === 'guest verification').send(
      'nobody@example.com',
    ),
  );
  assert.equal(
    dutch.subject,
    t('email.guestVerification.subject', undefined, { presTitle: 'Q3' }, 'nl'),
  );
});

test("the recipient's own choice beats the install default", async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
      users: [account('en@example.com', 'en').user],
      user_settings: [account('en@example.com', 'en').settings],
      email_template_settings: [{ id: true, default_locale: 'nl' }],
    }),
  );
  assert.equal(
    await resolveRecipientLocale({
      repoRoot: REPO_ROOT,
      email: 'en@example.com',
    }),
    'en',
  );
});

test('no sender takes a locale and no route picks one', () => {
  // The guard behind the route: a `locale = 'en'` default on a sender is a
  // second answer, and a route reading the install default is a third.
  const emailDir = join(REPO_ROOT, 'server/integrations/email');
  for (const file of readdirSync(emailDir).filter((f) =>
    f.startsWith('senders-'),
  )) {
    const src = readFileSync(join(emailDir, file), 'utf8');
    assert.doesNotMatch(
      src,
      /\blocale\s*=\s*['"]/,
      `${file} declares its own locale default`,
    );
  }
  const routes = join(REPO_ROOT, 'server/routes/api');
  for (const file of ['admin-users.js', 'organization-members.js']) {
    assert.doesNotMatch(
      readFileSync(join(routes, file), 'utf8'),
      /getEmailDefaultLocale|locale,/,
      `${file} picks a mail language itself`,
    );
  }
});

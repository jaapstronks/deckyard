/**
 * The mail around a digest is in the digest's language (B390).
 *
 * The digest senders do not resolve a locale of their own: the digest arrives
 * already written, and names its language on `digest.locale`. The chrome —
 * section headings, the dashboard button, the footer — is rendered in that
 * same language, so a Dutch summary never sits under an English frame. A
 * digest that names no language is refused rather than framed in English.
 *
 * Assertions read the Brevo payload; `fetch` is the one transport seam.
 *
 * Run with: node --test tests/digest-mail-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@deckyard.test';

const { sendWeeklyDigestEmail, sendTeamDigestEmail } =
  await import('../server/integrations/email/senders-digests.js');

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
  return payload;
}

const SOLO = {
  subject: 'Je wekelijkse betrokkenheidsinzichten',
  greeting: 'Hallo Nel,',
  highlights: 'Een rustige week.',
  topPresentationsIntro: '',
  topPresentations: [{ title: 'Deck A', views: 3, avgDuration: '1m' }],
  insights: ['Deel vaker.'],
  weekOverWeek: { views: '3 (+50%)' },
  closing: 'Tot volgende week.',
  weekStart: '2026-09-14',
  weekEnd: '2026-09-20',
};

const TEAM = {
  ...SOLO,
  topPresenters: [{ name: 'Ed', totalViews: 3, presentationCount: 1 }],
  activePresenters: 1,
  presentationCount: 2,
};

const URLS = {
  dashboardUrl: 'https://deckyard.test/insights',
  preferencesUrl: 'https://deckyard.test/settings',
};

test('a Dutch weekly digest is framed in Dutch', async () => {
  const mail = await sentMail(() =>
    sendWeeklyDigestEmail({
      recipientEmail: 'nel@example.com',
      digest: { ...SOLO, locale: 'nl' },
      ...URLS,
    }),
  );
  assert.equal(mail.subject, SOLO.subject);
  for (const phrase of [
    'Best presterende presentaties:',
    '3 weergaven, gem. 1m',
    'Inzichten',
    'Ten opzichte van vorige week',
    'Weergaven: 3 (+50%)',
    'Bekijk het volledige dashboard',
    'Voorkeuren beheren',
  ]) {
    assert.ok(mail.htmlContent.includes(phrase), `html carries "${phrase}"`);
    assert.ok(mail.textContent.includes(phrase), `text carries "${phrase}"`);
  }
  assert.doesNotMatch(mail.htmlContent, /Manage preferences|Week over week/);
});

test('a Dutch team digest is framed in Dutch', async () => {
  const mail = await sentMail(() =>
    sendTeamDigestEmail({
      recipientEmail: 'nel@example.com',
      digest: { ...TEAM, locale: 'nl' },
      ...URLS,
    }),
  );
  for (const phrase of [
    'Teaminzichten: 2026-09-14 - 2026-09-20',
    'Meest actieve presentatoren:',
    '3 weergaven, 1 presentaties',
    'Teamoverzicht',
    'Actieve presentatoren: 1',
    'Bekijk het teamdashboard',
  ]) {
    assert.ok(mail.htmlContent.includes(phrase), `html carries "${phrase}"`);
  }
});

test('an English digest keeps the English frame', async () => {
  const mail = await sentMail(() =>
    sendWeeklyDigestEmail({
      recipientEmail: 'ed@example.com',
      digest: { ...SOLO, locale: 'en' },
      ...URLS,
    }),
  );
  assert.match(mail.htmlContent, /View Full Dashboard/);
  assert.match(mail.htmlContent, /Manage preferences/);
});

test('a digest that names no language is refused', async () => {
  await assert.rejects(
    () =>
      sendWeeklyDigestEmail({
        recipientEmail: 'ed@example.com',
        digest: SOLO,
        ...URLS,
      }),
    /must name its locale/,
  );
  await assert.rejects(
    () =>
      sendTeamDigestEmail({
        recipientEmail: 'ed@example.com',
        digest: TEAM,
        ...URLS,
      }),
    /must name its locale/,
  );
});

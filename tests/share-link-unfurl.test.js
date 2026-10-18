/**
 * The share-link unfurl: what `/s/:token` puts in the head for a chat or mail
 * client that previews the link.
 *
 * Three promises are pinned. A link that no longer opens (revoked, expired,
 * spent) unfurls with the shell's generic preview, so pasting a withdrawn link
 * does not name the deck it used to open. A link with a password unfurls the
 * same way: the password is the boundary, and the title is handed over by
 * `verify` once it is given. And a deck without a description of its own gets
 * the fallback line in its own language, not a Dutch sentence on an English
 * deck.
 *
 * Route-level, in the house shape: the exported handler over a req/res double
 * and `tests/helpers/fake-db.js`.
 *
 * Run with: node --test tests/share-link-unfurl.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.OG_DESCRIPTION;
delete process.env.APP_NAME;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', 'client');
const repoRoot = path.join(__dirname, '..');

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handleShareLink } =
  await import('../server/routes/static/share-viewer.js');
const { handleSharePublicEndpoints } =
  await import('../server/routes/api/share-links/public.js');
const { getOgDescription } = await import('../server/config/branding.js');
const { hashPassword } = await import('../server/utils/password-hash.js');

const PASSWORD = 'open sesame';

const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR).toISOString();

function deckRow(id, overrides = {}) {
  return {
    id,
    organization_id: ORG,
    title: `Deck ${id}`,
    owner_email: 'author@example.com',
    created_by: 'author@example.com',
    updated_by: 'author@example.com',
    visibility: 'private',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'One' } }],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
    ...overrides,
  };
}

function linkRow(overrides) {
  return {
    organization_id: ORG,
    presentation_id: 'deck-nl',
    label: null,
    permission: 'view',
    password_hash: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    created_by: 'author@example.com',
    created_at: '2026-02-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
    registration_mode: 'open',
    ...overrides,
  };
}

test.before(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      // `verify` resolves the deck's theme for the viewer.
      themes: [await brandSeedRow()],
      presentations: [
        deckRow('deck-nl'),
        deckRow('deck-en', { lang: 'en-GB', title: 'Quarterly review' }),
        deckRow('deck-described', {
          lang: 'en-GB',
          description: 'Our own line.',
        }),
      ],
      presentation_share_links: [
        linkRow({ id: 'l-nl', token: 'tok-nl' }),
        linkRow({ id: 'l-en', token: 'tok-en', presentation_id: 'deck-en' }),
        linkRow({
          id: 'l-described',
          token: 'tok-described',
          presentation_id: 'deck-described',
        }),
        linkRow({
          id: 'l-password',
          token: 'tok-password',
          presentation_id: 'deck-en',
          password_hash: passwordHash,
        }),
        linkRow({
          id: 'l-revoked',
          token: 'tok-revoked',
          presentation_id: 'deck-en',
          revoked_at: past(),
          revoked_by: 'author@example.com',
        }),
        linkRow({
          id: 'l-expired',
          token: 'tok-expired',
          presentation_id: 'deck-en',
          expires_at: past(),
        }),
        linkRow({
          id: 'l-spent',
          token: 'tok-spent',
          presentation_id: 'deck-en',
          max_uses: 1,
          use_count: 1,
        }),
      ],
    }),
  );
});

test.after(() => {
  __setTestDb(null);
});

/** GET `/s/:token` and return the served HTML. */
async function unfurl(token) {
  const res = createMockRes();
  const pathname = `/s/${token}`;
  const handled = await handleShareLink({
    repoRoot,
    clientDir,
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL(pathname, 'http://decks.example.test'),
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  return String(res.body);
}

function meta(html, attr, name) {
  const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`);
  return html.match(re)?.[1];
}

test('a live link unfurls with its deck title', async () => {
  const html = await unfurl('tok-en');
  assert.equal(meta(html, 'property', 'og:title'), 'Quarterly review');
});

test('an English deck without a description unfurls in English', async () => {
  const html = await unfurl('tok-en');
  const expected = 'View the presentation &quot;Quarterly review&quot;.';
  assert.equal(meta(html, 'property', 'og:description'), expected);
  assert.equal(meta(html, 'name', 'twitter:description'), expected);
  assert.equal(meta(html, 'name', 'description'), expected);
});

test('a Dutch deck without a description unfurls in Dutch', async () => {
  const html = await unfurl('tok-nl');
  assert.equal(
    meta(html, 'property', 'og:description'),
    'Bekijk de presentatie &quot;Deck deck-nl&quot;.',
  );
});

test("a deck's own description wins over the fallback line", async () => {
  const html = await unfurl('tok-described');
  assert.equal(meta(html, 'property', 'og:description'), 'Our own line.');
});

for (const [kind, token] of [
  ['a revoked', 'tok-revoked'],
  ['an expired', 'tok-expired'],
  ['a spent', 'tok-spent'],
  ['an unknown', 'tok-nope'],
  ['a password-protected', 'tok-password'],
]) {
  test(`${kind} link unfurls with the generic preview, naming no deck`, async () => {
    const html = await unfurl(token);
    assert.ok(!html.includes('Quarterly review'), 'no deck title in the head');
    assert.equal(
      meta(html, 'property', 'og:description'),
      getOgDescription(),
      'the instance description, not a deck sentence',
    );
  });
}

test('a password-protected link hands over its title once the password is given', async () => {
  const res = createMockRes();
  const handled = await handleSharePublicEndpoints({
    repoRoot,
    req: createMockReq({
      method: 'POST',
      headers: { host: 'decks.example.test' },
      body: { password: PASSWORD },
    }),
    res,
    url: new URL('/api/share/tok-password/verify', 'http://decks.example.test'),
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).presentation.title, 'Quarterly review');
});

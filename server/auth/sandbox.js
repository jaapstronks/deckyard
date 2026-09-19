import crypto from 'node:crypto';
import { parseCookies } from '../utils/cookies.js';
import { sandboxCookieMaxAgeDays, sandboxEnabled } from '../config/sandbox.js';
import { shouldUseSecureCookies } from '../utils/request-url.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { withDbGuard } from '../storage/utils/index.js';
import { nowIso } from '../utils/normalize.js';

const COOKIE_NAME = 'sb_sandbox';
const GUEST_EMAIL_DOMAIN = 'sandbox.local';

/**
 * SQL `LIKE` pattern matching every sandbox guest address, for the cleanup
 * sweep that removes guest rows once their cookie can no longer exist.
 */
export const SANDBOX_GUEST_EMAIL_PATTERN = `guest-%@${GUEST_EMAIL_DOMAIN}`;

/**
 * Whether an address belongs to a sandbox guest: the in-memory twin of
 * `SANDBOX_GUEST_EMAIL_PATTERN`, so "is this guest work" has one answer in SQL
 * and in code.
 * @param {unknown} email
 * @returns {boolean}
 */
export function isSandboxGuestEmail(email) {
  const s = String(email || '').toLowerCase();
  return s.startsWith('guest-') && s.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

function normalizeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // UUID or "uuid-like" token. We keep it loose but bounded to avoid header abuse.
  if (s.length < 8 || s.length > 80) return null;
  if (!/^[a-z0-9\-_.]+$/i.test(s)) return null;
  return s;
}

/**
 * The guest's address, derived from its cookie token by a one-way hash.
 *
 * The address is an identity: it is stamped on every deck the guest owns and
 * is what user search, the share modal and a collaborator list show to other
 * guests. The token is the credential. With the token in the address, any
 * guest could read another's cookie out of `/api/users/search` and take over
 * that session; the hash keeps the one stable per cookie without revealing it.
 * @param {string} token - The normalized `sb_sandbox` cookie value
 * @returns {string}
 */
function guestEmailForToken(token) {
  const digest = crypto
    .createHash('sha256')
    .update(String(token))
    .digest('hex')
    .slice(0, 32);
  return `guest-${digest}@${GUEST_EMAIL_DOMAIN}`;
}

function getSandboxUserFromRequest(req) {
  if (!sandboxEnabled()) return null;
  const cookies = parseCookies(req.headers?.cookie);
  const token = normalizeId(cookies[COOKIE_NAME]);
  if (!token) return null;
  const email = guestEmailForToken(token);
  return {
    email,
    role: 'user',
    name: 'Guest',
    isAdmin: false,
    isSandboxGuest: true,
    sandboxId: token,
  };
}

export function ensureSandboxUser(req, res) {
  if (!sandboxEnabled()) return null;
  const existing = getSandboxUserFromRequest(req);
  if (existing) return existing;

  const token = crypto.randomUUID();
  const maxAgeDays = sandboxCookieMaxAgeDays();
  const maxAgeSec = maxAgeDays * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (shouldUseSecureCookies(req)) parts.push('Secure');

  // Preserve any existing Set-Cookie headers (if present).
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', parts.join('; '));
  else if (Array.isArray(prev))
    res.setHeader('Set-Cookie', [...prev, parts.join('; ')]);
  else res.setHeader('Set-Cookie', [String(prev), parts.join('; ')]);

  const email = guestEmailForToken(token);
  return {
    email,
    role: 'user',
    name: 'Guest',
    isAdmin: false,
    isSandboxGuest: true,
    sandboxId: token,
  };
}

/**
 * The sandbox guest with its `users.id` resolved — the shape every request that
 * takes an authorization decision must carry.
 *
 * Ownership is keyed on `users.id` and on nothing else (D22,
 * shared/identity-match.js). A guest known only by the address in its cookie
 * owns nothing: it could create a deck (the insert stamps `owner_email`) and
 * then not open it — every example on the sandbox Home answered "Access
 * Denied". So a guest is a real `users` row, exactly like the development
 * bypass (auth/dev-bypass.js).
 *
 * The row is created on the first request that *returns* the cookie. The
 * request that mints a cookie carries no id yet — a client that keeps no
 * cookies (a crawler) never gets past that point, so it never leaves a row
 * behind; the browser app has its cookie from the app shell before its first
 * API call. The cleanup sweep (jobs/sandbox-cleanup.js) removes a guest row
 * once its cookie has expired.
 *
 * With the database unreachable the guest carries `id: null` and matches no
 * ownership stamp — the honest degraded state, not a crash.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<Object|null>} null outside sandbox mode
 */
export async function ensureSandboxUserAsync(req, res) {
  if (!sandboxEnabled()) return null;
  const returning = getSandboxUserFromRequest(req);
  if (!returning) return { ...ensureSandboxUser(req, res), id: null };
  const id = await resolveSandboxGuestUserId(returning.email);
  return { ...returning, id };
}

/**
 * Look up the `users.id` of a sandbox guest, creating the row on first use.
 *
 * @param {string} email - The guest address minted from the cookie token
 * @returns {Promise<string|null>}
 */
async function resolveSandboxGuestUserId(email) {
  return withDbGuard(null, async (db) => {
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    if (existing?.id) return existing.id;

    const now = nowIso();
    const inserted = await db
      .insertInto('users')
      .values({
        organization_id: getDefaultOrganizationId(),
        email,
        name: 'Guest',
        role: 'user',
        // No password: a guest is only ever reached through its cookie.
        auth_source: 'database',
        created_at: now,
        updated_at: now,
      })
      // Two parallel first writes from the same guest race here.
      .onConflict((oc) => oc.column('email').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted?.id) return inserted.id;

    const raced = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    return raced?.id || null;
  });
}

import crypto from 'node:crypto';
import { parseCookies } from '../utils/cookies.js';
import { sandboxCookieMaxAgeDays, sandboxEnabled } from '../config/sandbox.js';
import { shouldUseSecureCookies } from '../utils/request-url.js';
import { readSignedPayload, signPayload } from '../utils/signed-payload.js';
import { envStr } from '../config/utils.js';
import { createStorageScope } from '../utils/context.js';
import { ensureUserByEmail } from '../storage/users.js';
import { normalizeEmail } from '../../shared/email.js';

const COOKIE_NAME = 'sb_sandbox';
const GUEST_EMAIL_DOMAIN = 'sandbox.local';

/**
 * Names what a signed guest token is for. AUTH_SECRET also signs the OIDC state
 * and share-link grants, so a token from one of those must not read as a guest.
 */
const GUEST_TOKEN_PURPOSE = 'sandbox_guest';

/**
 * SQL `LIKE` pattern matching every sandbox guest address, for the cleanup
 * sweep that removes guest rows once their cookie can no longer exist.
 */
export const SANDBOX_GUEST_EMAIL_PATTERN = `guest-%@${GUEST_EMAIL_DOMAIN}`;

/**
 * The exact shape of a guest address as `guestEmailForId` mints it. A row
 * that matches the pattern above but not this is a leftover of an earlier
 * form, which the cleanup sweep removes.
 */
export const SANDBOX_GUEST_EMAIL_REGEX = /^guest-[0-9a-f]{32}@sandbox\.local$/;

/**
 * Whether an address belongs to a sandbox guest: the in-memory twin of
 * `SANDBOX_GUEST_EMAIL_PATTERN`, so "is this guest work" has one answer in SQL
 * and in code.
 * @param {unknown} email
 * @returns {boolean}
 */
export function isSandboxGuestEmail(email) {
  const s = normalizeEmail(email) || '';
  return s.startsWith('guest-') && s.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

/**
 * The guest's address, derived from its id by a one-way hash.
 *
 * The address is an identity: it is stamped on every deck the guest owns and
 * is what user search, the share modal and a collaborator list show to other
 * guests. The id stays out of it, so the address says nothing about the cookie.
 * @param {string} guestId - The `sid` of a verified guest token
 * @returns {string}
 */
function guestEmailForId(guestId) {
  const digest = crypto
    .createHash('sha256')
    .update(String(guestId))
    .digest('hex')
    .slice(0, 32);
  return `guest-${digest}@${GUEST_EMAIL_DOMAIN}`;
}

/**
 * The guest object every request carries. It holds no part of the cookie:
 * `/api/auth/me` sends it to the page, and the cookie is HttpOnly.
 * @param {string} guestId
 * @returns {Object}
 */
function guestUser(guestId) {
  return {
    email: guestEmailForId(guestId),
    role: 'user',
    name: 'Guest',
    isAdmin: false,
    isSandboxGuest: true,
  };
}

/**
 * The guest id a cookie proves, or null when the token is unsigned, altered,
 * expired or signed for something else. A refused token mints a new guest, so
 * it can never reach an existing one.
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function verifiedGuestId(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const payload = readSignedPayload(
    cookies[COOKIE_NAME],
    envStr('AUTH_SECRET'),
  );
  if (payload?.purpose !== GUEST_TOKEN_PURPOSE) return null;
  return typeof payload.sid === 'string' && payload.sid ? payload.sid : null;
}

function getSandboxUserFromRequest(req) {
  if (!sandboxEnabled()) return null;
  const guestId = verifiedGuestId(req);
  return guestId ? guestUser(guestId) : null;
}

export function ensureSandboxUser(req, res) {
  if (!sandboxEnabled()) return null;
  const existing = getSandboxUserFromRequest(req);
  if (existing) return existing;

  // authConfigError() refuses to boot a sandbox without this secret.
  const secret = envStr('AUTH_SECRET');
  if (!secret) throw new Error('AUTH_SECRET is required in sandbox mode');

  const guestId = crypto.randomUUID();
  const maxAgeSec = Math.floor(sandboxCookieMaxAgeDays() * 24 * 60 * 60);
  const token = signPayload(
    {
      purpose: GUEST_TOKEN_PURPOSE,
      sid: guestId,
      exp: Date.now() + maxAgeSec * 1000,
    },
    secret,
  );
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (shouldUseSecureCookies(req)) parts.push('Secure');

  // Preserve any existing Set-Cookie headers (if present).
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', parts.join('; '));
  else if (Array.isArray(prev))
    res.setHeader('Set-Cookie', [...prev, parts.join('; ')]);
  else res.setHeader('Set-Cookie', [String(prev), parts.join('; ')]);

  return guestUser(guestId);
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
 * @param {string} email - The guest address derived from the verified guest id
 * @returns {Promise<string|null>}
 */
async function resolveSandboxGuestUserId(email) {
  const result = await ensureUserByEmail(createStorageScope(null), {
    email: email,
    name: 'Guest',
    role: 'user',
    authSource: 'database',
  });
  return result?.user?.id || null;
}

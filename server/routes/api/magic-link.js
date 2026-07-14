/**
 * API routes for magic link (passwordless login) functionality.
 * Handles sending magic link emails and verifying tokens.
 */

import {
  authEnabled,
  setSessionCookie,
} from '../../auth/auth.js';
import { json, serveJson, badRequest } from '../../utils/http.js';
import { t } from '../../i18n/index.js';
import { getClientIp, createRouteContext } from '../../utils/context.js';
import { sendMagicLinkEmail } from '../../integrations/brevo.js';
import { validateEmail } from '../../utils/secure-tokens.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  createMagicToken,
  consumeMagicToken,
  isRateLimitedByEmail,
  isRateLimitedByIp,
  getOrCreateMagicLinkUser,
} from '../../storage/magic-link.js';
import { logAuthEvent, getDatabaseUser } from '../../storage/password-reset.js';

/**
 * Build the magic link URL from the token and request.
 * @param {Object} req - HTTP request
 * @param {string} token - Magic link token
 * @returns {string} - Full magic link URL
 */
function buildMagicLinkUrl(req, token) {
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/magic-login?token=${encodeURIComponent(token)}`;
}

/**
 * Get user info for magic link email.
 * @param {string} email - Email to check
 * @param {Object} ctx - Context object
 * @returns {Promise<{exists: boolean, hasPassword: boolean}>}
 */
async function getUserInfo(email, ctx) {
  const dbUser = await getDatabaseUser(normalizeEmail(email), ctx);
  return {
    exists: !!dbUser,
    hasPassword: !!dbUser?.password_hash,
  };
}

/**
 * Build the login URL for setting up a password.
 * @param {Object} req - HTTP request
 * @returns {string} - Login page URL
 */
function buildLoginUrl(req) {
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/login`;
}

export async function handleMagicLink({ repoRoot, req, res, url }) {
  const ctx = createRouteContext(null);
  ctx.repoRoot = repoRoot;

  // ============================================================
  // POST /api/auth/magic-link
  // Request a magic link email
  // ============================================================
  if (url.pathname === '/api/auth/magic-link' && req.method === 'POST') {
    if (!authEnabled()) {
      return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
    }

    const body = await json(req);
    const email = normalizeEmail(body?.email);

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return badRequest(res, t('api.error.validEmailRequired', 'Valid email is required'));
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers?.['user-agent'] || '';

    // Rate limiting
    const rateLimitedByEmail = await isRateLimitedByEmail(email);
    const rateLimitedByIp = await isRateLimitedByIp(ipAddress);

    if (rateLimitedByEmail || rateLimitedByIp) {
      await logAuthEvent({
        type: 'magic_link_rate_limited',
        email,
        success: false,
        ipAddress,
        userAgent,
        metadata: { rateLimitedByEmail, rateLimitedByIp },
      });

      // Still return success to prevent enumeration
      serveJson(res, 200, {
        ok: true,
        message: t('api.success.magicLinkSent', 'If your email is registered, a magic link has been sent. Check your inbox.'),
      });
      return true;
    }

    // Check if user exists and has a password
    const userInfo = await getUserInfo(email, ctx);

    // Log the request attempt
    await logAuthEvent({
      type: 'magic_link_request',
      email,
      success: true,
      ipAddress,
      userAgent,
      metadata: { userExists: userInfo.exists, hasPassword: userInfo.hasPassword },
    });

    // Only send magic link if user exists (prevents sending to non-existent accounts)
    if (userInfo.exists) {
      const result = await createMagicToken(email, { ipAddress, userAgent });

      if (result.ok) {
        const magicLinkUrl = buildMagicLinkUrl(req, result.token);
        const loginUrl = buildLoginUrl(req);

        // Send email with password setup hint if user doesn't have a password
        sendMagicLinkEmail({
          recipientEmail: email,
          magicLinkUrl,
          expiresAt: result.expiresAt,
          hasPassword: userInfo.hasPassword,
          loginUrl,
          repoRoot,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[magic-link] Failed to send email:', err);
        });
      }
    }

    // Always return success to prevent email enumeration
    serveJson(res, 200, {
      ok: true,
      message: t('api.success.magicLinkSent', 'If your email is registered, a magic link has been sent. Check your inbox.'),
    });
    return true;
  }

  // ============================================================
  // POST /api/auth/magic-link/verify
  // Verify a magic link token and create session
  // ============================================================
  if (url.pathname === '/api/auth/magic-link/verify' && req.method === 'POST') {
    if (!authEnabled()) {
      return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
    }

    const body = await json(req);
    const token = String(body?.token || '').trim();

    if (!token) {
      return badRequest(res, t('api.error.tokenRequired', 'Token is required'));
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers?.['user-agent'] || '';

    // Consume the token (atomic operation)
    const consumeResult = await consumeMagicToken(token);

    if (!consumeResult.ok) {
      await logAuthEvent({
        type: 'magic_link_failed',
        email: null,
        success: false,
        ipAddress,
        userAgent,
        metadata: { reason: consumeResult.reason },
      });

      serveJson(res, 200, {
        ok: false,
        reason: consumeResult.reason === 'invalid_or_expired'
          ? 'expired'
          : 'invalid',
      });
      return true;
    }

    const email = consumeResult.email;

    // Get or create the user
    const userResult = await getOrCreateMagicLinkUser(email, ctx);

    if (!userResult.ok) {
      await logAuthEvent({
        type: 'magic_link_failed',
        email,
        success: false,
        ipAddress,
        userAgent,
        metadata: { reason: userResult.reason },
      });

      return badRequest(res, t('api.error.failedToCreateSession', 'Failed to create session'));
    }

    // Log successful login
    await logAuthEvent({
      type: 'magic_link_login',
      email,
      success: true,
      ipAddress,
      userAgent,
    });

    // Set session cookie
    setSessionCookie(req, res, userResult.user);

    serveJson(res, 200, {
      ok: true,
      user: {
        email: userResult.user.email,
        name: userResult.user.name,
        role: userResult.user.role,
      },
    });
    return true;
  }

  return false;
}
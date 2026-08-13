/**
 * API routes for password reset functionality (A7.19 C8 — ROUTES table).
 * Handles forgot password, reset password, change password flows.
 *
 * Mounted **before** the auth gate (`PublicContext`); change-password
 * resolves the session itself, exactly as before. Form A throughout
 * (route-dispatch.md): every old branch was an exact path plus method with
 * fall-through on a mismatch, no 405. Table order mirrors the old branch
 * order exactly.
 */

import {
  authEnabled,
  getUserFromRequestAsync,
  setSessionCookie,
} from '../../auth/auth.js';
import { serveJson, badRequest, unauthorized, requireJsonBody , withErrorHandler } from '../../utils/http.js';
import { getString, getTrimmedString } from '../../utils/request-validators.js';
import { t } from '../../i18n/index.js';
import { getClientIp, createStorageScope } from '../../utils/context.js';
import { dispatchRoutes } from '../../utils/router.js';
import { sendPasswordResetEmail } from '../../integrations/brevo.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('password-reset');
import {
  createResetToken,
  validateResetToken,
  consumeResetToken,
  setUserPassword,
  verifyUserPassword,
  validatePassword,
  isRateLimitedByEmail,
  isRateLimitedByIp,
  logAuthEvent,
  hasDatabaseCredentials,
} from '../../storage/password-reset.js';
import { getUserByEmailGlobal } from '../../storage/identity.js';

/**
 * Build the reset URL from the token and request.
 * @param {Object} req - HTTP request
 * @param {string} token - Reset token
 * @returns {string} - Full reset URL
 */
function buildResetUrl(req, token) {
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Check if email exists in database.
 * @param {string} email - Email to check
 * @returns {Promise<boolean>} - True if user exists
 */
async function userExists(email) {
  const dbUser = await getUserByEmailGlobal(normalizeEmail(email));
  return !!dbUser;
}

/**
 * The storage context these handlers act in: no user (pre-auth), the
 * repoRoot carried alongside — the same shape the old entry built once.
 */
function resetCtx(repoRoot) {
  return createStorageScope(null, { repoRoot });
}

// ============================================================
// POST /api/auth/forgot-password
// Request a password reset email
// ============================================================
async function handleForgotPassword({ repoRoot, req, res }) {
  if (!authEnabled()) {
    return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const email = normalizeEmail(body?.email);

  if (!email || !email.includes('@')) {
    return badRequest(res, t('api.error.validEmailRequired', 'Valid email is required'));
  }

  const ipAddress = getClientIp(req);
  const userAgent = req.headers?.['user-agent'] || '';

  // Rate limiting - check before any user lookup to prevent enumeration
  const rateLimitedByEmail = await isRateLimitedByEmail(email);
  const rateLimitedByIp = await isRateLimitedByIp(ipAddress);

  if (rateLimitedByEmail || rateLimitedByIp) {
    // Log rate limit event
    await logAuthEvent({
      type: 'password_reset_rate_limited',
      email,
      success: false,
      ipAddress,
      userAgent,
      metadata: { rateLimitedByEmail, rateLimitedByIp },
    });

    // Still return success to prevent enumeration
    serveJson(res, 200, {
      ok: true,
      message: t('api.success.resetLinkSent', 'If an account exists with this email, a reset link has been sent.'),
    });
    return true;
  }

  // Check if user exists (ENV or database)
  const exists = await userExists(email);

  // Log the request attempt
  await logAuthEvent({
    type: 'password_reset_request',
    email,
    success: exists,
    ipAddress,
    userAgent,
  });

  // If user exists, create token and send email
  if (exists) {
    const result = await createResetToken(email, { ipAddress, userAgent });

    if (result.ok) {
      const resetUrl = buildResetUrl(req, result.token);

      // Send email (fire and forget - don't block on email delivery)
      sendPasswordResetEmail({
        recipientEmail: email,
        resetUrl,
        expiresAt: result.expiresAt,
        repoRoot,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        log.error('[password-reset] Failed to send email:', err);
      });
    }
  }

  // Always return success to prevent email enumeration
  serveJson(res, 200, {
    ok: true,
    message: t('api.success.resetLinkSent', 'If an account exists with this email, a reset link has been sent.'),
  });
  return true;
}

// ============================================================
// GET /api/auth/reset-password/validate?token=xxx
// Validate a reset token without consuming it
// ============================================================
async function handleResetPasswordValidate({ res, url }) {
  if (!authEnabled()) {
    return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
  }

  const token = url.searchParams.get('token');
  if (!token) {
    return badRequest(res, t('api.error.tokenRequired', 'Token is required'));
  }

  const result = await validateResetToken(token);

  if (!result.ok) {
    serveJson(res, 200, {
      ok: false,
      reason: result.reason,
    });
    return true;
  }

  serveJson(res, 200, {
    ok: true,
    maskedEmail: result.maskedEmail,
    expiresAt: result.expiresAt,
  });
  return true;
}

// ============================================================
// POST /api/auth/reset-password
// Reset password using a token
// ============================================================
async function handleResetPassword({ repoRoot, req, res }) {
  const ctx = resetCtx(repoRoot);

  if (!authEnabled()) {
    return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const token = getTrimmedString(body, 'token') || '';
  const password = getString(body, 'password');

  if (!token) {
    return badRequest(res, t('api.error.tokenRequired', 'Token is required'));
  }

  // Validate password
  const pwValidation = validatePassword(password);
  if (!pwValidation.ok) {
    return badRequest(res, pwValidation.reason === 'too_short'
      ? t('api.error.passwordTooShort', 'Password is too short (minimum 8 characters)')
      : t('api.error.passwordInvalid', 'Password is invalid'));
  }

  const ipAddress = getClientIp(req);
  const userAgent = req.headers?.['user-agent'] || '';

  // Consume the token
  const consumeResult = await consumeResetToken(token);

  if (!consumeResult.ok) {
    await logAuthEvent({
      type: 'password_reset_failed',
      email: null,
      success: false,
      ipAddress,
      userAgent,
      metadata: { reason: consumeResult.reason },
    });

    return badRequest(res, consumeResult.reason === 'invalid_or_expired'
      ? t('api.error.resetLinkExpired', 'This reset link is invalid or has expired. Please request a new one.')
      : t('api.error.invalidResetToken', 'Invalid reset token'));
  }

  const email = consumeResult.email;

  // Set the new password (creates/updates database user)
  const setResult = await setUserPassword(ctx, email, password);

  if (!setResult.ok) {
    await logAuthEvent({
      type: 'password_reset_failed',
      email,
      success: false,
      ipAddress,
      userAgent,
      metadata: { reason: setResult.reason },
    });

    return badRequest(res, t('api.error.failedToSetPassword', 'Failed to set password'));
  }

  // Log successful password reset
  await logAuthEvent({
    type: 'password_reset_success',
    email,
    success: true,
    ipAddress,
    userAgent,
  });

  serveJson(res, 200, {
    ok: true,
    message: t('api.success.passwordReset', 'Password has been reset successfully. You can now log in with your new password.'),
  });
  return true;
}

// ============================================================
// POST /api/auth/change-password
// Change password for logged-in user
// ============================================================
async function handleChangePassword({ repoRoot, req, res }) {
  const ctx = resetCtx(repoRoot);

  if (!authEnabled()) {
    return badRequest(res, t('api.error.authNotEnabled', 'Authentication is not enabled'));
  }

  // Get authenticated user
  const user = await getUserFromRequestAsync(req, ctx);
  if (!user) {
    return unauthorized(res, t('api.error.mustBeLoggedIn', 'You must be logged in to change your password'));
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const currentPassword = getString(body, 'currentPassword');
  const newPassword = getString(body, 'newPassword');

  // Validate new password
  const pwValidation = validatePassword(newPassword);
  if (!pwValidation.ok) {
    return badRequest(res, pwValidation.reason === 'too_short'
      ? t('api.error.passwordTooShort', 'Password is too short (minimum 8 characters)')
      : t('api.error.passwordInvalid', 'Password is invalid'));
  }

  const ipAddress = getClientIp(req);
  const userAgent = req.headers?.['user-agent'] || '';
  const email = user.email;

  // Verify current password
  const hasDbCreds = await hasDatabaseCredentials(email);
  if (!hasDbCreds) {
    return badRequest(res, t('api.error.noDbCredentials', 'Cannot change password - no database credentials found'));
  }

  const isCurrentValid = await verifyUserPassword(email, currentPassword);
  if (!isCurrentValid) {
    await logAuthEvent({
      type: 'password_change_failed',
      email,
      success: false,
      ipAddress,
      userAgent,
      metadata: { reason: 'invalid_current_password' },
    });

    return badRequest(res, t('api.error.currentPasswordIncorrect', 'Current password is incorrect'));
  }

  // Set the new password
  const setResult = await setUserPassword(ctx, email, newPassword);

  if (!setResult.ok) {
    await logAuthEvent({
      type: 'password_change_failed',
      email,
      success: false,
      ipAddress,
      userAgent,
      metadata: { reason: setResult.reason },
    });

    return badRequest(res, t('api.error.failedToSetNewPassword', 'Failed to set new password'));
  }

  // Log successful password change
  await logAuthEvent({
    type: 'password_change_success',
    email,
    success: true,
    ipAddress,
    userAgent,
  });

  // Get updated user for new session
  const { verifyLoginAsync } = await import('../../auth/auth.js');
  const newUser = await verifyLoginAsync(email, newPassword, ctx);

  if (newUser) {
    // Set new session cookie with updated version
    setSessionCookie(req, res, newUser);
  }

  serveJson(res, 200, {
    ok: true,
    message: t('api.success.passwordChanged', 'Password has been changed successfully.'),
  });
  return true;
}

/** @type {import('../../utils/router.js').Route[]} */
export const ROUTES = [
  { method: 'POST', pattern: '/api/auth/forgot-password', handler: handleForgotPassword },
  { method: 'GET', pattern: '/api/auth/reset-password/validate', handler: handleResetPasswordValidate },
  { method: 'POST', pattern: '/api/auth/reset-password', handler: handleResetPassword },
  { method: 'POST', pattern: '/api/auth/change-password', handler: handleChangePassword },
];

/**
 * Handle the password-reset endpoints.
 * @param {import('../../utils/context.js').PublicContext} ctx
 */
export const handlePasswordReset = withErrorHandler('password-reset', async (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});

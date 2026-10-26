/**
 * The first admin of a fresh install, from `AUTH_ADMIN_EMAIL` (D192).
 *
 * Without SSO there was no documented way to a first admin: every login path
 * needs an existing `users` row and only an admin creates one. At boot, when
 * auth is on and the user table is empty, this creates that address as a
 * passwordless admin. Magic link or password reset then sets up the first
 * session; under `SSO_ENFORCE` those are refused (D188) and the first login
 * runs through the IdP, which matches the existing row by address.
 *
 * Once any user exists this writes nothing, so there is no second
 * user-creation path next to the admin UI.
 *
 * @module auth/first-admin
 */

import { createStorageScope } from '../utils/context.js';
import { createFirstAdmin } from '../storage/users.js';
import { envBool, envStr } from '../config/utils.js';
import { isSsoEnabled } from '../config/sso.js';
import {
  isEmailConfigured,
  getSenderIdentity,
} from '../integrations/email/index.js';
import { createLogger } from '../utils/logger.js';
import { authEnabled } from './auth.js';

const log = createLogger('auth');

/**
 * Create the `AUTH_ADMIN_EMAIL` admin when the user table is empty.
 * Skipped without auth, in sandbox/demo mode and without the env var.
 * @returns {Promise<{created: boolean, reason?: string}>}
 */
export async function bootstrapFirstAdmin() {
  if (!authEnabled()) return { created: false, reason: 'auth_disabled' };
  if (envBool('SANDBOX_MODE') || envBool('DEMO_MODE')) {
    return { created: false, reason: 'sandbox' };
  }
  const email = envStr('AUTH_ADMIN_EMAIL');
  if (!email) return { created: false, reason: 'no_admin_email' };

  const result = await createFirstAdmin(createStorageScope(null), email);
  if (result.reason === 'invalid') {
    log.warn(
      `AUTH_ADMIN_EMAIL "${email}" is not a valid address; no first admin created.`,
    );
  }
  if (!result.created) return { created: false, reason: result.reason };

  log.info(
    `Created the first admin ${result.user.email} from AUTH_ADMIN_EMAIL. ` +
      (isSsoEnabled()
        ? 'Sign in through SSO with that address.'
        : 'Sign in with a magic link or "Forgot password" on the login page.'),
  );
  if (
    !isSsoEnabled() &&
    !isEmailConfigured(await getSenderIdentity(process.cwd()))
  ) {
    log.warn(
      'The first admin signs in through an emailed link, but outgoing mail is ' +
        'not configured, so no mail can be sent. Configure email (or SSO) and restart.',
    );
  }
  return { created: true };
}

/**
 * The language an outgoing mail is written in.
 *
 * A mail is read by its recipient, not by the process that sends it, so the
 * locale travels with the send. This module is the one place that answers
 * "which language does this address read?" — the senders ask it for their own
 * recipient (B400), so no call site derives or defaults a locale of its own.
 */

import { normalizeLocale } from '../../i18n/index.js';
import {
  DEFAULT_LOCALE,
  getEmailDefaultLocale,
} from '../../storage/email-templates.js';
import { getStoredUiLocale } from '../../storage/settings.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('email');

/**
 * Resolve the locale to write to one recipient in.
 *
 * One chain, in this order:
 *
 * 1. the recipient's own stored `uiLocale`, when it names a locale this
 *    install has strings for;
 * 2. otherwise the install's mail default — the admin's "default language"
 *    under Settings > Email templates (`getEmailDefaultLocale()`), which
 *    answers `DEFAULT_LOCALE` until an admin sets it.
 *
 * Step 2 covers everyone who has not chosen: a guest without an account, an
 * invitee whose account was created a moment ago, a preference like `de` that
 * has no translation file. There is no third default: a settings read that
 * fails lands on `DEFAULT_LOCALE`, the value step 2 falls back to itself.
 *
 * **Reading this preference is not an enumeration leak.** The locale never
 * reaches the requester, only the mailbox of the recipient; the routes that
 * send on an unauthenticated request (password reset, magic link) answer the
 * HTTP request identically either way.
 *
 * @param {Object} options
 * @param {string|null} options.repoRoot - Repository root for the settings read.
 * @param {string} options.email - Recipient address.
 * @returns {Promise<string>} A locale in `SUPPORTED_LOCALES`.
 */
export async function resolveRecipientLocale({ repoRoot, email }) {
  const scope = crossOrganizationScope(
    repoRoot ?? null,
    'outgoing mail: the recipient reads it in their own language',
  );
  const address = String(email || '').trim();

  try {
    const own = address
      ? normalizeLocale(await getStoredUiLocale(scope, address))
      : null;
    return own || (await getEmailDefaultLocale(scope));
  } catch (err) {
    // A mail in the wrong language beats no mail: this sits in front of a
    // password reset, so a settings read that fails must not stop the send.
    log.warn(
      `Could not read the recipient locale, sending in ${DEFAULT_LOCALE}:`,
      err.message,
    );
    return DEFAULT_LOCALE;
  }
}

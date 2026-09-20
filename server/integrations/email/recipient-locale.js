/**
 * The language an outgoing mail is written in.
 *
 * A mail is read by its recipient, not by the process that sends it, so the
 * locale travels with the send. This module is the one place that answers
 * "which language does this address read?" — call sites pass the answer to a
 * sender rather than deriving it again.
 */

import { normalizeLocale } from '../../i18n/index.js';
import { DEFAULT_LOCALE } from '../../storage/email-templates.js';
import { getUserSettings } from '../../storage/settings.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('email');

// The language Deckyard writes in when it has nothing better to go on is the
// mail default locale, not a second constant beside it: `DEFAULT_LOCALE`
// already names that meaning and `email-template-resolver.js` falls back to
// the same value one layer down. Which language that should be is D190/B380.

/**
 * Resolve the locale to write to one recipient in.
 *
 * Answers the recipient's own `uiLocale` when they have an account and that
 * preference names a locale this install has strings for; `en` otherwise —
 * for an address without an account, for a preference like `de` that has no
 * translation file, and for a settings read that fails.
 *
 * **Reading this preference is not an enumeration leak.** The callers that
 * need it (password reset, magic link) only send at all when the account
 * exists, and they answer the HTTP request identically either way; the locale
 * never reaches the requester, only the mailbox of the account holder.
 *
 * @param {Object} options
 * @param {string|null} options.repoRoot - Repository root for the settings read.
 * @param {string} options.email - Recipient address.
 * @returns {Promise<string>} A locale in `SUPPORTED_LOCALES`.
 */
export async function resolveRecipientLocale({ repoRoot, email }) {
  const address = String(email || '').trim();
  if (!address) return DEFAULT_LOCALE;

  try {
    const settings = await getUserSettings(
      crossOrganizationScope(
        repoRoot ?? null,
        'outgoing mail: the recipient reads it in their own language',
      ),
      address,
    );
    return normalizeLocale(settings?.uiLocale) || DEFAULT_LOCALE;
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

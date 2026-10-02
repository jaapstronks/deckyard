import { t } from '../ui-i18n.js';
import { displayNameFromEmail as deriveDisplayName } from '../../../shared/display-name.js';

/**
 * Convert an email address to a display name, localized.
 *
 * The derivation itself lives in `shared/display-name.js` — the server stamps
 * `displayName` onto API responses with the same rule (D22), and one rule with
 * two implementations is how the two sides drifted apart before. This wrapper
 * adds the only client-specific part: what an *absent* identity reads as.
 *
 * @param {string} email - Email address
 * @returns {string} Display name
 */
export function displayNameFromEmail(email) {
  return deriveDisplayName(email) || t('common.unknown', 'Unknown');
}

/**
 * Get initials from a name.
 *
 * @param {string} name - Full name
 * @returns {string} 1-2 character initials
 */
export function initialsForName(name) {
  const s = String(name || '').trim();
  if (!s) return t('common.unknownInitials', '??');
  const parts = s.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '?';
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1];
  return (first + (second || '')).toUpperCase();
}

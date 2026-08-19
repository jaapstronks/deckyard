import { t } from '../ui-i18n.js';

/**
 * Convert an email address to a display name.
 * Extracts the local part and capitalizes words.
 *
 * @param {string} email - Email address
 * @returns {string} Display name
 */
export function displayNameFromEmail(email) {
  const raw = String(email || '').trim();
  if (!raw) return t('common.unknown', 'Unknown');
  if (!raw.includes('@')) return raw;
  const local = raw.split('@')[0];
  const cleaned = local
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return raw;
  const cap = (s) => s.slice(0, 1).toUpperCase() + s.slice(1);
  return parts.slice(0, 3).map(cap).join(' ');
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

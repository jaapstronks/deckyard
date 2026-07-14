import { t } from './ui-i18n.js';

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

/**
 * Format relative time from an ISO date string.
 *
 * @param {string} iso - ISO date string
 * @returns {string} Relative time string (e.g., "5 min ago")
 */
export function fmtRelativeTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return String(iso || '');
  const diffMs = Date.now() - d.getTime();
  const diffS = Math.max(0, Math.floor(diffMs / 1000));
  if (diffS < 30) return t('list.time.justNow', 'just now');
  if (diffS < 60)
    return t('list.time.secondsAgo', '{count}s ago', { count: diffS });
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60)
    return t('list.time.minutesAgo', '{count} min ago', { count: diffM });
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24)
    return t('list.time.hoursAgo', '{count}h ago', { count: diffH });
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)
    return t('list.time.daysAgo', '{count}d ago', { count: diffD });
  // Fall back to full date
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
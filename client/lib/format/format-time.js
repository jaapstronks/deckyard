/**
 * Shared time formatting utilities.
 */

import { getUiLocale } from '../ui-i18n.js';

// One Intl.RelativeTimeFormat per locale; construction is not free and list
// views format a timestamp per row.
const relativeFormatCache = new Map();

function relativeFormat(locale) {
  let fmt = relativeFormatCache.get(locale);
  if (!fmt) {
    try {
      fmt = new Intl.RelativeTimeFormat(locale, {
        numeric: 'auto',
        style: 'long',
      });
    } catch {
      fmt = new Intl.RelativeTimeFormat('en', {
        numeric: 'auto',
        style: 'long',
      });
    }
    relativeFormatCache.set(locale, fmt);
  }
  return fmt;
}

/**
 * Format an ISO timestamp as a relative time string ("5 minutes ago",
 * "yesterday") in the UI locale; a week or older becomes a date in that
 * locale.
 *
 * The single canonical relative-time formatter (B148 batch14). The wording
 * comes from CLDR through `Intl.RelativeTimeFormat`, so there are no
 * translation keys for it: plurals and "yesterday" are the platform's.
 *
 * @param {string|Date} isoString - ISO 8601 timestamp (or a Date)
 * @returns {string} Formatted relative time, '' for empty or invalid input
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';

  const locale = getUiLocale();
  const fmt = relativeFormat(locale);
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return fmt.format(0, 'second');
  if (minutes < 60) return fmt.format(-minutes, 'minute');
  if (hours < 24) return fmt.format(-hours, 'hour');
  if (days < 7) return fmt.format(-days, 'day');
  try {
    return date.toLocaleDateString(locale);
  } catch {
    return date.toLocaleDateString('en');
  }
}

/**
 * Shared formatting utilities for analytics views.
 * Centralizes common formatting functions to avoid duplication.
 */

import { getUiLocale, t } from '../ui-i18n.js';

/**
 * Format duration in seconds to human readable format.
 * @param {number} seconds - Duration in seconds
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.short] - Use short format (e.g., "3s" instead of "0:03")
 * @param {boolean} [options.dashIfZero] - Render a falsy / sub-second value as "—"
 * @returns {string} Formatted duration (e.g., "3:45" or "1:23:45")
 */
export function formatDuration(
  seconds,
  { short = false, dashIfZero = false } = {},
) {
  if (dashIfZero && (!seconds || seconds < 1)) return '—';
  const s = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (short) {
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}:${String(secs).padStart(2, '0')}`;
    return `${secs}s`;
  }

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format a date string for display in the UI locale. The single canonical
 * date formatter.
 *
 * `short` renders the compact numeric day-and-month form ("1/15" in English,
 * "15-1" in Dutch). Any other
 * `Intl.DateTimeFormat` options are passed straight through to
 * `toLocaleDateString`, so views that need a weekday, month name or a time
 * component request it explicitly instead of defining their own formatter.
 *
 * @param {string} dateStr - ISO date string or date
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.short] - Use compact numeric day and month; takes precedence
 * @param {...Intl.DateTimeFormatOptions} [options] - Passed through to toLocaleDateString
 * @returns {string} Formatted date
 */
export function formatDate(dateStr, { short = false, ...intlOptions } = {}) {
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return String(dateStr || '');
    const locale = getUiLocale();
    if (short) {
      return date.toLocaleDateString(locale, {
        month: 'numeric',
        day: 'numeric',
      });
    }
    return date.toLocaleDateString(locale, intlOptions);
  } catch {
    return String(dateStr || '');
  }
}

/**
 * Format a whole-number count with the UI locale's thousands separators
 * ("1,234" in English, "1.234" in Dutch).
 * @param {number} n - Number to format
 * @returns {string}
 */
export function formatCount(n) {
  return Number(n || 0).toLocaleString(getUiLocale());
}

/**
 * Format a large number compactly with a K/M suffix (e.g. "1.2K", "3.4M").
 * @param {number} num - Number to format
 * @returns {string}
 */
export function formatCompact(num) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

/**
 * Format a rate/ratio as percentage.
 * @param {number} rate - Rate between 0 and 1
 * @returns {string}
 */
export function formatPercent(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}

/**
 * Get display label for analytics source type.
 * @param {string} type - Source type ('share_link', 'follow', 'embed')
 * @returns {string} Localized display label
 */
export function getSourceLabel(type) {
  switch (type) {
    case 'share_link':
      return t('analytics.sourceShareLink', 'Share Link');
    case 'follow':
      return t('analytics.sourceFollow', 'Follow');
    case 'published':
      return t('analytics.sourcePublished', 'Published');
    case 'embed':
      return t('analytics.sourceEmbed', 'Embed');
    default:
      return type || t('analytics.sourceDirect', 'Direct');
  }
}

/**
 * Format time in short form for compact display.
 * @param {number} seconds - Duration in seconds
 * @returns {string} Short formatted time (e.g., "45s", "2:30")
 */
export function formatTimeShort(seconds) {
  return formatDuration(seconds, { short: true });
}

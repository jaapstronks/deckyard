/**
 * Shared formatting utilities for analytics views.
 * Centralizes common formatting functions to avoid duplication.
 */

import { t } from '../ui-i18n.js';

/**
 * Format duration in seconds to human readable format.
 * @param {number} seconds - Duration in seconds
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.short] - Use short format (e.g., "3s" instead of "0:03")
 * @param {boolean} [options.dashIfZero] - Render a falsy / sub-second value as "—"
 * @returns {string} Formatted duration (e.g., "3:45" or "1:23:45")
 */
export function formatDuration(seconds, { short = false, dashIfZero = false } = {}) {
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
 * Format a date string for display. The single canonical date formatter.
 *
 * `short` renders the compact numeric "M/D" form. Any other
 * `Intl.DateTimeFormat` options are passed straight through to
 * `toLocaleDateString`, so views that need a weekday, month name or a time
 * component request it explicitly instead of defining their own formatter.
 *
 * @param {string} dateStr - ISO date string or date
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.short] - Use compact numeric format (e.g., "1/15"); takes precedence
 * @param {...Intl.DateTimeFormatOptions} [options] - Passed through to toLocaleDateString
 * @returns {string} Formatted date
 */
export function formatDate(dateStr, { short = false, ...intlOptions } = {}) {
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return String(dateStr || '');
    if (short) {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
    if (Object.keys(intlOptions).length) {
      return date.toLocaleDateString(undefined, intlOptions);
    }
    return date.toLocaleDateString();
  } catch {
    return String(dateStr || '');
  }
}

/**
 * Format number with thousands separator.
 * @param {number} n - Number to format
 * @returns {string}
 */
export function formatNumber(n) {
  return Number(n || 0).toLocaleString();
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
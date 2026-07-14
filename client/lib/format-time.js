/**
 * Shared time formatting utilities.
 */

/**
 * Format an ISO timestamp as a relative time string.
 * @param {string} isoString - ISO 8601 timestamp
 * @param {Function} t - Translation function
 * @returns {string} Formatted relative time
 */
export function formatRelativeTime(isoString, t) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('list.time.justNow', 'just now');
    if (minutes < 60) return t('list.time.minutesAgo', '{count} min ago', { count: minutes });
    if (hours < 24) return t('list.time.hoursAgo', '{count}h ago', { count: hours });
    if (days < 7) return t('list.time.daysAgo', '{count}d ago', { count: days });
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}
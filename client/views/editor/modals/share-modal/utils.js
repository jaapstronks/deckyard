/**
 * Utility functions for the share modal.
 */

/**
 * Calculate expiration date from a duration value.
 * @param {string} value - Duration string (e.g., '1h', '24h', '7d', '30d')
 * @returns {string|null} ISO date string or null if no expiration
 */
export function getExpiresAt(value) {
  if (!value) return null;
  const now = Date.now();
  const ms = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now + (ms[value] || 0)).toISOString();
}

/**
 * Get human-readable label for a share-link permission level.
 * Share links are only issued as 'view' or 'comment' (there is no
 * guest-editing flow), so 'edit' is intentionally not represented here.
 * @param {string} permission - Permission level (view, comment)
 * @returns {string} Human-readable label
 */
export function getPermissionLabel(permission) {
  const labels = {
    view: 'View',
    comment: 'Comment',
  };
  return labels[permission] || permission;
}

/**
 * Format expiration date as a relative time string.
 * @param {Date} date - Expiration date
 * @returns {string} Relative time string (e.g., '7d', '2h', '<1h')
 */
export function formatExpiration(date) {
  const now = new Date();
  const diff = date - now;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));

  if (days > 1) return `${days}d`;
  if (hours > 1) return `${hours}h`;
  return '<1h';
}
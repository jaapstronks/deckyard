/**
 * Utility functions for the share modal.
 */

import { normalizeEmail } from '../../../../../shared/email.js';

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

/**
 * Find the collaborator a typed address names among those eligible to take
 * over the deck. The typed address is folded once (D200); the collaborators'
 * addresses come from the server in that spelling and are compared bare.
 * @param {Array<{ userEmail: string }>} eligibleUsers - Collaborators with
 *   edit or admin permission
 * @param {string} typed - The address as the user typed it
 * @returns {{ userEmail: string }|null} The matching collaborator, or null
 */
export function findEligibleOwner(eligibleUsers, typed) {
  const email = normalizeEmail(typed);
  if (!email) return null;
  return eligibleUsers.find((u) => u.userEmail === email) || null;
}

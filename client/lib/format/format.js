import { getUiLocale } from '../ui-i18n.js';

/**
 * Format an ISO timestamp as a full date-and-time string in the UI locale.
 * @param {string} iso - ISO 8601 timestamp
 * @returns {string}
 */
export function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString(getUiLocale());
  } catch {
    return iso;
  }
}

/**
 * Human-readable byte size (B / KB / MB). Empty string for a falsy size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

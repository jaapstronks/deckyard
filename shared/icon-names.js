/**
 * Central icon-name registry (Lucide Icons).
 *
 * All icon references across the app should resolve through this module.
 * The full curated set (grouped into categories) lives in `icon-catalog.js`;
 * this module flattens it into ICON_NAMES and handles resolution + legacy
 * Phosphor name mapping.
 *
 * Existing presentations may store old Phosphor icon names in their data;
 * LEGACY_PHOSPHOR_MAP transparently resolves them to Lucide equivalents.
 */

import { CATALOG_ICON_NAMES } from './icon-catalog.js';

export { ICON_CATEGORIES } from './icon-catalog.js';

/**
 * Flat list of every available icon name, derived from the curated catalog.
 * @type {string[]}
 */
export const ICON_NAMES = CATALOG_ICON_NAMES;

/**
 * Maps old Phosphor icon names to their Lucide equivalents.
 * Used to resolve icon references in existing presentation data.
 */
export const LEGACY_PHOSPHOR_MAP = {
  'rocket-launch': 'rocket',
  'magnifying-glass': 'search',
  'users-three': 'users-round',
  'sparkle': 'sparkles',
  'gear': 'settings',
  'check-circle': 'circle-check',
  'warning-circle': 'circle-alert',
  'arrows-clockwise': 'refresh-cw',
  'chat-circle-dots': 'message-circle',
  'clipboard-text': 'clipboard',
  'envelope': 'mail',
  'chart-line-up': 'chart-line',
  'microphone': 'mic',
  'trend-up': 'trending-up',
  'video-camera': 'video',
  // ui-mode-switcher used 'desktop' for the system/monitor icon
  'desktop': 'monitor',
};

/**
 * Resolve an icon name, transparently mapping legacy Phosphor names.
 * @param {string} name - Icon name (may be a legacy Phosphor name)
 * @returns {string} Resolved Lucide icon name, or the original if unknown
 */
export function resolveIconName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return LEGACY_PHOSPHOR_MAP[n] || n;
}

/**
 * Return the URL for a vendored Lucide icon SVG.
 * @param {string} name - Icon name (legacy Phosphor names are resolved automatically)
 * @returns {string} URL path, or empty string if invalid
 */
export function iconUrl(name) {
  const resolved = resolveIconName(name);
  if (!resolved) return '';
  if (!/^[a-z0-9-]+$/.test(resolved)) return '';
  return `/client/vendor/lucide-icons/${resolved}.svg`;
}

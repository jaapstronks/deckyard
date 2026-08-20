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
 * Lucide names used for **UI chrome** — buttons, toolbars, menus, drag
 * handles. These are written by us in code (see `icon()` in
 * `client/lib/dom/icons.js`), never chosen by an author.
 *
 * This list exists so chrome glyphs get vendored independently of the picker
 * catalog: the catalog is what an author may *choose*, this is what the app
 * *uses*. Names may appear in both (an author can also pick `lock`); a name
 * only here is vendored but never offered as slide content.
 *
 * Add a name here before calling `icon()` with it, then re-run
 * `npm run vendor:lucide` so the SVG lands in client/vendor/lucide-icons/.
 * @type {string[]}
 */
export const UI_ICON_NAMES = [
  'chevron-down',
  'copy',
  'ellipsis',
  'grip-vertical',
  'lock',
  'lock-open',
  'trash-2',
  'x',
  'zoom-in',
];

/**
 * Maps old Phosphor icon names to their Lucide equivalents.
 * Used to resolve icon references in existing presentation data.
 */
export const LEGACY_PHOSPHOR_MAP = {
  'rocket-launch': 'rocket',
  'magnifying-glass': 'search',
  'users-three': 'users-round',
  sparkle: 'sparkles',
  gear: 'settings',
  'check-circle': 'circle-check',
  'warning-circle': 'circle-alert',
  'arrows-clockwise': 'refresh-cw',
  'chat-circle-dots': 'message-circle',
  'clipboard-text': 'clipboard',
  envelope: 'mail',
  'chart-line-up': 'chart-line',
  microphone: 'mic',
  'trend-up': 'trending-up',
  'video-camera': 'video',
  // ui-mode-switcher used 'desktop' for the system/monitor icon
  desktop: 'monitor',
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

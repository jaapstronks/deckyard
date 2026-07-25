/**
 * Local (per-browser) preferences for the insert-slide type picker.
 *
 * This module owns every localStorage key the picker touches — the view mode,
 * preview surface, per-section collapsed state, and the local-only "most used"
 * / "pinned" signals — so the render seam never talks to storage directly. All
 * functions are pure over storage; none close over picker render state.
 */

import { storage } from '../../../lib/storage.js';
import { VIEW_MODES } from './data.js';

// Thumbnail view mode ('schematic' | 'preview'), persisted locally.
const VIEW_KEY = 'ps-slide-picker-view';

// Which category sections start collapsed when the user has no stored
// preference. Interactive slides are findable but out of the way by default.
const DEFAULT_COLLAPSED = new Set(['interaction']);
const COLLAPSED_KEY = 'ps-slide-picker-collapsed';

// Quick-access rows above the categories, both local-only.
const USAGE_KEY = 'ps-slide-type-usage'; // { type: count }
const PINS_KEY = 'ps-slide-type-pins'; // [type, ...]

// Forced preview surface ('' = auto). Validated against the surfaces each theme
// actually offers at render time, so a stale value from another theme can't stick.
const BG_KEY = 'ps-slide-picker-bg';

// --- View mode ---------------------------------------------------------
export const readViewMode = () => {
  const stored = storage.get(VIEW_KEY, '') || '';
  return VIEW_MODES.has(stored) ? stored : 'schematic';
};
export const persistViewMode = (mode) => storage.set(VIEW_KEY, mode);

// --- Preview surface ---------------------------------------------------
export const readSurface = () => storage.get(BG_KEY, '') || '';
export const persistSurface = (surface) => storage.set(BG_KEY, surface);

// --- Usage tracking (local-only "most used") ---------------------------
export const getUsage = () => {
  const raw = storage.getJSON(USAGE_KEY, null);
  return raw && typeof raw === 'object' ? raw : {};
};
export const bumpUsage = (type) => {
  const u = getUsage();
  u[type] = (Number(u[type]) || 0) + 1;
  storage.setJSON(USAGE_KEY, u);
};

// --- Pinned favourites -------------------------------------------------
export const getPins = () => {
  const raw = storage.getJSON(PINS_KEY, null);
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
};
export const isPinned = (type) => getPins().includes(type);
export const togglePin = (type) => {
  const pins = getPins();
  const i = pins.indexOf(type);
  if (i >= 0) pins.splice(i, 1);
  else pins.push(type);
  storage.setJSON(PINS_KEY, pins);
  return i < 0; // true when now pinned
};

// --- Per-section collapsed state ---------------------------------------
// Persisted so it survives reopening the modal. (Must use getJSON/setJSON —
// storage.get/set only round-trip strings.)
const getCollapsedMap = () => {
  const raw = storage.getJSON(COLLAPSED_KEY, null);
  return raw && typeof raw === 'object' ? raw : {};
};
export const isSectionCollapsed = (key) => {
  const map = getCollapsedMap();
  return key in map ? !!map[key] : DEFAULT_COLLAPSED.has(key);
};
export const setSectionCollapsed = (key, collapsed) => {
  const map = getCollapsedMap();
  map[key] = !!collapsed;
  storage.setJSON(COLLAPSED_KEY, map);
};

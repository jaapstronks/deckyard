// Slide clipboard for copying/pasting slides between presentations
// Uses localStorage so clipboard persists across page navigations
//
// ## The shape, and why it carries ids
//
// Every copy path expands the selection with the children of a selected parent
// (slides-panel-actions.js, keyboard-nav.js) — copying a parent is meant to
// take its nested slides with it. The clipboard used to store `{type, content,
// notes}` only, so the parent/child relation died in the clipboard and the
// paste landed the whole set flat. A copied slide therefore carries its own
// `id` and its `parentId`: exactly the two fields `cloneSlidesForInsert()`
// reads to re-point a child at its parent's clone (clone-slides.js).
//
// The ids are the deck's own, stored raw. They are only ever read back through
// the clone helper, which mints fresh ids for everything it inserts, so a paste
// into the source deck cannot collide — and a relative encoding (a parent index
// rather than an id pair) would be a second shape for the one thing
// `cloneSlidesForInsert` already speaks. One form, no translation layer.
//
// The stored `version` is the whole compatibility story: a clipboard written in
// an older shape reads as *no* clipboard, which is the intended hard break
// rather than a second accepted shape to keep alive. The cost is a paste bar
// that disappears once after an upgrade — the entry lives in localStorage for
// at most 24 hours anyway.

import { storage } from '../storage.js';

const STORAGE_KEY = 'ps:slide-clipboard';

/** The one shape `copySlides` writes and `getClipboardSlides` accepts. */
const CLIPBOARD_VERSION = 2;

/**
 * Copy slides to clipboard
 * @param {Array} slides - Array of slide objects to copy, in deck order
 * @returns {boolean} Whether the clipboard was written
 */
export function copySlides(slides) {
  if (!Array.isArray(slides) || slides.length === 0) return false;
  const data = {
    version: CLIPBOARD_VERSION,
    timestamp: Date.now(),
    slides: slides.map((s) => ({
      id: s.id ?? null,
      parentId: s.parentId ?? null,
      type: s.type,
      content: s.content,
      notes: s.notes || '',
    })),
  };
  return storage.setJSON(STORAGE_KEY, data);
}

/**
 * Get slides from clipboard
 * @returns {Array|null} Array of slide objects or null if empty/invalid
 */
export function getClipboardSlides() {
  const data = storage.getJSON(STORAGE_KEY);
  if (
    !data ||
    data.version !== CLIPBOARD_VERSION ||
    !Array.isArray(data.slides)
  )
    return null;
  // Don't return stale clipboard (older than 24 hours)
  if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
    clearClipboard();
    return null;
  }
  return data.slides;
}

/**
 * Get number of slides in clipboard
 * @returns {number}
 */
export function getClipboardCount() {
  const slides = getClipboardSlides();
  return slides ? slides.length : 0;
}

/**
 * Clear the clipboard
 */
function clearClipboard() {
  storage.remove(STORAGE_KEY);
}

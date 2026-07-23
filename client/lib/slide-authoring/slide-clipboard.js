// Slide clipboard for copying/pasting slides between presentations
// Uses localStorage so clipboard persists across page navigations

import { storage } from '../storage.js';

const STORAGE_KEY = 'ps:slide-clipboard';

/**
 * Copy slides to clipboard
 * @param {Array} slides - Array of slide objects to copy
 */
export function copySlides(slides) {
  if (!Array.isArray(slides) || slides.length === 0) return false;
  const data = {
    version: 1,
    timestamp: Date.now(),
    slides: slides.map((s) => ({
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
  if (!data || data.version !== 1 || !Array.isArray(data.slides)) return null;
  // Don't return stale clipboard (older than 24 hours)
  if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
    clearClipboard();
    return null;
  }
  return data.slides;
}

/**
 * Check if clipboard has slides
 * @returns {boolean}
 */
export function hasClipboardSlides() {
  return getClipboardSlides() !== null;
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
export function clearClipboard() {
  storage.remove(STORAGE_KEY);
}
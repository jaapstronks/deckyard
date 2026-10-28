/**
 * The hand-over from a generation (the AI wizard, the file and Notion
 * imports) to the editor's deck review in the same tab (B590).
 *
 * `?aiReview=1` only opens the review; it is the link an agent gets too
 * (`reviewUrl`), so it can never be what offers to throw the deck away. The
 * "Discard deck" action belongs to the moment right after a generation, and
 * that moment is handed over in memory: it does not survive a reload, a
 * shared link or a second tab, and it is taken once.
 */

import { nav } from './router.js';

/** @type {string|null} the id of the deck this tab just generated */
let justGenerated = null;

/**
 * Open a deck this tab just generated in the editor, with its review on top
 * and the discard action offered.
 *
 * @param {string} id - the new presentation's id
 * @param {string} lang - the language version to open
 */
export function openGeneratedDeck(id, lang) {
  justGenerated = id;
  nav(
    `/app/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}&aiReview=1`,
  );
}

/**
 * Whether this tab just generated `id`: true once, for the deck handed over
 * by {@link openGeneratedDeck}, and false after that or for any other deck.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function takeGeneratedDeck(id) {
  const hit = !!id && justGenerated === id;
  justGenerated = null;
  return hit;
}

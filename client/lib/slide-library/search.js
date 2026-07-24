/**
 * Search, filter, and sort utilities for the slide library.
 */

import { lower } from '../../../shared/string-utils.js';
import { normalizeLang } from '../../../shared/i18n-utils.js';

/**
 * Sort items by pinned/favorite status, then by name.
 * @param {Array} items
 * @returns {Array}
 */
export function sortByPinnedThenName(items) {
  return [...items].sort((a, b) => {
    const ap = !!(a?.favorite || a?.isFavorite);
    const bp = !!(b?.favorite || b?.isFavorite);
    if (ap !== bp) return ap ? -1 : 1;
    const an = lower(a?.name);
    const bn = lower(b?.name);
    return an.localeCompare(bn);
  });
}

/**
 * Sort items by trashed date (newest first), then by name.
 * @param {Array} items
 * @returns {Array}
 */
export function sortByTrashedThenName(items) {
  return [...items].sort((a, b) => {
    const at = String(a?.trashedAt || '');
    const bt = String(b?.trashedAt || '');
    if (at && bt && at !== bt) return bt.localeCompare(at); // newest first
    if (at !== bt) return at ? -1 : 1;
    const an = lower(a?.name);
    const bn = lower(b?.name);
    return an.localeCompare(bn);
  });
}

/**
 * Recursively extract all text from slide content object.
 * @param {*} obj
 * @param {string[]} [texts]
 * @returns {string[]}
 */
export function extractAllText(obj, texts = []) {
  if (!obj) return texts;
  if (typeof obj === 'string') {
    texts.push(obj);
    return texts;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractAllText(item, texts);
    }
    return texts;
  }
  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      extractAllText(value, texts);
    }
  }
  return texts;
}

/**
 * Get all searchable text from a slide item.
 * @param {Object} item
 * @returns {string}
 */
export function getSearchableText(item) {
  const texts = [];
  // Name/title
  if (item?.name) texts.push(item.name);
  // Description
  if (item?.description) texts.push(item.description);
  // Slide type
  if (item?.slideType) texts.push(item.slideType);
  // Tags
  if (Array.isArray(item?.tags)) {
    for (const tag of item.tags) {
      if (tag?.name) texts.push(tag.name);
    }
  }
  // All content text
  if (item?.content) {
    extractAllText(item.content, texts);
  }
  return texts.join(' ');
}

/**
 * Filter and sort items by search query.
 * - Searches name, type, and all content text
 * - Title/name matches are sorted first
 * @param {Array} items
 * @param {string} q - Search query
 * @param {Object} [options]
 * @param {Function} [options.labelForType] - Function to get label for slide type
 * @param {string} [options.typeFilter] - Filter by slide type
 * @returns {Array}
 */
export function filterItems(items, q, { labelForType, typeFilter } = {}) {
  // First filter by type if specified
  let filtered = items;
  if (typeFilter) {
    filtered = items.filter((it) => it?.slideType === typeFilter);
  }

  const query = lower(q);
  if (!query) return filtered;

  // Filter items that match the query
  const matches = [];
  for (const it of filtered) {
    const name = lower(it?.name || '');
    const desc = lower(it?.description || '');
    const type = lower(it?.slideType || '');
    const typeL = lower(labelForType?.(it?.slideType) || '');
    const allText = lower(getSearchableText(it));

    const nameMatch = name.includes(query);
    const descMatch = desc.includes(query);
    const typeMatch = type.includes(query) || typeL.includes(query);
    const contentMatch = allText.includes(query);

    if (nameMatch || descMatch || typeMatch || contentMatch) {
      matches.push({ item: it, nameMatch });
    }
  }

  // Sort: name matches first, then content matches
  matches.sort((a, b) => {
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    return 0;
  });

  return matches.map((m) => m.item);
}

/**
 * Get content for a specific language from a slide library item.
 * Falls back to the default content if the language version doesn't exist.
 * @param {Object} item
 * @param {string} lang
 * @returns {Object}
 */
export function getContentForLang(item, lang) {
  const l = normalizeLang(lang);
  if (l && item?.i18n?.versions?.[l]?.content) {
    return item.i18n.versions[l].content;
  }
  // Fallback to default content
  return item?.content || {};
}

/**
 * Check if an item has content for a specific language.
 * @param {Object} item
 * @param {string} lang
 * @returns {boolean}
 */
export function hasContentForLang(item, lang) {
  const l = normalizeLang(lang);
  if (!l) return false;
  // If item has i18n versions, check if the requested lang exists
  if (item?.i18n?.versions?.[l]?.content) return true;
  // If no i18n, assume it's in the dominant/default language (nl)
  return l === 'nl' || l === (item?.i18n?.dominant || 'nl');
}
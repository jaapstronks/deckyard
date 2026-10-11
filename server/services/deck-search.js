/**
 * Deck search — how a deck in a list matches a search query: on its metadata
 * always, on its slide text when the caller asks for a deep search. Pure
 * functions over a deck; `listPresentationsForActor`
 * (server/services/presentations.js, B607) decides which decks are searched.
 *
 * @module server/services/deck-search
 */

import { slideProse } from '../../shared/slide-types/text-fields.js';

/**
 * Normalize string for search (lowercase, remove accents)
 */
export function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * The searchable text of one slide: its prose, alt text included, read
 * against the type's declaration (`slideProse`).
 *
 * @param {Object} slide - a stored slide
 * @returns {string}
 */
export function extractSlideText(slide) {
  return slideProse(slide).join(' ');
}

/**
 * Which metadata fields of a listed deck match the query. The owner is
 * matched by `ownerEmail`: the list projection carries no owner display name
 * (that arrives with identity decoupling, docs/plans/briefs/identity-decoupling.md).
 *
 * @param {object} pres - a deck as `listPresentations` projects it
 * @param {string} normalizedQuery - already passed through `normalizeForSearch`
 * @returns {string[]} match locations (`title`, `description`, `owner`)
 */
export function metadataMatchLocations(pres, normalizedQuery) {
  const locations = [];
  if (normalizeForSearch(pres.title).includes(normalizedQuery)) {
    locations.push('title');
  }
  if (normalizeForSearch(pres.description).includes(normalizedQuery)) {
    locations.push('description');
  }
  if (normalizeForSearch(pres.ownerEmail).includes(normalizedQuery)) {
    locations.push('owner');
  }
  return locations;
}

/**
 * Where a full deck's slide text first matches the query: `slide N` for the
 * first slide whose text, in any of its language versions, contains it. A
 * version's slide is the one with the same `id`, else the one at the same
 * position.
 *
 * @param {Object} pres - a full deck (slides and i18n), as storage loads it
 * @param {string} normalizedQuery - already passed through `normalizeForSearch`
 * @returns {string|null} the match location, or `null` when no slide matches
 */
export function slideMatchLocation(pres, normalizedQuery) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const versions = Object.values(pres?.i18n?.versions ?? {})
    .map((version) => version?.slides)
    .filter((vSlides) => Array.isArray(vSlides) && vSlides !== slides);
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const copies = versions.map(
      (vSlides) =>
        (slide?.id && vSlides.find((s) => s?.id === slide.id)) || vSlides[i],
    );
    const text = normalizeForSearch(
      [slide, ...copies].map((s) => (s ? extractSlideText(s) : '')).join(' '),
    );
    if (text.includes(normalizedQuery)) return `slide ${i + 1}`;
  }
  return null;
}

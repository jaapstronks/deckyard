/**
 * Deck search — how a deck in a list matches a search query: on its metadata
 * always, on its slide text when the caller asks for a deep search. Pure
 * functions over a deck; `listPresentationsForActor`
 * (server/services/presentations.js, B607) decides which decks are searched.
 *
 * @module server/services/deck-search
 */

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
 * Extract searchable text from slide content
 */
export function extractSlideText(slide) {
  if (!slide?.content) return '';

  const texts = [];

  // Extract common text fields from slide content
  const content = slide.content;

  // Title and subheading
  if (content.title) texts.push(content.title);
  if (content.subheading) texts.push(content.subheading);

  // Body text (various formats)
  if (content.body) texts.push(content.body);
  if (content.text) texts.push(content.text);
  if (content.description) texts.push(content.description);

  // Quote and attribution
  if (Array.isArray(content.quotes)) {
    for (const q of content.quotes) {
      if (q?.quote) texts.push(q.quote);
      if (q?.authorName) texts.push(q.authorName);
    }
  }
  if (content.attribution) texts.push(content.attribution);

  // List items
  if (Array.isArray(content.items)) {
    for (const item of content.items) {
      if (typeof item === 'string') {
        texts.push(item);
      } else if (item?.text) {
        texts.push(item.text);
      } else if (item?.title) {
        texts.push(item.title);
      } else if (item?.label) {
        texts.push(item.label);
      }
      if (item?.description) texts.push(item.description);
    }
  }

  // Cards (icon cards, team cards, etc.)
  if (Array.isArray(content.cards)) {
    for (const card of content.cards) {
      if (card?.title) texts.push(card.title);
      if (card?.text) texts.push(card.text);
      if (card?.name) texts.push(card.name);
      if (card?.role) texts.push(card.role);
    }
  }

  // Table content
  if (Array.isArray(content.rows)) {
    for (const row of content.rows) {
      if (Array.isArray(row)) {
        texts.push(...row.filter((cell) => typeof cell === 'string'));
      }
    }
  }
  if (Array.isArray(content.headers)) {
    texts.push(...content.headers.filter((h) => typeof h === 'string'));
  }

  // Poll/feedback options
  if (Array.isArray(content.options)) {
    for (const opt of content.options) {
      if (typeof opt === 'string') {
        texts.push(opt);
      } else if (opt?.text) {
        texts.push(opt.text);
      }
    }
  }

  // Timeline items
  if (Array.isArray(content.events)) {
    for (const event of content.events) {
      if (event?.title) texts.push(event.title);
      if (event?.description) texts.push(event.description);
      if (event?.date) texts.push(event.date);
    }
  }

  // Steps/process items
  if (Array.isArray(content.steps)) {
    for (const step of content.steps) {
      if (step?.title) texts.push(step.title);
      if (step?.text) texts.push(step.text);
    }
  }

  // Columns content
  if (Array.isArray(content.columns)) {
    for (const col of content.columns) {
      if (col?.title) texts.push(col.title);
      if (col?.text) texts.push(col.text);
    }
  }

  // Matrix/quadrant content
  if (Array.isArray(content.quadrants)) {
    for (const q of content.quadrants) {
      if (q?.title) texts.push(q.title);
      if (q?.content) texts.push(q.content);
    }
  }

  // Image alt text and captions
  if (content.altText) texts.push(content.altText);
  if (content.caption) texts.push(content.caption);

  return texts.join(' ');
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
 * first slide whose text, in any of its language versions, contains it.
 *
 * @param {Object} pres - a full deck (slides and i18n), as storage loads it
 * @param {string} normalizedQuery - already passed through `normalizeForSearch`
 * @returns {string|null} the match location, or `null` when no slide matches
 */
export function slideMatchLocation(pres, normalizedQuery) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  for (let i = 0; i < slides.length; i++) {
    const slideI18n = pres.i18n?.slides?.[i];
    const text = normalizeForSearch(
      extractSlideText(slides[i]) +
        ' ' +
        (slideI18n ? extractSlideText({ content: slideI18n }) : ''),
    );
    if (text.includes(normalizedQuery)) return `slide ${i + 1}`;
  }
  return null;
}

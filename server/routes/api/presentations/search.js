/**
 * Full-text search endpoint for presentations.
 * Searches across presentation metadata and slide content.
 */

import { listPresentations, getPresentation } from '../../../storage/presentations.js';
import { serveJson, badRequest } from '../../../utils/http.js';
import { belongsInCollection } from './list.js';

/**
 * Normalize string for search (lowercase, remove accents)
 */
function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extract searchable text from slide content
 */
function extractSlideText(slide) {
  if (!slide?.content) return '';

  const texts = [];

  // Extract common text fields from slide content
  const content = slide.content;

  // Title and subtitle
  if (content.title) texts.push(content.title);
  if (content.subtitle) texts.push(content.subtitle);

  // Body text (various formats)
  if (content.body) texts.push(content.body);
  if (content.text) texts.push(content.text);
  if (content.description) texts.push(content.description);

  // Quote and attribution
  if (content.quote) texts.push(content.quote);
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
        texts.push(...row.filter(cell => typeof cell === 'string'));
      }
    }
  }
  if (Array.isArray(content.headers)) {
    texts.push(...content.headers.filter(h => typeof h === 'string'));
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
 * Search presentations with full-text matching
 */
export async function handlePresentationsSearch({ repoRoot, req, res, url, authedUser } = {}) {
  const query = url.searchParams.get('q')?.trim();
  const deep = url.searchParams.get('deep') === 'true'; // Search slide content too

  if (!query) {
    return badRequest(res, 'Search query (q) is required');
  }

  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery.length < 2) {
    return badRequest(res, 'Search query must be at least 2 characters');
  }

  const list = await listPresentations(repoRoot);

  // Filter to user's collection
  const accessiblePresentations = authedUser
    ? list.filter((p) => belongsInCollection({ user: authedUser, pres: p }))
    : list;

  const results = [];

  for (const pres of accessiblePresentations) {
    let matches = false;
    const matchLocations = [];

    // Search in metadata (always)
    if (normalizeForSearch(pres.title)?.includes(normalizedQuery)) {
      matches = true;
      matchLocations.push('title');
    }
    if (normalizeForSearch(pres.description)?.includes(normalizedQuery)) {
      matches = true;
      matchLocations.push('description');
    }
    if (normalizeForSearch(pres.ownerEmail)?.includes(normalizedQuery)) {
      matches = true;
      matchLocations.push('owner');
    }
    if (normalizeForSearch(pres.ownerName)?.includes(normalizedQuery)) {
      matches = true;
      matchLocations.push('owner');
    }

    // Deep search: search in slide content
    if (deep && !matches) {
      try {
        const fullPres = await getPresentation(repoRoot, pres.id);
        if (fullPres?.slides) {
          for (let i = 0; i < fullPres.slides.length; i++) {
            const slide = fullPres.slides[i];
            const slideText = extractSlideText(slide);

            // Also check i18n versions
            const slideI18n = fullPres.i18n?.slides?.[i];
            const slideTextI18n = slideI18n ? extractSlideText({ content: slideI18n }) : '';

            const combinedText = normalizeForSearch(slideText + ' ' + slideTextI18n);
            if (combinedText.includes(normalizedQuery)) {
              matches = true;
              matchLocations.push(`slide ${i + 1}`);
              break; // Found a match, no need to check more slides
            }
          }
        }
      } catch {
        // Skip if we can't load the full presentation
      }
    }

    if (matches) {
      results.push({
        ...pres,
        _matchLocations: matchLocations,
      });
    }
  }

  // Sort by relevance (title matches first, then by date)
  results.sort((a, b) => {
    const aInTitle = a._matchLocations?.includes('title');
    const bInTitle = b._matchLocations?.includes('title');
    if (aInTitle && !bInTitle) return -1;
    if (!aInTitle && bInTitle) return 1;

    // Then by date
    const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bDate - aDate;
  });

  serveJson(res, 200, {
    query,
    deep,
    count: results.length,
    results,
  });
  return true;
}
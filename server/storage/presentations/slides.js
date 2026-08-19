import crypto from 'node:crypto';

import {
  resolveSlideTypeName,
  getSlideTypeId,
} from '../../../shared/slide-types/registry.js';
import { normalizeDataSource } from '../../../shared/data-source.js';
import { ValidationError } from '../../utils/errors.js';

// An example canonical id for the error message, read from the registry so it
// can never drift from the spelling the format actually publishes.
const EXAMPLE_CANONICAL_ID =
  getSlideTypeId('title-slide') || 'eu.deckyard.slide.title';

/**
 * The one write-seam every stored slide passes through: it validates the slide
 * type and normalizes it to the registry key.
 *
 * `slides[].type` has a single canonical spelling in the format — the
 * reverse-DNS id (`eu.deckyard.slide.title`). The legacy spellings (the bare
 * registry key, the `core/…` qualified form) are accepted here as beta-window
 * input normalization, not as format features: each is resolved to the registry
 * key before storage, so nothing non-canonical is ever persisted
 * (docs/reference/versioning.md § The beta stance). A type no registry key
 * answers to is a 400 — which is what finally closes the whole-deck PUT that,
 * in Postgres mode, let arbitrary strings reach storage unvalidated.
 *
 * @param {Array<object>} slides
 * @returns {Array<object>}
 * @throws {ValidationError} 400 when a slide names an unresolvable type.
 */
export function normalizeSlides(slides) {
  if (!Array.isArray(slides)) return [];
  return slides.map((s, index) => {
    const type = resolveSlideTypeName(s?.type);
    if (!type) {
      throw new ValidationError(
        `Unknown slide type ${JSON.stringify(s?.type ?? null)} at slide ${index}: ` +
          `use a canonical type id such as ${EXAMPLE_CANONICAL_ID}`,
        { slideIndex: index, type: s?.type ?? null },
      );
    }
    const normalized = {
      ...s,
      type,
      id: typeof s?.id === 'string' && s.id ? s.id : crypto.randomUUID(),
      content:
        type === 'poll-slide'
          ? {
              ...(s?.content && typeof s.content === 'object' ? s.content : {}),
              pollId:
                typeof s?.content?.pollId === 'string' &&
                s.content.pollId.trim()
                  ? s.content.pollId.trim()
                  : crypto.randomUUID(),
            }
          : s?.content,
    };
    // Preserve parentId for nested slides (null = top-level)
    normalized.parentId =
      typeof s?.parentId === 'string' && s.parentId.trim()
        ? s.parentId.trim()
        : null;
    // Preserve author lock flag if present
    if (typeof s?.lockedByAuthor === 'boolean') {
      normalized.lockedByAuthor = s.lockedByAuthor;
    }
    // Preserve per-slide duration override if valid (1-300 seconds)
    if (
      typeof s?.duration === 'number' &&
      s.duration >= 1 &&
      s.duration <= 300
    ) {
      normalized.duration = Math.round(s.duration);
    }
    // Preserve data source binding config if present, folding legacy refresh
    // modes ('on-view' → 'manual') so nothing non-canonical is persisted.
    if (
      s?.dataSource &&
      typeof s.dataSource === 'object' &&
      s.dataSource.provider
    ) {
      normalized.dataSource = normalizeDataSource(s.dataSource);
    }
    return normalized;
  });
}

import crypto from 'node:crypto';

import {
  SLIDE_TYPES,
  resolveSlideTypeName,
  getSlideTypeId,
  getSlideType,
} from '../../../shared/slide-types/registry.js';
import {
  applyInstanceKeyDefaults,
  slideInstanceKeys,
} from '../../../shared/slide-types/instance-keys.js';
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
 * It is also where a slide's **instance keys** are filled in: the content keys
 * a type declares as bound to one slide instance rather than to its text
 * (`instanceKeys` in shared/slide-types/instance-keys.js — `poll-slide.pollId`,
 * `follow-invite-slide.presentationId`). The declaration says which keys and
 * where their value comes from, so this seam does not name a type to know that
 * a poll needs an id.
 *
 * ## Which registry it validates against (B129)
 *
 * "Registered" is an organization-scoped question, not a process-wide one: an
 * org's DB-backed custom slide types (Settings → Slide Types) are as registered
 * as a core one, and are stored under `custom-<slug>`. They live in a table, so
 * they are not and cannot be in the in-process `SLIDE_TYPES` map — which is why
 * this seam takes its registry as an argument instead of reaching for the
 * module-level one. The caller that knows the organization (the presentations
 * facade) builds it with `buildMergedSlideTypes`, the same builder every
 * server-side read path already uses. Without it, the editor happily inserted a
 * published custom type and every subsequent autosave answered 400.
 *
 * There is no second, more tolerant route for `custom-*` ids: one registry, one
 * resolver, one 400 for a type nothing answers to.
 *
 * @param {Array<object>} slides
 * @param {object} [opts]
 * @param {string} [opts.presentationId] - the deck being written. Needed for
 *   `presentation-id` keys, which cache it; omit it and those keys are left
 *   alone rather than blanked.
 * @param {Record<string, object>} [opts.slideTypes] - the registry to validate
 *   against. Defaults to the process-wide `SLIDE_TYPES`, which is right for a
 *   caller that has no organization; every organization-scoped write hands in
 *   that org's registry (`buildMergedSlideTypes`) so its DB-backed custom types
 *   resolve here too. See the note above.
 * @returns {Array<object>}
 * @throws {ValidationError} 400 when a slide names an unresolvable type.
 */
export function normalizeSlides(
  slides,
  { presentationId = '', slideTypes = SLIDE_TYPES } = {},
) {
  if (!Array.isArray(slides)) return [];
  return slides.map((s, index) => {
    const type = resolveSlideTypeName(s?.type, slideTypes);
    if (!type) {
      // No `details`: `bad_request` carries no payload (D78), and both facts
      // are already in the sentence. A `slideIndex` here would be a second
      // spelling of the location shape's `index`, which is the drift the
      // register exists to stop (server/utils/error-details.js).
      throw new ValidationError(
        `Unknown slide type ${JSON.stringify(s?.type ?? null)} at slide ${index}: ` +
          `use a canonical type id such as ${EXAMPLE_CANONICAL_ID}`,
      );
    }
    const normalized = {
      ...s,
      type,
      id: typeof s?.id === 'string' && s.id ? s.id : crypto.randomUUID(),
      content: s?.content,
    };
    // Instance keys, from the type's declaration. Copied first so the write
    // lands on this slide's own content object rather than the caller's.
    const def = getSlideType(type, slideTypes);
    if (Object.keys(slideInstanceKeys(def)).length) {
      normalized.content = {
        ...(s?.content && typeof s.content === 'object' ? s.content : {}),
      };
      applyInstanceKeyDefaults(normalized, {
        def,
        presentationId,
        newId: () => crypto.randomUUID(),
      });
    }
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

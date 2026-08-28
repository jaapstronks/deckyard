/**
 * The deck-card fields that no storage layer produces.
 *
 * Five endpoints hand the deck grid a list of presentations — the collection
 * (`/api/presentations`), shared-with-me, popular (also folded into
 * `/api/home`), the trash, and the 201 a duplicate answers with. They read from
 * different queries and shape their rows differently, but the card that renders
 * them (client/views/list/presentation-card.js) is one component with one set of
 * expectations, so anything it needs that the database does not store belongs in
 * one mapper rather than in whichever producer happened to think of it. Only the
 * collection route ever did, which is why every other surface showed a colorless
 * placeholder while its raster loaded.
 *
 * Today that is exactly one field, `thumbBg`; the seam is here so the next one
 * lands in one place instead of four.
 */

import { resolveThemeThumbBg } from './themes.js';

/**
 * Attach the deck-card fields to a list of presentation-shaped objects.
 *
 * Resolves each *distinct* theme once (theme loads are memoized, but the
 * dedupe keeps a 50-deck list from doing 50 lookups of the same theme).
 *
 * @template {{ theme?: string }} T
 * @param {string} repoRoot
 * @param {T[]} items - Presentations, in whatever shape their producer builds.
 * @param {Object|null} [ctx] - Storage context for theme resolution (org-scoped themes).
 * @returns {Promise<(T & { thumbBg: string|null })[]>}
 */
export async function withDeckCardFields(repoRoot, items, ctx = null) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  // Placeholder background shown until the rasterized thumbnail loads: a flat
  // field in the deck's own theme color, so a pending card already reads as
  // that deck rather than as a grey hole.
  const thumbBgByTheme = new Map();
  await Promise.all(
    [...new Set(list.map((p) => p?.theme).filter(Boolean))].map(
      async (themeId) => {
        thumbBgByTheme.set(
          themeId,
          await resolveThemeThumbBg(repoRoot, themeId, ctx),
        );
      },
    ),
  );

  return list.map((p) => ({
    ...p,
    thumbBg: thumbBgByTheme.get(p?.theme) || null,
  }));
}

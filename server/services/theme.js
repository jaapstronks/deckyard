/**
 * Theme change — the one way a deck changes theme, decided and done in one
 * place (A7.4, B575).
 *
 * The shared write path hard-locks `theme` (see `updatePresentation`), so a
 * stray save can never flip a deck's branding. A deliberate switch goes
 * through here: the editor's `/change-theme` route and the public API's PUT
 * (B446) both call it, so a theme change means the same thing on every
 * contract — the actor may write the deck, the theme must exist, slides the
 * caller asked to convert are re-seeded against the theme the deck moves
 * *to*, and the write opts in with `allowThemeChange`.
 *
 * This lived in `storage/presentations/change-theme.js` while both contracts
 * loaded and decided the deck themselves; now the service loads it with
 * `access: 'write'` and the routes parse and answer.
 *
 * @module server/services/theme
 */

import { updatePresentation } from '../storage/presentations/index.js';
import { findTheme } from '../utils/themes.js';
import { convertSlideToType } from '../../shared/slide-types/convert.js';
import { SLIDE_TYPES } from '../../shared/slide-types/registry.js';
import {
  AppError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { loadPresentationForActor } from './presentations.js';

const log = createLogger('change-theme');

/**
 * Switch a deck to another theme, writing `changes` along with it.
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The caller's storage scope.
 * @param {{ actor: import('./actor.js').Actor }} identity - The acting user (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} input.theme - The theme to switch to, in its one spelling.
 * @param {Object} [input.changes] - What to write with the switch (a v1 PUT
 *   body). Absent, the stored deck is written back with the new theme (the
 *   editor route). Slides are only converted and written when the written
 *   data carries a `slides` array.
 * @param {Array<{slideId: string, convertTo: string}>} [input.convertSlides]
 * @returns {Promise<Object>} The deck as stored after the switch.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid`, `details.field` = `theme`: no such theme.
 */
export async function changeTheme(
  scope,
  identity,
  { presentationId, theme, changes, convertSlides },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });

  const repoRoot = scope?.repoRoot ?? null;
  const newTheme =
    typeof theme === 'string' && theme
      ? await findTheme(repoRoot, theme, scope)
      : null;
  if (!newTheme) {
    throw new AppError(
      `Theme not found: ${theme}`,
      400,
      { field: 'theme' },
      'invalid',
    );
  }

  const conversionMap = new Map();
  if (Array.isArray(convertSlides)) {
    for (const conv of convertSlides) {
      if (conv?.slideId && conv?.convertTo) {
        conversionMap.set(conv.slideId, conv.convertTo);
      }
    }
  }

  // Stored as named: findTheme admits only the canonical spelling, and
  // `default` must stay `default` so the deck keeps following the
  // installation's default instead of freezing to today's id (D232).
  const data = changes ?? pres;
  const updateData = { ...data, theme };
  if (Array.isArray(data?.slides)) {
    updateData.slides = data.slides.map((slide) => {
      const targetType = conversionMap.get(slide?.id);
      if (!targetType) return slide;
      try {
        // The converted slide is re-seeded for its new type, and that seed
        // reads the theme (ground, background presets): the theme the deck
        // is moving to, not the one it leaves.
        return convertSlideToType(slide, targetType, {
          slideTypes: SLIDE_TYPES,
          lang: data.lang || null,
          theme: newTheme,
        });
      } catch (err) {
        log.warn(`Failed to convert slide ${slide.id}:`, err.message);
        return slide; // Keep original if conversion fails
      }
    });
  }

  const updated = await updatePresentation(scope, pres.id, updateData, {
    actorEmail: identity.actor?.email || null,
    allowThemeChange: true,
  });
  if (!updated) throw new NotFoundError('Presentation not found');
  if (updated.ok === false) throwStorageFailure(updated);
  return updated;
}

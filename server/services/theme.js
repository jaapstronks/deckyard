/**
 * Theme change — the one way a deck changes theme, decided and done in one
 * place (A7.4, B575).
 *
 * The shared write path hard-locks `theme` (see `updatePresentation`), so a
 * stray save can never flip a deck's branding. A deliberate switch goes
 * through here: the editor's `/change-theme` route and the public API's PUT
 * (B446, through the save service since B608) both call it, so a theme
 * change means the same thing on every contract — the actor may write the deck, the theme must exist, slides the
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
import { dominantSlidesBody, mapVersionSlides } from './deck-versions.js';
import { loadPresentationForActor } from './presentations.js';

/**
 * The caller chose this conversion in the compatibility dialog; a switch that
 * quietly kept the slide unconverted would answer a choice it did not honour
 * (B612, the B572 rule), in any language version (B623). Every conversion
 * runs before the one write, so a refusal leaves the deck as it was.
 */
function refuseFailedConversion(slide, { convertTo, index }, err) {
  throw new AppError(
    `Cannot convert slide ${slide.id} to ${convertTo}: ${err.message}`,
    400,
    { field: 'convertSlides', index },
    'invalid',
  );
}

/**
 * Switch a deck to another theme, writing `changes` along with it.
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The caller's storage scope.
 * @param {{ actor: import('./actor.js').Actor }} identity - The acting user (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} input.theme - The theme to switch to, in its one spelling.
 * @param {Array<{slideId: string, convertTo: string}>} [input.convertSlides]
 * @returns {Promise<Object>} The deck as stored after the switch.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid`, `details.field` = `theme`: no such theme;
 *   `details.field` = `convertSlides`: a requested slide conversion failed.
 */
export async function changeTheme(
  scope,
  identity,
  { presentationId, theme, convertSlides },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  return applyThemeChange(scope, identity, pres, { theme, convertSlides });
}

/**
 * Switch a deck the caller already loaded for writing to another theme. The
 * save service (B608) loads the deck once for its own refusals and switches
 * through here, so a v1 PUT that changes the theme no longer loads it twice
 * (D316 (3)).
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The caller's storage scope.
 * @param {{ actor: import('./actor.js').Actor }} identity - The acting user (D253).
 * @param {Object} pres - The deck, loaded with `access: 'write'`.
 * @param {Object} input
 * @param {*} input.theme - The theme to switch to, in its one spelling.
 * @param {Object} [input.changes] - What to write with the switch (a save's
 *   body). Absent, the stored deck's slides are written back as its dominant
 *   version with the new theme (the editor route), the other language
 *   versions as stored. Slides are only converted and written when the
 *   written data carries a `slides` array; a conversion applies to that
 *   slide id in every language version the written data carries.
 * @param {Array<{slideId: string, convertTo: string}>} [input.convertSlides]
 * @returns {Promise<Object>} The deck as stored after the switch.
 * @throws {AppError} 400 `invalid`, `details.field` = `theme`: no such theme;
 *   `details.field` = `convertSlides` (with `index` into it): a requested
 *   slide conversion failed, and nothing was written.
 */
export async function applyThemeChange(
  scope,
  identity,
  pres,
  { theme, changes, convertSlides },
) {
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
    convertSlides.forEach((conv, index) => {
      if (conv?.slideId && conv?.convertTo) {
        conversionMap.set(conv.slideId, { convertTo: conv.convertTo, index });
      }
    });
  }

  // Stored as named: findTheme admits only the canonical spelling, and
  // `default` must stay `default` so the deck keeps following the
  // installation's default instead of freezing to today's id (D232).
  const data = changes ?? pres;
  // A conversion is asked per slide id, and a slide id names the same slide
  // in every language version: each version converts it with its own text,
  // so no language keeps the old type (B623).
  const convert = (slides, lang) =>
    slides.map((slide) => {
      const conversion = conversionMap.get(slide?.id);
      if (!conversion) return slide;
      try {
        // The converted slide is re-seeded for its new type, and that seed
        // reads the theme (ground, background presets): the theme the deck
        // is moving to, not the one it leaves.
        return convertSlideToType(slide, conversion.convertTo, {
          slideTypes: SLIDE_TYPES,
          lang: lang || null,
          theme: newTheme,
        });
      } catch (err) {
        refuseFailedConversion(slide, conversion, err);
      }
    });
  const slides = Array.isArray(data?.slides)
    ? convert(data.slides, data.lang)
    : data?.slides;
  const i18n = conversionMap.size
    ? mapVersionSlides(data?.i18n, convert)
    : data?.i18n;

  // A save's body carries the edited version at the top level, as the seam
  // reads it. The stored deck carries the dominant one there, so it is
  // written back as a new dominant buffer and every other language version
  // stays as stored (B620), converted like the dominant one.
  const updateData = changes
    ? {
        ...changes,
        theme,
        ...(Array.isArray(slides) ? { slides } : {}),
        ...(changes.i18n ? { i18n } : {}),
      }
    : Array.isArray(slides)
      ? { ...dominantSlidesBody({ ...pres, i18n }, slides), theme }
      : { theme };

  const updated = await updatePresentation(scope, pres.id, updateData, {
    actorEmail: identity.actor?.email || null,
    allowThemeChange: true,
  });
  if (!updated) throw new NotFoundError('Presentation not found');
  if (updated.ok === false) throwStorageFailure(updated);
  return updated;
}

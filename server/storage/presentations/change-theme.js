/**
 * The one way a deck changes theme.
 *
 * The shared write path hard-locks `theme` (see `updatePresentation`), so a
 * stray save can never flip a deck's branding. A deliberate switch goes
 * through here: the editor's /change-theme route and the public API's PUT
 * (B446) both call it, so a theme change means the same thing on every
 * surface — the theme must exist, slides the caller asked to convert are
 * re-seeded against the theme the deck moves *to*, and the write opts in with
 * `allowThemeChange`.
 */

import { updatePresentation } from './index.js';
import { findTheme, resolveThemeId } from '../../utils/themes.js';
import { convertSlideToType } from '../../../shared/slide-types/convert.js';
import { SLIDE_TYPES } from '../../../shared/slide-types/registry.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('change-theme');

/**
 * Switch a deck to another theme, writing `data` along with it.
 *
 * @param {Object} storageScope - storage scope of the acting request
 * @param {string} id - presentation id
 * @param {Object} data - what to write with the switch: the whole deck (the
 *   editor route) or a partial body (a PUT). Slides are only converted and
 *   written when `data.slides` is an array; a body without slides leaves the
 *   stored slides alone.
 * @param {Object} opts
 * @param {string} opts.theme - the theme to switch to
 * @param {Array<{slideId: string, convertTo: string}>} [opts.convertSlides]
 * @param {string|null} [opts.actorEmail]
 * @returns {Promise<{ok: true, presentation: Object|null} | {ok: false,
 *   error: string}>} `presentation` is null when the deck does not exist
 */
export async function changePresentationTheme(
  storageScope,
  id,
  data,
  { theme, convertSlides, actorEmail = null } = {},
) {
  const repoRoot = storageScope?.repoRoot ?? null;
  const newTheme = await findTheme(repoRoot, theme, storageScope);
  if (!newTheme) return { ok: false, error: `Theme not found: ${theme}` };

  const conversionMap = new Map();
  if (Array.isArray(convertSlides)) {
    for (const conv of convertSlides) {
      if (conv?.slideId && conv?.convertTo) {
        conversionMap.set(conv.slideId, conv.convertTo);
      }
    }
  }

  const updateData = { ...data, theme: resolveThemeId(theme) };
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

  const presentation = await updatePresentation(storageScope, id, updateData, {
    actorEmail,
    allowThemeChange: true,
  });
  return { ok: true, presentation };
}

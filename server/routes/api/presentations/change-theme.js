/**
 * Route handlers for changing presentation theme.
 * Analyzes theme compatibility and applies theme changes.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import { changePresentationTheme } from '../../../storage/presentations/change-theme.js';
import {
  serveJson,
  methodNotAllowed,
  notFound,
  badRequest,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz/index.js';
import { getString } from '../../../utils/request-validators.js';
import { findTheme, resolveThemeId } from '../../../utils/themes.js';
import { getConvertibleSlideTypes } from '../../../../shared/slide-types/convert.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';
import { getThemeSlideTypeConfig } from '../../../../shared/slide-types/policy.js';
import { cleanStr } from '../../../../shared/string-utils.js';

/**
 * Check if a slide type is compatible with a theme.
 * @param {string} slideType - The slide type
 * @param {Object} newTheme - The target theme
 * @returns {{ compatible: boolean, reason?: string }}
 */
function checkSlideTypeCompatibility(slideType, newTheme) {
  const typeDef = SLIDE_TYPES[slideType];
  if (!typeDef) {
    return { compatible: true }; // Unknown types are kept as-is
  }

  const { exclude, include } = getThemeSlideTypeConfig(newTheme);
  const newThemeId = cleanStr(newTheme?.id);

  // Check if slide type has a theme-specific binding
  const slideThemeId = cleanStr(typeDef?.themeId);
  if (slideThemeId && slideThemeId !== newThemeId) {
    return { compatible: false, reason: 'theme_specific' };
  }

  // Check if slide type is in the exclude set
  if (exclude.has(slideType)) {
    return { compatible: false, reason: 'will_be_hidden' };
  }

  // Check if theme-specific slide types need to be in include set
  if (slideThemeId && !include.has(slideType)) {
    return { compatible: false, reason: 'theme_specific' };
  }

  return { compatible: true };
}

/**
 * Analyze theme change compatibility.
 * POST /api/presentations/:id/analyze-theme-change
 *
 * Request body:
 * { newThemeId: string }
 *
 * Response:
 * {
 *   compatible: boolean,
 *   currentTheme: string,
 *   newTheme: string,
 *   problematicSlides: [{
 *     id: string,
 *     index: number,
 *     type: string,
 *     reason: 'theme_specific' | 'will_be_hidden',
 *     title: string,
 *     convertibleTo: string[]
 *   }]
 * }
 */
export async function handleAnalyzeThemeChange(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can analyze theme changes
  if (!canWritePresentation({ user: authedUser, pres })) {
    return forbidden(res);
  }

  // Parse request body
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;

  const newThemeId = getString(parsed.body, 'newThemeId');
  if (!newThemeId) {
    return badRequest(res, 'newThemeId is required');
  }

  // Load the new theme
  const newTheme = await findTheme(repoRoot, newThemeId, storageScope);
  if (!newTheme) {
    return badRequest(res, 'Theme not found');
  }

  const currentThemeId = resolveThemeId(pres.theme);
  const slides = Array.isArray(pres.slides) ? pres.slides : [];

  const problematicSlides = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideType = String(slide?.type || '').trim();
    if (!slideType) continue;

    const { compatible, reason } = checkSlideTypeCompatibility(
      slideType,
      newTheme,
    );

    if (!compatible) {
      // Get the slide title for display
      const content =
        slide?.content && typeof slide.content === 'object'
          ? slide.content
          : {};
      const title = String(
        content?.title || content?.a11yTitle || `Slide ${i + 1}`,
      )
        .trim()
        .slice(0, 100);

      // Get convertible options
      const convertibleTo = getConvertibleSlideTypes(slide, {
        slideTypes: SLIDE_TYPES,
      });

      problematicSlides.push({
        id: slide.id,
        index: i,
        type: slideType,
        reason,
        title,
        convertibleTo,
      });
    }
  }

  const result = {
    compatible: problematicSlides.length === 0,
    currentTheme: currentThemeId,
    newTheme: newThemeId,
    newThemeLabel: newTheme.label || newThemeId,
    problematicSlides,
  };

  return serveJson(res, 200, result);
}

/**
 * Apply theme change to a presentation.
 * POST /api/presentations/:id/change-theme
 *
 * Request body:
 * {
 *   newThemeId: string,
 *   convertSlides?: [{ slideId: string, convertTo: string }]
 * }
 *
 * Response:
 * { success: boolean, presentation: object }
 */
export async function handleChangeTheme(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can change theme
  if (!canWritePresentation({ user: authedUser, pres })) {
    return forbidden(res);
  }

  // Parse request body
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;

  const { convertSlides } = parsed.body || {};
  const newThemeId = getString(parsed.body, 'newThemeId');
  if (!newThemeId) {
    return badRequest(res, 'newThemeId is required');
  }

  const result = await changePresentationTheme(storageScope, id, pres, {
    theme: newThemeId,
    convertSlides,
    actorEmail: authedUser?.email,
  });
  if (!result.ok) return badRequest(res, result.error);
  if (!result.presentation) return notFound(res);

  return serveJson(res, 200, {
    success: true,
    presentation: result.presentation,
  });
}

/**
 * Route handlers for changing presentation theme.
 * Analyzes theme compatibility and applies theme changes.
 */

import {
  getPresentation,
  updatePresentation,
} from '../../../storage/presentations.js';
import {
  serveJson,
  methodNotAllowed,
  notFound,
  unauthorized,
  badRequest,
  parseJsonBody,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';
import { getConvertibleSlideTypes, convertSlideToType } from '../../../../shared/slide-types/convert.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';

/**
 * Get theme slide type configuration (server-side version).
 * Mirrors the client-side getThemeSlideTypeConfig from slide-types-policy.js
 * @param {Object} theme - Theme object
 * @returns {Object} { exclude: Set, include: Set }
 */
function getThemeSlideTypeConfig(theme) {
  const st = theme?.slideTypes && typeof theme.slideTypes === 'object' ? theme.slideTypes : {};
  const hidden = Array.isArray(theme?.hiddenSlideTypes) ? theme.hiddenSlideTypes : [];
  const excludeArr = Array.isArray(st.exclude) ? st.exclude : [];
  const includeArr = Array.isArray(st.include) ? st.include : [];

  return {
    exclude: new Set([...excludeArr, ...hidden]),
    include: new Set(includeArr),
  };
}

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
  const newThemeId = String(newTheme?.id || '').trim();

  // Check if slide type has a theme-specific binding
  const slideThemeId = String(typeDef?.themeId || '').trim();
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
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can analyze theme changes
  if (!canWritePresentation({ user: authedUser, pres })) {
    return unauthorized(res);
  }

  // Parse request body
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return badRequest(res, parsed.error || 'Invalid request body');
  }

  const { newThemeId } = parsed.body || {};
  if (!newThemeId || typeof newThemeId !== 'string') {
    return badRequest(res, 'newThemeId is required');
  }

  // Load the new theme
  const newTheme = await loadTheme(repoRoot, newThemeId);
  if (!newTheme) {
    return badRequest(res, 'Theme not found');
  }

  const currentThemeId = String(pres.themeId || 'deckyard').trim();
  const slides = Array.isArray(pres.slides) ? pres.slides : [];

  const problematicSlides = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideType = String(slide?.type || '').trim();
    if (!slideType) continue;

    const { compatible, reason } = checkSlideTypeCompatibility(slideType, newTheme);

    if (!compatible) {
      // Get the slide title for display
      const content = slide?.content && typeof slide.content === 'object' ? slide.content : {};
      const title = String(content?.title || content?.a11yTitle || `Slide ${i + 1}`).trim().slice(0, 100);

      // Get convertible options
      const convertibleTo = getConvertibleSlideTypes(slide, { slideTypes: SLIDE_TYPES });

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
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can change theme
  if (!canWritePresentation({ user: authedUser, pres })) {
    return unauthorized(res);
  }

  // Parse request body
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return badRequest(res, parsed.error || 'Invalid request body');
  }

  const { newThemeId, convertSlides } = parsed.body || {};
  if (!newThemeId || typeof newThemeId !== 'string') {
    return badRequest(res, 'newThemeId is required');
  }

  // Load the new theme to verify it exists
  const newTheme = await loadTheme(repoRoot, newThemeId);
  if (!newTheme) {
    return badRequest(res, 'Theme not found');
  }

  // Apply slide conversions if requested
  const slides = Array.isArray(pres.slides) ? [...pres.slides] : [];
  const conversionMap = new Map();

  if (Array.isArray(convertSlides)) {
    for (const conv of convertSlides) {
      if (conv?.slideId && conv?.convertTo) {
        conversionMap.set(conv.slideId, conv.convertTo);
      }
    }
  }

  // Convert slides that were specified
  const updatedSlides = slides.map((slide) => {
    const targetType = conversionMap.get(slide.id);
    if (targetType) {
      try {
        return convertSlideToType(slide, targetType, {
          slideTypes: SLIDE_TYPES,
          lang: pres.lang || null,
        });
      } catch (err) {
        console.warn(`[change-theme] Failed to convert slide ${slide.id}:`, err.message);
        return slide; // Keep original if conversion fails
      }
    }
    return slide;
  });

  // Update the presentation with new theme and converted slides.
  // `theme` is the canonical column; `themeId` is only a read-side projection,
  // so the real switch must go through `theme` gated by allowThemeChange (the
  // shared write path hard-locks the theme otherwise).
  const updateData = {
    ...pres,
    theme: resolveThemeId(newThemeId),
    themeId: newThemeId,
    slides: updatedSlides,
  };

  const result = await updatePresentation(repoRoot, id, updateData, {
    actorEmail: authedUser?.email,
    allowThemeChange: true,
  });

  if (!result || result.error) {
    return badRequest(res, result?.error || 'Failed to update presentation');
  }

  return serveJson(res, 200, {
    success: true,
    presentation: result,
  });
}

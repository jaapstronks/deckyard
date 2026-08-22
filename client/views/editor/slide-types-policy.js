import { cleanStr, uniqStrings } from '../../../shared/string-utils.js';

export function getThemeSlideTypeConfig(theme) {
  // Themes reaching here are normalized (client/lib/theme/theme.js runs every
  // load through normalizeTheme), so `slideTypes.exclude` is the whole story —
  // the legacy `hiddenSlideTypes` alias is folded away there.
  const st =
    theme?.slideTypes && typeof theme.slideTypes === 'object'
      ? theme.slideTypes
      : {};
  const exclude = uniqStrings(st.exclude);
  const include = uniqStrings(st.include);
  return {
    exclude: new Set(exclude),
    include: new Set(include),
  };
}

/**
 * Check if a slide type can be inserted (new slides).
 * Layers: org-level curation > theme-level visibility > type-level.
 * @param {Object} options
 * @param {string} options.type - Slide type key
 * @param {Object} options.def - Slide type definition
 * @param {Object} [options.theme] - Active theme
 * @param {Array} [options.disabledSlideTypes] - Org-level disabled types
 * @param {boolean} [options.canEditCustomHtml] - Whether the user may author raw HTML/CSS
 * @returns {boolean}
 */
export function isInsertableSlideType({
  type,
  def,
  theme,
  disabledSlideTypes,
  canEditCustomHtml = false,
} = {}) {
  const t = cleanStr(type);
  if (!t) return false;
  if (!def || typeof def !== 'object') return false;

  // Deprecated types are hidden from every insertion path — picker and AI —
  // but existing slides keep rendering, since rendering doesn't go through this
  // gate. Rung 1 of the deprecation ladder; no core type sits there right now
  // (docs/reference/slide-type-removal.md).
  if (def.deprecated) return false;

  // The raw-HTML escape-hatch slide is only insertable by capability holders.
  // Everyone else can still view/present/export existing ones (read-only).
  if (t === 'custom-html-slide' && !canEditCustomHtml) return false;

  // Org-level curation check (most restrictive, checked first)
  if (Array.isArray(disabledSlideTypes) && disabledSlideTypes.includes(t)) {
    return false;
  }

  const { exclude, include } = getThemeSlideTypeConfig(theme);
  if (exclude.has(t)) return false;

  // Theme-specific slide types are opt-in via theme.slideTypes.include.
  // (Universal slide types have no `themeId` and are available by default.)
  const themeId = cleanStr(def?.themeId);
  if (themeId) {
    const activeThemeId = cleanStr(theme?.id);
    if (themeId !== activeThemeId) return false;
    if (!include.has(t)) return false;
  }

  return true;
}

/**
 * Check if a slide type is disabled at the org level (for showing retired badges).
 * @param {string} type - Slide type key
 * @param {Array} [disabledSlideTypes] - Org-level disabled types
 * @returns {boolean}
 */
export function isOrgDisabledSlideType(type, disabledSlideTypes) {
  const t = cleanStr(type);
  return Boolean(
    t && Array.isArray(disabledSlideTypes) && disabledSlideTypes.includes(t),
  );
}

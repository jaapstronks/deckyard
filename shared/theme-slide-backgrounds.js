// Theme-defined slide background variants.
//
// A theme may ship named slide backgrounds beyond the built-in lime/mist pair:
//
//   // theme.json
//   "slideBackgrounds": [
//     { "id": "calm", "label": "Calm",
//       "value": "radial-gradient(...), #140a26",
//       "textColor": "#ffffff",
//       "textColorMuted": "rgba(255, 255, 255, 0.72)" }
//   ]
//
// Normalization (client `client/lib/theme.js` + server `server/utils/themes.js`)
// turns each entry into `--t-slide-bg-<id>[-text[-muted]]` cssVars, and the
// generated CSS rules below map the `slide-bg-<id>` class (emitted by
// `bgClass()` in shared/slide-types/helpers.js) onto those vars. The rules
// redirect `--color-text` / `--color-text-muted` the same way the
// background-image contrast classes do (see
// client/styles/slides/01-layout-and-title/00-base.css), so per-variant
// contrast reaches every component without per-slide-type CSS.
//
// The editor's background picker (client/views/editor/fields/background.js)
// appends these entries to the base lime/mist options; swatches resolve via
// the existing `--t-slide-bg-<id>` convention.

/** Valid variant ids: css-class-safe slugs. */
export const SLIDE_BG_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Ids a theme may NOT claim as variants: the built-in background values and
 * the classes that per-slide-type CSS already styles (freeform/countdown's
 * extended set). Relabeling lime/mist stays a `theme.backgroundLabels` job.
 */
export const RESERVED_SLIDE_BG_IDS = new Set([
  'lime',
  'mist',
  'dark',
  'accent',
  'brand-1',
  'brand-2',
  'custom',
  'transparent',
]);

function cleanCssValue(raw) {
  const v = String(raw || '').trim();
  // cssVars are trusted theme content, but these values also land in a
  // generated <style> block — reject anything that could close a declaration
  // or block and smuggle in extra rules.
  if (!v || /[{};]/.test(v) || /<\//.test(v)) return '';
  return v;
}

/**
 * Normalize a theme's raw `slideBackgrounds` array. Drops entries with
 * missing/unsafe ids or values, reserved ids, and duplicates. `textColorMuted`
 * only applies when `textColor` is set (a muted override without a base text
 * colour has nothing to be muted *from*).
 *
 * @param {unknown} raw - `theme.slideBackgrounds` as authored
 * @returns {Array<{id: string, label: string, value: string, textColor?: string, textColorMuted?: string}>}
 */
export function normalizeSlideBackgrounds(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const id = String(e.id || '').trim().toLowerCase();
    if (!SLIDE_BG_ID_RE.test(id)) continue;
    if (RESERVED_SLIDE_BG_IDS.has(id)) continue;
    if (seen.has(id)) continue;
    const value = cleanCssValue(e.value);
    if (!value) continue;
    seen.add(id);
    const entry = {
      id,
      label: String(e.label || '').trim() || id,
      value,
    };
    const textColor = cleanCssValue(e.textColor);
    if (textColor) {
      entry.textColor = textColor;
      const muted = cleanCssValue(e.textColorMuted);
      if (muted) entry.textColorMuted = muted;
    }
    out.push(entry);
  }
  return out;
}

/**
 * cssVars contributed by normalized variants. Merged into `theme.cssVars`, so
 * they flow through the existing plumbing for free: inline per-slide
 * application (`applyThemeVarsToElement`) and export CSS (`themeVarsCssText`).
 *
 * @param {ReturnType<typeof normalizeSlideBackgrounds>} entries
 * @returns {Record<string, string>}
 */
export function slideBackgroundCssVars(entries) {
  const vars = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    vars[`--t-slide-bg-${e.id}`] = e.value;
    if (e.textColor) vars[`--t-slide-bg-${e.id}-text`] = e.textColor;
    if (e.textColorMuted)
      vars[`--t-slide-bg-${e.id}-text-muted`] = e.textColorMuted;
  }
  return vars;
}

/**
 * Generated CSS rules for normalized variants. Injected client-side per theme
 * (`injectThemeSlideBgStyles` in client/lib/theme.js) and appended to the
 * export theme CSS (`themeVarsCssText` in server/utils/themes.js).
 *
 * `background` is set at two-class specificity so variants also override the
 * slide types whose roots hardcode `background: var(--slide-bg-mist)` — that's
 * what makes variants work "without per-type code changes". Every var has a
 * fallback so a stale `background` value (variant id from another theme)
 * degrades to the theme's default background + text instead of invalid CSS.
 *
 * @param {ReturnType<typeof normalizeSlideBackgrounds>} entries
 * @returns {string} CSS text ('' when there are no variants)
 */
export function slideBackgroundsCssText(entries) {
  const rules = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const lines = [
      `  --slide-bg: var(--t-slide-bg-${e.id}, var(--color-background));`,
      '  background: var(--slide-bg, var(--color-background));',
    ];
    if (e.textColor) {
      // Same token-redirect pattern as .has-slide-bg-light-text/-dark-text.
      lines.push(
        `  --slide-bg-text: var(--t-slide-bg-${e.id}-text, var(--t-color-text, #0b0b0b));`,
        `  --slide-bg-text-muted: var(--t-slide-bg-${e.id}-text-muted, color-mix(in srgb, var(--slide-bg-text) 70%, transparent));`,
        '  --color-text: var(--slide-bg-text);',
        '  --color-text-muted: var(--slide-bg-text-muted);',
        '  color: var(--slide-bg-text);'
      );
    }
    rules.push(`.slide.slide-bg-${e.id} {\n${lines.join('\n')}\n}`);
  }
  return rules.join('\n');
}

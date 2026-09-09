/**
 * Per-language resolution of a slide type's content defaults — the type-level
 * twin of `item-defaults.js`, which does the same for a collection field's
 * new-item skeleton.
 *
 * A type declares `defaults` (the neutral skeleton) and may declare
 * `defaultsByLang` holding complete per-language variants keyed by deck
 * language (`nl`, `'en-GB'`). A language with no entry — and a deck language
 * off that axis — falls back to `defaults`, so a type that reads the same in
 * every language declares nothing.
 *
 * One resolver because two surfaces ask the question and must not drift: the
 * slide factory (`newSlide`, where a slide comes into being) and the type
 * converter (`convert.js`, where an existing slide is re-seeded for its new
 * type). They used to carry the same nested `typeof` ladder twice, spelled
 * slightly differently.
 *
 * A theme takes part in the same answer. A slide type declares its background
 * theme-agnostically (`lime` on fourteen types, `mist` on twelve, `dark` on
 * one) because it cannot know which theme will carry it; a theme whose whole
 * design stands on another ground says so once with `defaultBackground`, and
 * that value replaces the type's default here — for every route, because this
 * is the only place a type's defaults are resolved.
 */

import { allowedEnumValues } from './field-types.js';

/**
 * A clone of the type's defaults for a deck language and theme, ready to be
 * mutated by the caller.
 *
 * @param {{defaults?: Object, defaultsByLang?: Object, fields?: Array}|null|undefined} def -
 *   a slide-type definition (registry entry, or the `/api/slide-types`
 *   metadata the editor holds)
 * @param {string|null} [lang] - deck language, already normalized
 *   (`normalizeLang`); anything falsy or off-axis takes `defaults`
 * @param {Object|null} [theme] - the active theme, when the caller has one.
 *   Its `defaultBackground` replaces the type's default `background` where the
 *   type offers that id (see {@link applyThemeDefaultBackground}).
 * @returns {Object} a fresh object — never a reference into the definition
 */
export function resolveTypeDefaults(def, lang, theme = null) {
  const byLang = def?.defaultsByLang;
  const langDefaults =
    typeof lang === 'string' &&
    lang &&
    byLang &&
    typeof byLang === 'object' &&
    byLang[lang] &&
    typeof byLang[lang] === 'object'
      ? byLang[lang]
      : null;
  const out = structuredClone(langDefaults || def?.defaults || {});
  return applyThemeDefaultBackground(out, def, theme);
}

/**
 * Put the theme's ground under a type's defaults, where the type offers it.
 *
 * The one test is the union the editor's background picker already builds:
 * the type's own `background` options extended with the theme's
 * `slideBackgrounds` variants — read here through `allowedEnumValues(field,
 * theme)`, the function every other surface asks the same question with. So a
 * theme may name a variant of its own (`calm`) as well as `lime`/`mist`, and a
 * type that does not offer the id — or declares no `background` field at all,
 * like `quote-slide` — keeps its own default. There is no branch on a type
 * name: what a type offers is what its declaration says it offers.
 *
 * Mutates and returns `defaults`, which is already a fresh clone here.
 *
 * @param {Object} defaults - the resolved type defaults
 * @param {{fields?: Array}|null|undefined} def - the slide type definition
 * @param {Object|null|undefined} theme - the active theme
 * @returns {Object} the same `defaults` object
 */
export function applyThemeDefaultBackground(defaults, def, theme) {
  const wanted = String(theme?.defaultBackground || '')
    .trim()
    .toLowerCase();
  if (!wanted || !defaults || typeof defaults !== 'object') return defaults;
  const field = (def?.fields || []).find((f) => f?.key === 'background');
  if (!field) return defaults;
  if (!allowedEnumValues(field, theme).includes(wanted)) return defaults;
  defaults.background = wanted;
  return defaults;
}

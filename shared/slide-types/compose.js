/**
 * The composition every slide-type definition goes through before anything
 * reads it: the global slide fields appended to the type's own schema, then the
 * i18n key annotations.
 *
 * It lives here, apart from the registry, because **two paths compose a
 * definition**. The registry composes core and file-JS types at boot
 * (`registry.js`); `buildMergedSlideTypes` composes an organization's
 * database-backed types per request (`server/utils/custom-slide-type-runtime.js`).
 * They ran different compositions until B240 — a DB type reached the inspector
 * without a background, a11y or logo field, so those controls were simply
 * absent for it while `renderSlideHtml` injected the same layers all the same.
 * Two spellings of "a registry entry" is how a consumer ends up reading a
 * differently-shaped def than the editor does.
 *
 * A leaf module on purpose: the Settings builder and the DB field rules need
 * `GLOBAL_SLIDE_FIELD_KEYS` (a `mediaRef.linkKey` may name an injected field),
 * and importing the registry for a list of nine strings would pull all 33 core
 * types into the settings bundle.
 */

import { addUiI18nKeysToSlideType, sharedOption } from '../ui-i18n-keys.js';

// Canonical list of content keys that withGlobalSlideFields() adds to every
// slide type. Kept here as the single source of truth so other layers
// (slide conversion, AI/MCP specs) can reference the same set without drift.
export const GLOBAL_SLIDE_FIELD_KEYS = [
  'a11yTitle',
  'a11ySummary',
  'slideBgImage',
  'slideBgFit',
  'slideBgFocusX',
  'slideBgFocusY',
  'slideBgOverlay',
  'slideBgText',
  'slideLogo',
];

// Both a11y fields share the placeholder text "Optional" — same text, same key.
const OPTIONAL_PLACEHOLDER_KEY = 'editor.slideField.optionalPlaceholder';

// The global fields below declare explicit `editor.slideField.*` i18n keys, so
// their editor copy is ONE key per text instead of a generated
// `slideType.<type>.field.<key>…` copy per registered type: an explicit `*Key`
// wins both in addUiI18nKeysToSlideType() and in the key walker
// (scripts/lib/slide-type-i18n-keys.js), so the per-type keys are never minted
// for these fields (B140).
//
// `editor.slideField.*` is the namespace for a **type-independent field**, not
// only for a global one (D60). The registry's globals were merely the first
// tenants; the shared field constants (BACKGROUND_FIELD, TABLE_STYLE_FIELD,
// ACTIONS_FIELD, alignGroup()'s enum) and the field labels that repeat verbatim
// across types (`title`, `subheading`, `caption`, …) live there too. Whether a
// field is injected here or declared by each type is a registry implementation
// detail; it is not a difference in what the copy MEANS, and only a difference
// in meaning earns its own namespace (B146).
function withGlobalSlideFields(def) {
  const d = def && typeof def === 'object' ? def : {};
  const fields = Array.isArray(d.fields) ? d.fields : [];
  const has = new Set(fields.map((f) => String(f?.key || '')));
  const extra = [];
  if (!has.has('a11yTitle')) {
    extra.push({
      key: 'a11yTitle',
      type: 'string',
      labelKey: 'editor.slideField.a11yTitle.label',
      label: 'Accessibility title',
      placeholderKey: OPTIONAL_PLACEHOLDER_KEY,
      placeholder: 'Optional',
      helpTextKey: 'editor.slideField.a11yTitle.help',
      helpText:
        'Optional. Screen readers announce this when the slide becomes active. Prefer a short, descriptive phrase.',
      maxLength: 140,
    });
  }
  if (!has.has('a11ySummary')) {
    extra.push({
      key: 'a11ySummary',
      type: 'string',
      labelKey: 'editor.slideField.a11ySummary.label',
      label: 'Accessibility summary',
      placeholderKey: OPTIONAL_PLACEHOLDER_KEY,
      placeholder: 'Optional',
      helpTextKey: 'editor.slideField.a11ySummary.help',
      helpText:
        'Optional extra context for screen readers (announced after the title). Keep it brief.',
      maxLength: 280,
    });
  }
  // Optional per-slide background image, available on every slide type.
  // Rendered centrally in renderSlideHtml() as a layer behind the slide content,
  // so individual slide-type renderers don't need to know about it.
  if (!has.has('slideBgImage')) {
    extra.push({
      key: 'slideBgImage',
      type: 'image',
      labelKey: 'editor.slideField.slideBgImage.label',
      label: 'Background image',
      required: false,
      presetSource: 'backgrounds',
      helpTextKey: 'editor.slideField.slideBgImage.help',
      helpText:
        'Optional. Fills the whole slide behind the content. Large images are resized automatically; use the focus control to pick which part stays visible when cropped.',
    });
  }
  if (!has.has('slideBgFit')) {
    extra.push({
      key: 'slideBgFit',
      type: 'enum',
      labelKey: 'editor.slideField.slideBgFit.label',
      label: 'Background fit',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.slideBgFit.option.cover',
          'cover',
          'Fill (crop)',
        ),
        sharedOption(
          'editor.slideField.slideBgFit.option.contain',
          'contain',
          'Fit (no crop)',
        ),
      ],
    });
  }
  if (!has.has('slideBgFocusX')) {
    extra.push({
      key: 'slideBgFocusX',
      type: 'number',
      labelKey: 'editor.slideField.slideBgFocusX.label',
      label: 'Background focus X',
      required: false,
    });
  }
  if (!has.has('slideBgFocusY')) {
    extra.push({
      key: 'slideBgFocusY',
      type: 'number',
      labelKey: 'editor.slideField.slideBgFocusY.label',
      label: 'Background focus Y',
      required: false,
    });
  }
  if (!has.has('slideBgOverlay')) {
    extra.push({
      key: 'slideBgOverlay',
      type: 'enum',
      labelKey: 'editor.slideField.slideBgOverlay.label',
      label: 'Background overlay',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.slideBgOverlay.option.auto',
          'auto',
          'Auto (only if needed)',
        ),
        sharedOption(
          'editor.slideField.slideBgOverlay.option.none',
          'none',
          'None',
        ),
        sharedOption(
          'editor.slideField.slideBgOverlay.option.light',
          'light',
          'Light scrim',
        ),
        sharedOption(
          'editor.slideField.slideBgOverlay.option.dark',
          'dark',
          'Dark scrim',
        ),
        sharedOption(
          'editor.slideField.slideBgOverlay.option.gradient-top',
          'gradient-top',
          'Gradient (top)',
        ),
        sharedOption(
          'editor.slideField.slideBgOverlay.option.gradient-bottom',
          'gradient-bottom',
          'Gradient (bottom)',
        ),
      ],
      helpTextKey: 'editor.slideField.slideBgOverlay.help',
      helpText:
        'Auto adds a subtle scrim only when the image is too busy for readable text. Gradient options darken one edge behind the text.',
    });
  }
  if (!has.has('slideBgText')) {
    extra.push({
      key: 'slideBgText',
      type: 'enum',
      labelKey: 'editor.slideField.slideBgText.label',
      label: 'Text colour',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.slideBgText.option.auto',
          'auto',
          'Auto (detect)',
        ),
        sharedOption(
          'editor.slideField.slideBgText.option.light',
          'light',
          'Light',
        ),
        sharedOption(
          'editor.slideField.slideBgText.option.dark',
          'dark',
          'Dark',
        ),
      ],
      helpTextKey: 'editor.slideField.slideBgText.help',
      helpText:
        'Auto picks the theme text colour with the best contrast for the background image. Light/dark force it. (Legacy "default" is treated as the theme default.)',
    });
  }
  // Optional per-slide theme logo in a corner. Uses the logo defined by the
  // active theme (theme.assets.logo); rendered centrally in renderSlideHtml.
  if (!has.has('slideLogo')) {
    extra.push({
      key: 'slideLogo',
      type: 'enum',
      labelKey: 'editor.slideField.slideLogo.label',
      label: 'Theme logo',
      required: false,
      options: [
        sharedOption('editor.slideField.slideLogo.option.none', 'none', 'Off'),
        sharedOption(
          'editor.slideField.slideLogo.option.top-right',
          'top-right',
          'Top right',
        ),
      ],
      helpTextKey: 'editor.slideField.slideLogo.help',
      helpText: 'Show the active theme logo in a corner of this slide.',
    });
  }
  if (!extra.length) return d;
  return { ...d, fields: [...fields, ...extra] };
}

/**
 * Compose one registry entry: global fields, then i18n key annotations.
 *
 * @param {string} type - The registry key the definition is stored under
 * @param {Object} def - The type's own definition
 * @returns {Object} The composed definition every consumer reads
 */
export function composeSlideType(type, def) {
  return addUiI18nKeysToSlideType(type, withGlobalSlideFields(def));
}

import {
  isIsoString,
  isNonEmptyString,
  isUuid,
  cryptoUuid,
  esc,
} from './helpers.js';
import { pickBackgroundPreset } from '../theme-background-presets.js';
import { applyLocksToContent } from '../theme-locks.js';
import { SLIDE_TYPES, THEMES } from './registry.js';
import { validateVisibility } from '../slide-visibility.js';
import { SLIDE_BG_ID_RE } from '../theme-slide-backgrounds.js';
import { injectTextStyles } from './text-styles.js';

function enumOptionValues(field) {
  const opts = Array.isArray(field?.options) ? field.options : [];
  return opts
    .map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object' && o.value != null) return String(o.value);
      return null; // Mark invalid entries as null
    })
    .filter((v) => v !== null); // Filter out null but keep empty strings
}

export function newPresentation({
  title = 'Untitled presentation',
  theme = 'default',
  lang = 'nl',
  defaultTitleSlide = 'title-slide',
  // The loaded theme object, when the caller has one. `theme` above is just the
  // id that gets stored on the deck; this is what supplies background presets.
  themeConfig = null,
} = {}) {
  const now = new Date().toISOString();
  // Use the provided default title slide, falling back to 'title-slide' if invalid.
  const titleSlideType = typeof defaultTitleSlide === 'string' && defaultTitleSlide.trim()
    ? defaultTitleSlide.trim()
    : 'title-slide';
  return {
    id: cryptoUuid(),
    title,
    // Used for public sharing (meta description) and integrations (webhooks).
    // Keep it short; UI/AI tooling can help generate this later.
    description: '',
    created: now,
    modified: now,
    theme,
    lang: lang === 'en-GB' ? 'en-GB' : 'nl',
    settings: {
      qaEnabled: true,
      // Presenter stepping ("Tekst stap voor stap"): hide/reveal fragments while presenting.
      // Default to off; user can opt in via deck settings.
      stepParagraphs: false,
      transitions: {
        // Presenter slide-to-slide transitions (polish). Default to none so edits feel stable
        // and users explicitly opt into motion.
        preset: 'none', // 'none' | 'fade' | 'slide' | 'push' | 'cube'
      },
      // Live video overlay: persistent video stream floating on top of slides.
      // Configured via deck settings; rendered client-side only.
      liveVideo: {
        enabled: false,
        streamUrl: '',
        provider: '',            // auto-detected from streamUrl
        defaultPosition: 'pip-top-right',
        mobilePosition: 'bottom', // 'bottom' | 'top' | 'hidden' | 'pip'
      },
      // Auto-advance: automatically advance slides on a timer.
      // Configured via deck settings; runs client-side in presenter and share viewer.
      autoAdvance: {
        enabled: false,
        intervalSeconds: 20,
        loop: false,
        showCountdown: true,
        mode: 'auto', // 'auto' | 'pacing'
      },
    },
    slides: [newSlide({ type: titleSlideType, theme: themeConfig })],
  };
}

/**
 * Create a blank slide of a given type.
 *
 * @param {Object} opts
 * @param {string} opts.type - slide type id
 * @param {string|null} [opts.parentId] - parent slide id, or null for top-level
 * @param {Object} [opts.theme] - the active theme. Types declaring
 *   `autoBackgroundPreset` take their background image from
 *   `theme.backgroundPresets`; without a theme (or without presets) the slide
 *   is created with no background image.
 */
export function newSlide({ type, parentId = null, theme = null }) {
  const def = SLIDE_TYPES[type];
  if (!def) throw new Error(`Unknown slide type: ${type}`);
  const slide = {
    id: cryptoUuid(),
    type,
    parentId: parentId || null, // null = top-level, UUID = child of that slide
    content: structuredClone(def.defaults),
    notes: '',
    visibility: {}, // Empty = all false = visible everywhere (backward compatible)
  };
  // If slide type has autoBackgroundPreset, pick a random background from presets
  if (def.autoBackgroundPreset) {
    const bgImage =
      typeof slide.content.bgImage === 'string'
        ? slide.content.bgImage.trim()
        : '';
    if (!bgImage) slide.content.bgImage = pickBackgroundPreset(theme);
  }
  if (type === 'poll-slide') {
    const pollId =
      typeof slide.content.pollId === 'string'
        ? slide.content.pollId.trim()
        : '';
    if (!pollId) slide.content.pollId = cryptoUuid();
  }
  return slide;
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Keep only characters safe inside a CSS url('...') / HTML attribute context.
function sanitizeBgUrl(url) {
  return String(url).replace(/["'()\\<>\n\r]/g, '').trim();
}

// Resolve which text-contrast class (if any) to apply for a background image.
// - 'light' / 'dark': author forces the theme's light/dark text colour
//   (--t-text-color-light / --t-text-color-dark).
// - 'auto': use the recommendation detected and stored at edit time
//   (content.slideBgTextAuto) by client/lib/bg-contrast.js. If it's absent
//   (old slide, or detection couldn't run, e.g. a cross-origin image), leave
//   the theme default so nothing regresses.
// - 'default' / absent (legacy): no override.
function resolveBgTextClass(content) {
  const mode = content?.slideBgText;
  if (mode === 'light') return 'has-slide-bg-light-text';
  if (mode === 'dark') return 'has-slide-bg-dark-text';
  if (mode === 'auto') {
    const auto = content?.slideBgTextAuto;
    if (auto === 'light') return 'has-slide-bg-light-text';
    if (auto === 'dark') return 'has-slide-bg-dark-text';
  }
  return '';
}

// Resolve the overlay variant (suffix of slide-bg-overlay-<variant>) to draw
// over a background image, or '' for no overlay.
// - 'light' / 'dark': flat scrim (manual).
// - 'gradient-top' / 'gradient-bottom': directional gradient scrim (manual).
// - 'auto' (default) or absent: add a subtle scrim ONLY when auto text-detection
//   flagged the image as low-contrast behind the title (content.slideBgNeedsScrim,
//   set by client/lib/bg-contrast.js) and a text colour was chosen. Its tint
//   follows the resolved text colour (dark scrim under light text, and vice
//   versa) via CSS.
// - 'none': explicitly opt out, even when a scrim was suggested.
function resolveBgOverlayVariant(content, textClass) {
  const mode = content?.slideBgOverlay;
  if (
    mode === 'light' ||
    mode === 'dark' ||
    mode === 'gradient-top' ||
    mode === 'gradient-bottom'
  ) {
    return mode;
  }
  if (mode === 'none') return '';
  const autoScrim =
    content?.slideBgText === 'auto' &&
    content?.slideBgNeedsScrim === true &&
    textClass !== '';
  return autoScrim ? 'auto' : '';
}

// Inject an optional per-slide background image as a layer behind the slide
// content. Works on the output of any slide type's renderHtml() by adding a
// marker class to the root .slide element and inserting the layer as its first
// child, so the feature is available everywhere without per-type changes.
function injectSlideBackground(html, content) {
  const raw =
    typeof content?.slideBgImage === 'string' ? content.slideBgImage.trim() : '';
  if (!raw) return html;
  const url = sanitizeBgUrl(raw);
  if (!url) return html;
  const fit = content?.slideBgFit === 'contain' ? 'contain' : 'cover';
  const focusX = clampPercent(content?.slideBgFocusX, 50);
  const focusY = clampPercent(content?.slideBgFocusY, 50);
  const textClass = resolveBgTextClass(content);
  const overlayVariant = resolveBgOverlayVariant(content, textClass);
  const layer =
    `<div class="slide-bg-layer" aria-hidden="true" style="background-image:url('${url}');background-size:${fit};background-position:${focusX}% ${focusY}%;"></div>` +
    (overlayVariant
      ? `<div class="slide-bg-overlay slide-bg-overlay-${overlayVariant}" aria-hidden="true"></div>`
      : '');
  const cls = `has-slide-bg has-slide-bg-${fit}${
    overlayVariant ? ' has-slide-bg-overlay' : ''
  }${textClass ? ' ' + textClass : ''}`;
  let injected = false;
  const out = html.replace(
    /<div\b([^>]*?)\bclass="(slide(?:\s[^"]*)?)"([^>]*)>/,
    (_m, pre, classes, post) => {
      injected = true;
      return `<div${pre}class="${classes} ${cls}"${post}>${layer}`;
    }
  );
  return injected ? out : html;
}

// Inject an optional per-slide theme logo into a corner of the slide. The logo
// comes from the active theme (ctx.theme.assets.logo), matching the logo shown
// elsewhere in the theme. Works on any slide type's rendered output.
function injectSlideLogo(html, content, ctx) {
  if (content?.slideLogo !== 'top-right') return html;
  const theme =
    ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
  const src = sanitizeBgUrl(
    String(theme?.assets?.logo || '/assets/images/logo.svg')
  );
  if (!src) return html;
  const alt = esc(String(theme?.assets?.logoAlt || 'Logo'));
  const node =
    `<div class="slide-logo-corner slide-logo-top-right" data-morph-role="corner-logo">` +
    `<img class="slide-logo-corner-img" src="${src}" alt="${alt}" /></div>`;
  let injected = false;
  const out = html.replace(
    /<div\b([^>]*?)\bclass="(slide(?:\s[^"]*)?)"([^>]*)>/,
    (_m, pre, classes, post) => {
      injected = true;
      return `<div${pre}class="${classes} has-slide-logo"${post}>${node}`;
    }
  );
  return injected ? out : html;
}

export function renderSlideHtml(slide, ctx = {}) {
  // Allow callers to provide their own slide types (e.g., client using server-fetched types).
  // This is essential for custom slide types that aren't bundled in the client build.
  const slideTypes = ctx?.slideTypes && typeof ctx.slideTypes === 'object'
    ? ctx.slideTypes
    : SLIDE_TYPES;
  const def = slideTypes[slide?.type];
  if (!def || typeof def.renderHtml !== 'function') {
    return `
      <div class="slide">
        <div class="slide-inner">
          <div class="heading">Unknown slide type</div>
        </div>
      </div>
    `;
  }
  // Theme override locks: strip anything the theme has locked before the type
  // renders, so a deck authored before the lock cannot leak past the branding.
  // Doing it here rather than in each type's bgClass() call covers the injected
  // background and logo in the same pass. Stored slide data is untouched — this
  // is a filtered view, so unlocking restores every slide's own value.
  const content = applyLocksToContent(slide?.content || {}, ctx?.theme);
  let out = def.renderHtml(content, slide, ctx);
  // Per-field block-level text styling (alignment/colour): adds tf-* classes
  // to the matching data-inline-field element. Runs on the type's own output
  // (its field elements), before the slide-wrapper injections below.
  out = injectTextStyles(out, content);
  out = injectSlideBackground(out, content);
  out = injectSlideLogo(out, content, ctx);
  return out;
}

export function validatePresentation(pres, opts = {}) {
  const errors = [];
  // Server can override this with the runtime list of available themes.
  // Keep a safe default for client-side validation and older callers.
  const allowedThemes =
    Array.isArray(opts?.allowedThemes) && opts.allowedThemes.length
      ? opts.allowedThemes
      : THEMES;
  if (!pres || typeof pres !== 'object')
    return {
      ok: false,
      errors: ['Presentation must be an object'],
    };
  if (!isUuid(pres.id))
    errors.push('Presentation.id must be a UUID');
  if (!isNonEmptyString(pres.title))
    errors.push('Presentation.title is required');
  if (pres.description != null && typeof pres.description !== 'string')
    errors.push('Presentation.description must be a string');
  if (
    typeof pres.description === 'string' &&
    pres.description.length > 600
  )
    errors.push('Presentation.description exceeds max length (600)');
  if (!isIsoString(pres.created))
    errors.push('Presentation.created must be ISO-8601');
  if (!isIsoString(pres.modified))
    errors.push('Presentation.modified must be ISO-8601');
  if (
    pres.lang != null &&
    pres.lang !== 'nl' &&
    pres.lang !== 'en-GB'
  )
    errors.push('Presentation.lang must be "nl" or "en-GB"');
  if (pres.theme && !allowedThemes.includes(pres.theme))
    errors.push(
      `Presentation.theme must be one of: ${allowedThemes.join(
        ', '
      )}`
    );
  if (!Array.isArray(pres.slides))
    errors.push('Presentation.slides must be an array');

  for (const slide of pres.slides || []) {
    const slideErrors = validateSlide(slide);
    for (const e of slideErrors) errors.push(e);
  }

  return { ok: errors.length === 0, errors };
}

export function validateSlide(slide) {
  const errors = [];
  if (!slide || typeof slide !== 'object')
    return ['Slide must be an object'];
  if (!isUuid(slide.id))
    errors.push('Slide.id must be a UUID');
  if (
    !isNonEmptyString(slide.type) ||
    !SLIDE_TYPES[slide.type]
  )
    errors.push(
      `Slide.type must be a known slide type (got: ${JSON.stringify(
        slide?.type
      )}, slideId: ${JSON.stringify(slide?.id)})`
    );
  if (!slide.content || typeof slide.content !== 'object')
    errors.push('Slide.content must be an object');
  if (
    slide.notes != null &&
    typeof slide.notes !== 'string'
  )
    errors.push('Slide.notes must be a string');
  // parentId validation: must be null or a valid UUID
  if (
    slide.parentId != null &&
    !isUuid(slide.parentId)
  )
    errors.push('Slide.parentId must be null or a valid UUID');
  // Per-slide duration override validation
  if (slide.duration != null) {
    const d = Number(slide.duration);
    if (!Number.isFinite(d) || d < 1 || d > 300)
      errors.push('Slide.duration must be 1-300 seconds');
  }
  // visibility validation
  const visibilityErrors = validateVisibility(slide.visibility);
  for (const e of visibilityErrors) errors.push(e);
  const def = SLIDE_TYPES[slide.type];
  if (!def) return errors;

  for (const field of def.fields) {
    const val = slide.content[field.key];
    if (field.required) {
      if (field.type === 'image') {
        if (!isNonEmptyString(val))
          errors.push(
            `Slide.content.${field.key} is required`
          );
      } else if (field.type === 'images') {
        if (
          !Array.isArray(val) ||
          val.filter((v) => isNonEmptyString(v)).length ===
            0
        )
          errors.push(
            `Slide.content.${field.key} is required`
          );
      } else if (field.type === 'items') {
        if (!Array.isArray(val) || val.length === 0)
          errors.push(
            `Slide.content.${field.key} is required`
          );
      } else if (!isNonEmptyString(val)) {
        errors.push(
          `Slide.content.${field.key} is required`
        );
      }
    }
    if (
      field.type === 'string' ||
      field.type === 'markdown' ||
      field.type === 'csv' ||
      field.type === 'code'
    ) {
      // Optional text fields may be missing/null in older decks or external integrations.
      // Only enforce string type when the value is present.
      if (val != null && typeof val !== 'string')
        errors.push(
          `Slide.content.${field.key} must be a string`
        );
      if (
        field.maxLength &&
        typeof val === 'string' &&
        val.length > field.maxLength
      ) {
        errors.push(
          `Slide.content.${field.key} exceeds max length (${field.maxLength})`
        );
      }
    }
    if (field.type === 'images') {
      // Skip validation if value is missing (back-compat for old presentations without this field)
      if (val == null) continue;
      if (!Array.isArray(val))
        errors.push(
          `Slide.content.${field.key} must be an array`
        );
      else {
        const bad = val.filter(
          (v) => typeof v !== 'string' || !v.trim()
        );
        if (bad.length)
          errors.push(
            `Slide.content.${field.key} must be an array of non-empty strings`
          );
        if (field.maxItems && val.length > field.maxItems)
          errors.push(
            `Slide.content.${field.key} must have at most ${field.maxItems} items`
          );
      }
    }
    if (field.type === 'items') {
      // Skip validation if value is missing (back-compat for old presentations without this field)
      if (val == null) continue;
      if (!Array.isArray(val))
        errors.push(
          `Slide.content.${field.key} must be an array`
        );
      else {
        const minItems = Math.max(
          0,
          Number(field.minItems || 0) || 0
        );
        const maxItems = Number(field.maxItems || 0) || 0;
        if (minItems && val.length < minItems)
          errors.push(
            `Slide.content.${field.key} must have at least ${minItems} items`
          );
        if (maxItems && val.length > maxItems)
          errors.push(
            `Slide.content.${field.key} must have at most ${maxItems} items`
          );
        const itemFields = Array.isArray(field.itemFields)
          ? field.itemFields
          : [];
        for (let i = 0; i < val.length; i += 1) {
          const it = val[i];
          if (!it || typeof it !== 'object') {
            errors.push(
              `Slide.content.${field.key}[${i}] must be an object`
            );
            continue;
          }
          for (const f of itemFields) {
            if (!f || typeof f.key !== 'string') continue;
            const iv = it[f.key];
            if (f.required && !isNonEmptyString(iv))
              errors.push(
                `Slide.content.${field.key}[${i}].${f.key} is required`
              );
            if (f.type === 'string') {
              if (iv != null && typeof iv !== 'string')
                errors.push(
                  `Slide.content.${field.key}[${i}].${f.key} must be a string`
                );
              if (
                f.maxLength &&
                typeof iv === 'string' &&
                iv.length > f.maxLength
              )
                errors.push(
                  `Slide.content.${field.key}[${i}].${f.key} exceeds max length (${f.maxLength})`
                );
            }
          }
        }
      }
    }
    if (field.type === 'boolean') {
      // Cleared boolean fields use the repo's '' convention (like enums); only
      // a present non-empty value must be an actual boolean.
      if (val != null && val !== '' && typeof val !== 'boolean')
        errors.push(
          `Slide.content.${field.key} must be a boolean`
        );
    }
    if (field.type === 'enum') {
      const allowed = enumOptionValues(field);
      // The background field also accepts theme-defined variant ids
      // (theme.slideBackgrounds — see shared/theme-slide-backgrounds.js).
      // Validation has no theme context, so any safe slug passes; unknown ids
      // render as an inert class and fall back to the default background.
      const isThemeBgVariant =
        field.key === 'background' &&
        typeof val === 'string' &&
        SLIDE_BG_ID_RE.test(val);
      // Cleared enum fields use the repo's '' convention (see boolean above):
      // empty = unset / follow the type default. The editor folds and the
      // silent-default controls write '' (image-slide fit/layout, image-text
      // imageFit, content-columns col{n}ImageFit), so round-tripping such
      // content through the API must stay valid. Required enums still reject
      // '' via the required check above.
      if (val != null && val !== '' && !allowed.includes(val) && !isThemeBgVariant)
        errors.push(
          `Slide.content.${
            field.key
          } must be one of: ${allowed.join(', ')}`
        );
    }
  }
  return errors;
}
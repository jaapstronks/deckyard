/**
 * Theme override locks.
 *
 * A theme declares, per brand property, whether a slide may override it:
 *
 * - `open`   — the theme supplies a default, per-slide overrides win (today's
 *              behaviour, and the default for every property).
 * - `locked` — the theme wins. The editor hides the control, and the renderer
 *              ignores any override already stored on the slide, so a deck
 *              authored before the lock cannot leak past the branding.
 *
 * Enforcement is deliberately non-destructive: `applyLocksToContent` returns a
 * copy with the locked keys removed and never touches stored slide data.
 * Unlocking a property restores every slide's own value.
 *
 * The policy is coarse on purpose — a handful of high-value brand properties,
 * not a lock per token. `LOCKABLE_PROPERTIES` lists only properties that have a
 * per-slide control to lock; adding one without the control it guards would be
 * a switch that does nothing.
 */

/** Brand properties a theme can lock. Order is the order the editor shows them. */
export const LOCKABLE_PROPERTIES = ['background', 'logo'];

/**
 * The slide-content keys each lock governs.
 *
 * `background` covers the whole background section the editor presents as one
 * control: the colour/variant, the custom colour, the per-slide background
 * image and everything that positions or scrims it — including the derived
 * contrast keys the editor writes when it samples an image, which would
 * otherwise survive as stale hints for an image that no longer renders.
 */
export const LOCKED_CONTENT_KEYS = {
  background: [
    'background',
    'bgCustomColor',
    'bgImage',
    'slideBgImage',
    'slideBgFit',
    'slideBgFocusX',
    'slideBgFocusY',
    'slideBgOverlay',
    'slideBgText',
    'slideBgTextAuto',
    'slideBgNeedsScrim',
    'slideBgAutoFor',
  ],
  logo: ['slideLogo'],
};

const LOCKED = 'locked';

/**
 * Read a theme's lock policy, defaulting every property to `open`.
 * @param {Object} [theme]
 * @returns {Object<string, 'open'|'locked'>}
 */
export function getLockPolicy(theme) {
  const raw = theme && typeof theme.locks === 'object' ? theme.locks : {};
  const out = {};
  for (const prop of LOCKABLE_PROPERTIES) {
    out[prop] = raw[prop] === LOCKED ? LOCKED : 'open';
  }
  return out;
}

/**
 * Is this brand property locked by the theme?
 *
 * Missing theme, missing policy or an unknown property all read as unlocked —
 * a render path that forgets to pass the theme must degrade to today's
 * behaviour, never to a silently stripped slide.
 *
 * @param {Object} [theme]
 * @param {string} prop
 * @returns {boolean}
 */
export function isLocked(theme, prop) {
  if (!LOCKABLE_PROPERTIES.includes(prop)) return false;
  return theme?.locks?.[prop] === LOCKED;
}

/**
 * Strip every override the theme has locked.
 *
 * @param {Object} content - a slide's content
 * @param {Object} [theme] - the active theme; absent means nothing is locked
 * @returns {Object} the same object when nothing is locked (so the common path
 *   allocates nothing), otherwise a copy without the locked keys
 */
export function applyLocksToContent(content, theme) {
  if (!content || typeof content !== 'object') return content;

  const locked = LOCKABLE_PROPERTIES.filter((prop) => isLocked(theme, prop));
  if (!locked.length) return content;

  const strip = new Set(locked.flatMap((prop) => LOCKED_CONTENT_KEYS[prop]));
  const out = {};
  for (const [key, value] of Object.entries(content)) {
    if (!strip.has(key)) out[key] = value;
  }
  return out;
}

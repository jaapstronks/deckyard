// Is the surface a slide renders on dark or light?
//
// Several central injectors need to know this without the DOM: the per-slide
// theme logo picks between a dark-ground and a light-ground mark, and anything
// added later that has to sit legibly on top of the slide will want the same
// answer. The CSS side already solves it with token redirects
// (`--slide-on-surface` and friends, see shared/theme-slide-backgrounds.js and
// client/styles/slides/01-layout-and-title/00-base.css), but an <img> `src`
// cannot be chosen by the cascade — it has to be resolved at render time, on
// the server and in the editor alike, from `content` plus the active theme.
//
// The answer is deliberately three-valued. '' means "no reliable signal", and
// callers must keep their existing default rather than guess: a wrong guess
// flips a logo to the invisible variant, which is worse than the status quo.

import { hexToRgb, pickTextColorForBg } from './color-utils.js';

// The last colour literal in a CSS background shorthand is its ground — the
// layer every other layer is composited over, and the one that shows wherever
// an image layer is transparent or has not loaded. `url(...)` may carry `#`
// inside a fragment, so images are stripped before scanning.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function groundHexOf(cssValue) {
  const withoutUrls = String(cssValue || '').replace(/url\([^)]*\)/g, '');
  const found = withoutUrls.match(HEX_RE);
  return found ? found[found.length - 1] : '';
}

function toneOfHex(hex) {
  // pickTextColorForBg returns the light pole for a dark ground. It falls back
  // to the dark pole for anything it cannot parse, which would silently read as
  // "light surface" — so anything hexToRgb rejects (an alpha channel, an odd
  // digit count) has to stay '' here: a mark on an unknown surface is the
  // neutral one, never a guess.
  if (!hex || !hexToRgb(hex)) return '';
  return pickTextColorForBg(hex) === '#ffffff' ? 'dark' : 'light';
}

/**
 * The tone of the background colour a slide sits on, ignoring any background
 * image layered over it.
 *
 * Resolution order, most authoritative first:
 *  1. a theme background variant's own `textColor` — the theme author stated
 *     which pole its text takes, which is the same question inverted;
 *  2. the colour literal in that variant's `value`, or in the theme's
 *     `--t-slide-bg-<id>` var for the built-in `lime` / `mist` / `dark` slots.
 *     Reading the var rather than assuming matters: `midnight` paints `lime`
 *     near-black and `deckyard` paints it white.
 *
 * @param {object|null} content - slide content
 * @param {object|null} theme - the active normalized theme
 * @returns {'dark'|'light'|''} '' when nothing reliable is known
 */
export function resolveSlideBgTone(content, theme) {
  const id = String(content?.background || 'lime')
    .trim()
    .toLowerCase();
  if (!id) return '';

  const variants = Array.isArray(theme?.slideBackgrounds)
    ? theme.slideBackgrounds
    : [];
  const variant = variants.find((v) => v && v.id === id);
  if (variant) {
    if (variant.textColor) {
      const textTone = toneOfHex(variant.textColor);
      // The text pole is the opposite of the surface it sits on.
      if (textTone === 'light') return 'dark';
      if (textTone === 'dark') return 'light';
    }
    return toneOfHex(groundHexOf(variant.value));
  }

  // Built-in slots. `accent` / `brand-*` / `custom` are countdown-only classes
  // with no theme var of their own, so they fall through to ''.
  if (id !== 'lime' && id !== 'mist' && id !== 'dark') return '';
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : null;
  return toneOfHex(groundHexOf(vars?.[`--t-slide-bg-${id}`]));
}

/**
 * The tone of whatever a per-slide overlay would actually land on: the
 * background image when one is set and its contrast was resolved, otherwise the
 * background colour.
 *
 * A background image only answers the question when the author (or the
 * edit-time detector behind `slideBgText: 'auto'`) settled its text colour —
 * that choice is a statement about the photo's own luminance. An undecided
 * photo falls through to the colour underneath, which is the best remaining
 * signal.
 *
 * @param {object|null} content - slide content
 * @param {object|null} theme - the active normalized theme
 * @returns {'dark'|'light'|''} '' when nothing reliable is known
 */
export function resolveSlideSurfaceTone(content, theme) {
  const hasImage =
    typeof content?.slideBgImage === 'string' && content.slideBgImage.trim();
  if (hasImage) {
    const mode = content?.slideBgText;
    const resolved =
      mode === 'light' || mode === 'dark'
        ? mode
        : mode === 'auto'
          ? content?.slideBgTextAuto
          : '';
    // Light text means a dark photo, and vice versa.
    if (resolved === 'light') return 'dark';
    if (resolved === 'dark') return 'light';
  }
  return resolveSlideBgTone(content, theme);
}

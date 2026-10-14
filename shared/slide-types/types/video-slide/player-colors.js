/**
 * The Bunny player's colors come from the active theme (B648).
 *
 * `BUNNY_PLAYER_COLORS` in `shared/slide-types/helpers.js` used to hand the
 * embed URL three fixed hex values: one fork's brand palette, in code every
 * instance shares. So a Deckyard with its own theme played its videos in
 * CIIIC's colors, and the accent among them was the same stale value B640 took
 * out of the slide CSS. The two literals are deliberately not repeated here —
 * `tests/bunny-player-colors.test.js` allows them nowhere under `shared/`, and
 * an exception for a comment is an exception.
 *
 * A player is slide chrome, so it reads the theme like every other slide
 * color. Two tokens carry it:
 *
 * - **`--t-color-accent-on-dark`** for the play button and the controls. The
 *   player sits on the video, which is a dark ground by default, and that is
 *   the accent a theme draws for exactly that case. Its fallback is the plain
 *   accent.
 * - **`--t-color-accent`** for the player's own accent.
 *
 * **A theme that says nothing keeps Bunny's own default.** Bunny reads hex
 * without `#` and ignores anything else, so a token that is not a hex colour
 * (`rgba()`, `hsl()`, a `var()` chain) yields no parameter at all rather than
 * a guessed one. That is the one honest fallback here: core has no brand
 * colour of its own to put in its place.
 *
 * @module shared/slide-types/types/video-slide/player-colors
 */

import { hexToRgb } from '../../../color-utils.js';

/**
 * A theme value as Bunny wants it: six hex digits, no `#`.
 *
 * @param {*} raw - A CSS colour value from the theme.
 * @returns {string} The hex digits, or `''` when the value is not a hex colour.
 */
function playerHex(raw) {
  const rgb = hexToRgb(raw);
  if (!rgb) return '';
  return [rgb.r, rgb.g, rgb.b]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The player-colour query parameters for a Bunny embed under a theme.
 *
 * @param {{cssVars?: Object}|null} [theme] - The active theme, as `ctx.theme`
 *   carries it into `renderHtml`.
 * @returns {{primaryColor?: string, controlsColor?: string, accentColor?: string}}
 *   The parameters to append; empty when the theme names no usable colour.
 */
export function bunnyPlayerColors(theme) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const accent = playerHex(vars['--t-color-accent']);
  const onDark = playerHex(vars['--t-color-accent-on-dark']) || accent;

  const out = {};
  if (onDark) {
    out.primaryColor = onDark;
    out.controlsColor = onDark;
  }
  if (accent) out.accentColor = accent;
  return out;
}

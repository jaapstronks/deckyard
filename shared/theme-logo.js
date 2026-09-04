// Which of a theme's marks is actually visible on this slide?
//
// A single wordmark cannot serve both poles: a black mark disappears on a dark
// ground and a white one disappears on a light one. A theme may therefore ship
// a mark per pole (`assets.logoOnDark` / `assets.logoOnLight`, and the
// title-slide sizes `titleLogoOnDark` / `titleLogoOnLight`) next to the neutral
// `assets.logo`, which stays the fallback for every theme that ships one mark.
//
// The cascade cannot make this choice — an <img> `src` is not a CSS property —
// so it happens at render time, from `content` plus the active theme, and the
// same answer therefore holds in the editor preview, the export worker and the
// published artifact. Both places that draw a theme mark ask this module: the
// per-slide corner logo (shared/slide-types/presentation.js) and the title
// slide's own logo (shared/slide-types/types/title-slide.js).

import { resolveSlideSurfaceTone } from './slide-surface-tone.js';

const DEFAULT_LOGO = '/assets/images/logo.svg';

/**
 * The theme logo to draw on one slide.
 *
 * Visibility outranks size, which is the whole point of the pair: the title
 * slide takes its own per-tone mark, then the full-size mark for the same
 * surface, and only then the neutral marks (title size first). A mark at the
 * wrong size is a smaller loss than a mark nobody can see. A slide whose
 * surface cannot be resolved keeps the neutral mark — guessing wrong flips it
 * to the invisible variant, which is worse than not choosing.
 *
 * @param {object|null} theme - The active normalized theme
 * @param {object|null} content - Slide content (background, image, contrast)
 * @param {object} [options]
 * @param {boolean} [options.title] - Prefer the title-slide sizes
 * @returns {string} A logo URL, never empty
 */
export function resolveThemeLogo(theme, content, { title = false } = {}) {
  const assets =
    theme?.assets && typeof theme.assets === 'object' ? theme.assets : null;

  const tone = resolveSlideSurfaceTone(content, theme);
  const suffix = tone === 'dark' ? 'OnDark' : tone === 'light' ? 'OnLight' : '';

  const candidates = title
    ? [
        suffix && `titleLogo${suffix}`,
        suffix && `logo${suffix}`,
        'titleLogo',
        'logo',
      ]
    : [suffix && `logo${suffix}`, 'logo'];

  for (const key of candidates) {
    const url = key && assets?.[key];
    if (url) return String(url);
  }
  return DEFAULT_LOGO;
}

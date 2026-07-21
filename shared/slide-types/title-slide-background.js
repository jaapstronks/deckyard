/**
 * Title-slide background: single read/migrate authority.
 *
 * The title type historically carried its own `bgImage`/`bgAlt` pair, drawn as
 * a bespoke `<img class="slide-bg">` with a `.has-bg` readability treatment
 * (dark gradient + forced light text) and its own inspector picker. That is a
 * full-slide background — exactly what the generic, type-agnostic
 * `slideBgImage` layer (`injectSlideBackground` in presentation.js, with
 * fit/focus/overlay/auto-contrast) already provides for every type. Two
 * systems meant two "Background image" controls and two images at once.
 *
 * Canonical key is `slideBgImage`. `bgImage`/`bgAlt` become a read-only render
 * fallback for un-migrated decks (renderHtml stays pure and never mutates);
 * the editor folds them into `slideBgImage` on edit, mirroring the established
 * `ensureImageSlideImage` / `ensureImageTextImages` pattern. `bgAlt` is dropped
 * on migration: a full-slide title background is decorative (the `<h1>` carries
 * the meaning), so the generic `aria-hidden` layer is the correct treatment.
 */

/**
 * Single authority for the title-slide background resolution. renderHtml, the
 * migration and any tooling read through this so the surfaces cannot drift.
 *
 * Resolution: canonical `slideBgImage` wins → legacy `bgImage`/`bgAlt` (read
 * only, un-migrated decks) → none.
 *
 * @param {Object} content - slide content
 * @returns {{
 *   image: string,
 *   alt: string,
 *   source: 'canonical' | 'legacy' | 'none',
 * }}
 */
export function resolveTitleSlideBackground(content) {
  const canonical =
    typeof content?.slideBgImage === 'string' ? content.slideBgImage.trim() : '';
  if (canonical) {
    return { image: canonical, alt: '', source: 'canonical' };
  }
  const legacy =
    typeof content?.bgImage === 'string' ? content.bgImage.trim() : '';
  if (legacy) {
    const alt =
      typeof content?.bgAlt === 'string' ? content.bgAlt.trim() : '';
    return { image: legacy, alt, source: 'legacy' };
  }
  return { image: '', alt: '', source: 'none' };
}

/**
 * Editor-side migration (mutates content): fold a legacy `bgImage` into the
 * canonical `slideBgImage` and reproduce the old `.has-bg` look through the
 * generic controls — light text + a bottom gradient scrim — but only when
 * those are still unset, so an author's own choices are never overwritten.
 * `bgImage`/`bgAlt` are dropped. Idempotent and a no-op once migrated (or when
 * there was never a legacy background).
 *
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureTitleSlideBackground(content) {
  if (!content || typeof content !== 'object') return content;
  const legacy =
    typeof content.bgImage === 'string' ? content.bgImage.trim() : '';
  const hasBgKey = Object.prototype.hasOwnProperty.call(content, 'bgImage');
  const hasBgAltKey = Object.prototype.hasOwnProperty.call(content, 'bgAlt');
  // Nothing legacy to fold: leave everything (incl. a canonical bg) untouched.
  if (!legacy) {
    // Still clear any stray empty legacy keys so migrated decks stop carrying
    // them, but never touch a slide that never had them.
    if (hasBgKey) delete content.bgImage;
    if (hasBgAltKey) delete content.bgAlt;
    return content;
  }
  const canonical =
    typeof content.slideBgImage === 'string' ? content.slideBgImage.trim() : '';
  // Only adopt the legacy image when there is no canonical one (canonical wins,
  // matching resolveTitleSlideBackground); otherwise the legacy image is simply
  // dropped as the redundant duplicate it was.
  if (!canonical) {
    content.slideBgImage = legacy;
    // Reproduce the legacy readability treatment via the generic controls,
    // without clobbering an author's explicit choice.
    if (!content.slideBgText) content.slideBgText = 'light';
    if (!content.slideBgOverlay) content.slideBgOverlay = 'gradient-bottom';
  }
  delete content.bgImage;
  delete content.bgAlt;
  return content;
}

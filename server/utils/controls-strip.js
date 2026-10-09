/**
 * The controls strip (`ui=strip`, B268/D102): the stage on top, edge to edge,
 * and one toolbar below it with Previous, Next, the counter and Fullscreen.
 * The standalone export (server/export/html.js) and the hosted embed
 * (server/utils/embed-html/) each lay it out in their own shell, but read the
 * height and the icons from here, so the two strips cannot drift apart.
 *
 * A host page sizes the iframe as the 16:9 stage plus this height; that is
 * why it is one named custom property on `:root` and not a number repeated
 * in two shells.
 */

/** Height of the strip below the stage, as a CSS length. */
export const CONTROLS_STRIP_HEIGHT = '48px';

/**
 * The strip's shared CSS: the height property on `:root` and the icon box.
 * Each shell decides when the icon shows; this only sizes it.
 */
export const CONTROLS_STRIP_CSS = `
      /* ui=strip: the strip's height. A host page sizes its iframe as the
         16:9 stage plus this (B268). */
      :root {
        --controls-strip-height: ${CONTROLS_STRIP_HEIGHT};
      }
      .controls-strip-icon {
        width: 18px;
        height: 18px;
        flex: none;
      }
`;

/** Lucide paths (chevron-left, chevron-right, maximize), stroke-drawn. */
const ICON_PATHS = Object.freeze({
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  fullscreen:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
});

/**
 * An inline icon for a strip button. Decorative: the button carries the
 * accessible name in its `aria-label`.
 *
 * @param {'prev'|'next'|'fullscreen'} name
 * @returns {string} An `<svg>` element.
 */
export function controlsStripIcon(name) {
  const paths = ICON_PATHS[name];
  if (!paths) {
    throw new Error(
      `unknown strip icon "${name}" — one of ${Object.keys(ICON_PATHS).join('/')}`,
    );
  }
  return `<svg class="controls-strip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

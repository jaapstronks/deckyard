/**
 * Static renders suppress decorative gradients and use the solid surface's text
 * pair. Clearing both gradient tokens is essential: hiding only the background
 * leaves light gradient text on a potentially light surface.
 */
export const STATIC_GRADIENT_CSS = `.ps-theme {
  --t-gradient-enabled: 0;
  --t-slide-gradient-text: initial;
  --t-slide-gradient-text-muted: initial;
}`;

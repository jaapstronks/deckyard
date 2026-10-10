/**
 * Fork fixture D — a fork title slide that COMPOSES core's layout (D270).
 *
 * Loaded by the `test-fork` CI job (copied into `custom/slide-types/` before
 * `npm test`; see `.github/workflows/ci.yml`). It is the shape a fork takes
 * when it wants core's title layout with its own values: resolve core's view,
 * change values in it, render. It adds its own root class, its own logo and a
 * modifier on one of its own options, and it writes no core class name and no
 * markup: not one of core's title-layout classes appears in this file, which
 * `tests/title-slide-compose.test.js` checks.
 *
 * Before the seam, the only way to get this was to copy core's renderer and
 * keep the copy in step by hand (a real fork carried 501 lines of it). With
 * the copy gone, a renamed or removed view field breaks THIS file in core's own
 * fork lane, the day it happens, instead of in the fork after the next merge.
 *
 * It also takes core's inline-edit descriptor from the seam (`titleInlineEdit`)
 * instead of copying one whose anchors name core classes, and it asks for no
 * ground class (`view.background = null`) when its own background is
 * `transparent`, a ground nothing in the deck paints.
 *
 * The import is written for the file's runtime home, `custom/slide-types/`
 * (two levels below the repo root), and goes through the one stable address,
 * `shared/slide-types/core-layouts.js`, never into `types/`.
 */

/* eslint-disable import-x/no-unresolved -- written for custom/slide-types/, see above */
import {
  resolveTitleView,
  renderTitleView,
  titleInlineEdit,
} from '../../shared/slide-types/core-layouts.js';
/* eslint-enable import-x/no-unresolved */

/** The fork's own logo, in place of the theme's. */
const FORK_LOGO = '/custom/assets/fork-title-logo.svg';

export default {
  label: 'Fork Title',
  fidelity: { pptx: 'raster' },
  fields: [
    { key: 'title', type: 'string', label: 'Fork title' },
    { key: 'subheading', type: 'string', label: 'Fork subtitle' },
    { key: 'meta', type: 'string', label: 'Fork meta' },
    {
      key: 'frame',
      type: 'enum',
      label: 'Fork frame',
      options: ['open', 'panel'],
    },
  ],
  defaults: { title: '', subheading: '', meta: '', frame: 'open' },
  // Core's markup, so core's descriptor: its anchors are core's to keep.
  inline: titleInlineEdit,
  renderHtml: (content, slide, ctx) => {
    const view = resolveTitleView(content, slide, ctx);
    // `slide-fork-title` is this type's own root (what its custom/styles/
    // rules nest under); core's `slide-title` stays, which is what lends the
    // layout.
    view.classes.push('slide-fork-title');
    if (content?.frame === 'panel') view.classes.push('is-fork-panel');
    view.logo = { src: FORK_LOGO, alt: 'Fork' };
    // No ground of core's: the root carries no `slide-bg-*` class at all.
    if (content?.background === 'transparent') view.background = null;
    return renderTitleView(view);
  },
};

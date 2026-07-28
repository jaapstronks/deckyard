/**
 * logo-wall-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS } from '../../inline-edit-common.js';
import { ensureLogos } from '../logo-wall-slide.js';

/** @type {Object} InlineDescriptor for logo-wall-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // Dual-model (logos[] or legacy logo{n}*): canonicalize to logos[] on mount
    // so the media popover and card affordances always have a stable array.
    ensure: ensureLogos,
    // Clicking a logo (filled or empty placeholder) opens the media popover
    // (image + alt). Logo names render only as aria-labels, so name stays in
    // the form.
    media: {
      list: 'logos',
      photoSelector: '.logo-wall-img[data-inline-photo], .logo-wall-placeholder[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
    },
    // Add / remove / reorder logos entirely on the canvas (like gallery). The
    // empty wall renders one placeholder cell (edit-mode), so a first logo can
    // be added by clicking it or via "+ Add logo".
    cards: {
      field: 'logos',
      container: '.logo-wall-grid',
      itemSelector: '.logo-wall-item',
      addLabelKey: 'editor.inline.addLogo',
      addLabel: 'Add logo',
      removeLabelKey: 'editor.inline.removeLogo',
      removeLabel: 'Remove logo',
    },
    formText: ['title', 'subheading'],
  };

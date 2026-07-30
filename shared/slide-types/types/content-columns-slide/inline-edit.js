/**
 * content-columns-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';
import { resolveContentColumnImage, CONTENT_COLUMNS_IMAGE_DEFAULTS } from '../../content-columns-images.js';

/** @type {Object} InlineDescriptor for content-columns-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // Clicking a column image opens the media popover (image + alt) writing to
    // the flat col{n}Image / col{n}Alt fields (data-inline-photo carries the
    // 1-based column number). Empty columns render a clickable placeholder in
    // the editor canvas (mode 'edit' only), so a FIRST image can be added
    // in-slide too; column count / fit / focus / per-column block counts stay
    // in the form.
    media: {
      photoSelector: '.cc-image[data-inline-photo]',
      imageField: 'col{n}Image',
      altField: 'col{n}Alt',
    },
    // Focal point + Cover/Contain per column image. Flat numbered schema: the
    // {n} token is the 1-based column number (data-inline-photo), same as the
    // media fields. Focus only bites in cover mode. Effective fit comes from
    // resolveContentColumnImage (own value -> type default, step 4), the
    // single authority the render shares; the fallback marks the fit as
    // having a type default, so the shared card offers the empty
    // back-to-default option.
    focus: {
      xField: 'col{n}ImageFocusX',
      yField: 'col{n}ImageFocusY',
      cropMode: (slide, idx) => resolveContentColumnImage(slide?.content, idx).fit,
    },
    fit: {
      field: 'col{n}ImageFit',
      fallback: () => CONTENT_COLUMNS_IMAGE_DEFAULTS.fit,
    },
    formText: HEADER_TEXT,
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = ['columnCount'];

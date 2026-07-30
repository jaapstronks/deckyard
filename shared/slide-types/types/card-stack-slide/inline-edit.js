/**
 * card-stack-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS } from '../../inline-edit-common.js';
import { ensureCardStack } from '../card-stack-slide.js';

/** @type {Object} InlineDescriptor for card-stack-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // Dual-model (items[] or legacy cardCount + numbered card{n}*): canonicalize
    // to items[] on mount so the renderer emits items.N.* inline paths and
    // on-canvas title/body edits land on the array the form and projection read.
    ensure: ensureCardStack,
    // Card add/remove/reorder stays in the side form (deprecated type, no canvas
    // card chrome); the header text edits inline.
    formText: ['title', 'subheading'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * Card count is items[]-driven and managed by the side form's add/remove (like
 * icon-card-grid), so the raw cardCount enum is no longer an inspector control.
 * @type {string[]}
 */
export const inspectorKeeps = [];

/**
 * follow-invite-slide — inline-edit companion.
 *
 * This type has no on-canvas editing descriptor: everything it holds is edited
 * in the side form. What it does own is the inspector keep-list below, which is
 * an editing companion all the same — hence this file rather than a second slot
 * in `authoring.js`. Read by the inline-edit aggregator
 * (shared/slide-types/inline-edit.js) and, through it, by
 * client/views/editor/editor-form/inspector-form.js. Never imported by this
 * type's `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 */

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];

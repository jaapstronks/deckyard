/**
 * lead-capture-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for lead-capture-slide. */
export const inlineEdit = {
    ghosts: [
      { field: 'description', anchors: [{ sel: '.lead-capture-header', pos: 'append' }] },
    ],
    // Thank-you / privacy fields render only post-submit → stay in the form.
    formText: ['title', 'description', 'nameLabel', 'emailLabel', 'submitLabel'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * Thank-you state + privacy line are invisible on the canvas pre-submit —
 * config texts, were bulk-only (audit 2026-07-21).
 * @type {string[]}
 */
export const inspectorKeeps = ['thankYouTitle', 'thankYouMessage', 'privacyText', 'privacyUrl'];

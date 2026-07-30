/**
 * split-partner-title-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for split-partner-title-slide. */
export const inlineEdit = {
    ghosts: [
      { field: 'label', anchors: [{ sel: '.text', pos: 'prepend', chip: 'top-start' }] },
      { field: 'subheading', anchors: [{ sel: '.text .title', pos: 'after' }] },
    ],
    formText: ['label', 'title', 'subheading'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * Partner logos manager + per-logo alts + the split-specific bg image: none
 * had a canvas surface — were bulk-only (audit 2026-07-21).
 * @type {string[]}
 */
export const inspectorKeeps = [
  'logos',
  'logo1Alt',
  'logo2Alt',
  'logo3Alt',
  'logo4Alt',
  'logo5Alt',
  'bgImage',
  'bgAlt',
];

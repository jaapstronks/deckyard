/**
 * video-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for video-slide. */
export const inlineEdit = {
  ghosts: [
    {
      field: 'title',
      anchors: [{ sel: '.slide-inner', pos: 'prepend', chip: 'top-start' }],
    },
  ],
  formText: ['title'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `source` and `bunnyLibraryId` were misclassified as content at the phase-3
 * audit: a video URL/ID is a discrete input you cannot edit on the canvas (the
 * descriptor only inline-edits the title), so leaving them out orphaned them to
 * the bulk modal — a parity-invariant violation. They are inspector material
 * (editing-surfaces decision 2026-07-21). `watchUrl` is the same kind of field:
 * export configuration with no canvas surface.
 * @type {string[]}
 */
export const inspectorKeeps = [
  'source',
  'autoplay',
  'bunnyLibraryId',
  'watchUrl',
];

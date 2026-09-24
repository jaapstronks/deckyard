/**
 * Shared vocabulary for inline-edit descriptors.
 *
 * The descriptor grammar itself is documented in
 * client/views/editor/inline-edit/descriptors.js; these are the reusable data
 * fragments most types build their descriptor out of. They live here rather
 * than in that file because a per-type descriptor now lives in the type's own
 * directory (docs/reference/slide-type-directory.md), and a type companion
 * importing from `client/views/editor/` would invert the layering — and make
 * the aggregator and its own entries import each other in a circle.
 *
 * Pure data: no DOM, no imports.
 */

/**
 * The standard header pattern shared by most content/data-viz types: optional
 * `title` + `subheading` in a `.header` (or directly in `.slide-inner`) and an
 * optional `bottomSubheading` at the bottom. Renderers omit each element - and
 * the whole `.header` - when empty, hence the anchor fallbacks.
 */
export const HEADER_GHOSTS = [
  {
    field: 'title',
    anchors: [
      { sel: '.header', pos: 'prepend' },
      { sel: '.slide-inner', pos: 'prepend' },
    ],
  },
  {
    field: 'subheading',
    anchors: [
      { sel: '.heading', pos: 'after' },
      { sel: '.header', pos: 'append' },
      { sel: '.slide-inner', pos: 'prepend' },
    ],
  },
  {
    field: 'bottomSubheading',
    anchors: [{ sel: '.slide-inner', pos: 'append' }],
  },
];

/**
 * The header text trio shared by the header-pattern types. All three are plain
 * inline-editable strings everywhere they appear.
 */
export const HEADER_TEXT = ['title', 'subheading', 'bottomSubheading'];

/**
 * callout-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for callout-slide. */
export const inlineEdit = {
  ghosts: [
    // The renderer omits an empty source line, so the optional attribution
    // needs a ghost to be reachable on canvas at all. The eyebrow needs none:
    // it always renders, showing the per-variant fallback until someone types
    // over it.
    {
      field: 'source',
      anchor: '.callout-body',
      pos: 'after',
      chip: 'below-start',
    },
  ],
  formText: ['label', 'body', 'source'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `variant`: the kind is the type's whole semantics and has no canvas surface —
 * the icon and accent it drives are derived, never edited in place.
 * @type {string[]}
 */
export const inspectorKeeps = ['variant'];

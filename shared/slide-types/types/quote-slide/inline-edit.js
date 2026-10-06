/**
 * quote-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for quote-slide. */
export const inlineEdit = {
  // Every quote lives in quotes[] (D314); its text, name and role are inline
  // fields, its portraits the media below, so the bulk modal is never the
  // only way in. quotes stays out of formText: its items carry images.
  formText: [],
  // Add/remove/reorder whole quotes on the canvas. The add button anchors to
  // .slide-inner (present in the single-quote hero layout too), so "Add
  // quote" appears before a second quote exists. The hero layout draws no
  // .quote-item, so the one quote never gets a remove × (minItems 1).
  // Removing a quote splices it whole, byline and portraits included.
  cards: {
    field: 'quotes',
    container: '.slide-inner',
    itemSelector: '.quote-item',
    addLabelKey: 'editor.inline.addQuote',
    addLabel: 'Add quote',
    removeLabelKey: 'editor.inline.removeQuote',
    removeLabel: 'Remove quote',
  },
  // Two portrait slots per quote: data-inline-photo numbers them item-major
  // (portraitPhotoIndex), the popover writes authorImage{n} / authorImage{n}Alt
  // on that quote. The first empty slot of each quote draws a placeholder on
  // the canvas, so a first portrait is added in-slide as well.
  media: {
    list: 'quotes',
    slots: 2,
    photoSelector: '.quote-portrait[data-inline-photo]',
    imageField: 'authorImage{n}',
    altField: 'authorImage{n}Alt',
  },
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];

/**
 * The portraits: two slots on each of up to three quotes, photo indices 0-5
 * (item-major, see `media.slots`).
 * Grammar: shared/slide-types/inline-edit-companions.js.
 * @type {Object}
 */
export const elementTab = { image: { range: [0, 5] } };

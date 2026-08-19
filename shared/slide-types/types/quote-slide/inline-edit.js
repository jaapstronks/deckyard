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
  formText: ['quote', 'authorName', 'authorTitle'],
  // Add/remove whole extra quotes (2nd/3rd) on the canvas. Extra quotes live
  // in quotes[]; the primary quote stays in the flat top-level fields and is
  // NOT part of the array - its .quote-item carries no data-inline-item-index,
  // so insertCardLevel skips it and it never gets a remove ×. The add button
  // anchors to .slide-inner (present in both the single-quote hero layout and
  // the multi layout), so "Add quote" appears even before any extra exists
  // (quotes[] empty -> no .quote-item yet). Removing an item splices the whole
  // quote, including its byline and portrait. Reorder is disabled: the primary
  // can't move into the array, so a partial reorder would mislead.
  cards: {
    field: 'quotes',
    container: '.slide-inner',
    itemSelector: '.quote-item',
    reorder: false,
    addLabelKey: 'editor.inline.addQuote',
    addLabel: 'Add quote',
    removeLabelKey: 'editor.inline.removeQuote',
    removeLabel: 'Remove quote',
  },
  // Clicking a filled portrait opens the media popover writing to the flat
  // authorImage{n} / authorImage{n}Alt fields (data-inline-photo carries
  // the 1-based slot number). Empty slots render nothing - portraits are
  // fully optional, so a first portrait is added via the side form.
  media: {
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

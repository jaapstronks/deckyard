/**
 * end-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for end-slide. */
export const inlineEdit = {
    ghosts: [
      { field: 'body', anchors: [{ sel: '.heading', pos: 'after' }] },
      {
        field: 'contactName',
        anchors: [
          { sel: '.end-contact', pos: 'prepend' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
      {
        field: 'contactEmail',
        anchors: [
          { sel: '.end-contact', pos: 'append' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
      {
        field: 'contactPhone',
        anchors: [
          { sel: '.end-contact', pos: 'append' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
    ],
    // contactUrl / social links are URLs → stay in the form.
    formText: ['title', 'body', 'contactName', 'contactEmail', 'contactPhone'],
  };

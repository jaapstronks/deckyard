/**
 * team-cards-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';
import { ensureMembers } from '../team-cards-slide.js';

/** @type {Object} InlineDescriptor for team-cards-slide. */
export const inlineEdit = {
  ghosts: [
    ...HEADER_GHOSTS,
    {
      field: 'subheading2',
      anchors: [
        { sel: '.team-cards-group-right', pos: 'prepend', chip: 'top-start' },
      ],
    },
  ],
  // Dual-model (members[] or legacy card{n}*): canonicalize to members[] on
  // mount so a first block (and its photo) can be added on the canvas.
  ensure: ensureMembers,
  itemGhosts: [
    {
      list: 'members',
      field: 'name',
      item: '.team-card',
      pos: 'append',
      chip: 'top-start',
    },
    // Caption ghost sits directly under the title/text block (not over the
    // card bottom, which would land on the title text and the image outline).
    {
      list: 'members',
      field: 'byline',
      item: '.team-card',
      chipAnchor: '.team-card-text',
      pos: 'append',
      chip: 'below-start',
    },
  ],
  // ensureMembers guarantees members[] in edit mode, so no skipWhenEmpty
  // guard is needed - add/remove/reorder work from the first block.
  cards: {
    field: 'members',
    container: '.team-cards-grid',
    itemSelector: '.team-card',
    addLabelKey: 'editor.inline.addMember',
    addLabel: 'Add block',
    removeLabelKey: 'editor.inline.removeMember',
    removeLabel: 'Remove block',
  },
  // Clicking a card photo opens an in-slide media popover (image + alt +
  // LinkedIn), so slide-view users can set the whole block without the side form.
  media: {
    list: 'members',
    photoSelector: '.team-card-photo[data-inline-photo]',
    imageField: 'image',
    altField: 'alt',
    extraFields: [
      {
        key: 'linkedin',
        type: 'url',
        label: 'LinkedIn URL (optional)',
        i18nKey: 'editor.inline.media.linkedin',
      },
    ],
  },
  // Focal point per member photo. The photo only crops (and honours focus)
  // when the effective aspect is square - circle forces square; an 'original'
  // aspect shows the whole image, so the handle stays hidden there.
  focus: {
    xField: 'imageFocusX',
    yField: 'imageFocusY',
    cropMode: (slide) => {
      const shape = slide?.content?.imageShape;
      const aspect =
        shape === 'circle' ? 'square' : slide?.content?.imageAspect;
      return aspect === 'square' ? 'cover' : 'contain';
    },
  },
  // Member cards stay in the side form too: they carry focus points.
  formText: [...HEADER_TEXT, 'subheading2'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [
  'textPosition',
  'imageShape',
  'imageAspect',
  'showPhotoFrame',
  'columnSplit',
];

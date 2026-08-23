/**
 * icon-card-grid-slide — the editing companions.
 *
 * What the editor needs to let someone *change* a slide of this type: the
 * inline-edit descriptor (what is editable on the canvas, and how) and the
 * inspector keep-list (which fields the side form keeps when the canvas covers
 * the rest).
 *
 * Editing outlives deprecation, so this stays owed even by types the picker no
 * longer offers. Imported by the editor, never by `index.js` — see
 * docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';
import { ensureIconCards } from './cards.js';

/** @type {Object} InlineDescriptor for icon-card-grid-slide. */
export const inlineEdit = {
  ghosts: HEADER_GHOSTS,
  // Materialize items[] on mount so add/remove/reorder work from the canvas
  // like team-cards / logo-wall.
  ensure: ensureIconCards,
  cards: {
    field: 'items',
    container: '.icon-card-grid',
    itemSelector: '.icon-card:not(.is-empty)',
    addLabelKey: 'editor.inline.addCard',
    addLabel: 'Add card',
    removeLabelKey: 'editor.inline.removeCard',
    removeLabel: 'Remove card',
  },
  // Clicking a card's icon opens the icon-picker modal in-slide; the write
  // lands on the items.N.icon path the renderer emitted.
  icons: {
    selector: '.icon-card-icon[data-inline-icon]',
  },
  // Card editors stay in the form: they carry link + reorder controls.
  formText: HEADER_TEXT,
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide. Card count is items[]-driven and managed by the side
 * form's add/remove, so there is no count control here.
 * @type {string[]}
 */
export const inspectorKeeps = ['layout'];

/**
 * The card is this type's sub-element: one tab per item.
 * Grammar: shared/slide-types/inline-edit-companions.js.
 * @type {Object}
 */
export const elementTab = { card: { list: 'items' } };

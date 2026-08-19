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
import { ensureIconCards, syncIconCardsToNumbered } from './cards.js';

/** @type {Object} InlineDescriptor for icon-card-grid-slide. */
export const inlineEdit = {
  ghosts: HEADER_GHOSTS,
  // Dual-model (items[] or legacy cardCount + numbered card{n}*): canonicalize
  // to items[] on mount so add/remove/reorder work from the canvas like
  // team-cards / logo-wall. Without this, legacy decks stayed in numbered mode
  // (renderer emitted no data-inline-item-index) and cards were only editable
  // via the bulk modal.
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
  // Clicking a card's icon opens the icon-picker modal in-slide. The write
  // lands on whichever path the renderer emitted (items.N.icon or the
  // legacy card{i}Icon); in items-mode the numbered mirror is re-synced,
  // the same contract the side form and phase-3 inspector follow. The
  // items[] guard matters: syncing a legacy deck (no items[]) would wipe
  // its numbered fields.
  icons: {
    selector: '.icon-card-icon[data-inline-icon]',
    afterWrite: (slide) => {
      if (
        Array.isArray(slide?.content?.items) &&
        slide.content.items.length > 0
      ) {
        syncIconCardsToNumbered(slide);
      }
    },
  },
  // Card editors stay in the form: they carry link + reorder controls.
  formText: HEADER_TEXT,
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide. `cardCount` is deliberately absent: card count is
 * items[]-driven and managed by the side form's add/remove, so the raw enum is
 * no longer an inspector control.
 * @type {string[]}
 */
export const inspectorKeeps = ['layout'];

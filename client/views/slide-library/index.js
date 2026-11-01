/**
 * Slide library - the feature's public seam: the picker (editor modal,
 * new-deck flow, library page), an item's preview thumb (Home), composing
 * a deck from library items, and an item's thread with its maker (B906).
 */

export { createSlideLibraryPicker } from './picker.js';
export {
  copyLibraryItemToClipboard,
  createDeckFromLibraryItems,
  deckLangForLibraryItems,
} from './compose.js';
export { createLibraryThemeResolver, renderLibraryThumb } from './thumb.js';
export { openLibraryItemThread } from './item-thread.js';

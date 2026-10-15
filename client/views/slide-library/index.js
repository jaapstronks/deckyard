/**
 * Slide library - the feature's public seam: the picker (editor modal,
 * new-deck flow, library page), an item's preview thumb (Home), and composing
 * a deck from library items.
 */

export { createSlideLibraryPicker } from './picker.js';
export {
  copyLibraryItemToClipboard,
  createDeckFromLibraryItems,
  deckLangForLibraryItems,
} from './compose.js';
export { createLibraryThemeResolver, renderLibraryThumb } from './thumb.js';

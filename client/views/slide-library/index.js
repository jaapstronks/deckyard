/**
 * Slide library - the feature's public seam: the picker (editor modal,
 * new-deck flow, library page), composing a deck from library items, and the
 * sort/language helpers the editor's slide panels share.
 */

export { createSlideLibraryPicker } from './picker.js';
export {
  copyLibraryItemToClipboard,
  createDeckFromLibraryItems,
  deckLangForLibraryItems,
} from './compose.js';
export { contentLang, sortByPinnedThenName } from './search.js';

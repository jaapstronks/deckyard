/**
 * Slide library - the feature's public seam: the picker (editor modal,
 * new-deck flow, library page), an item's preview thumb (Home), composing a
 * deck from library items, and the sort/language helpers the editor's slide
 * panels share.
 */

export { createSlideLibraryPicker } from './picker.js';
export {
  copyLibraryItemToClipboard,
  createDeckFromLibraryItems,
  deckLangForLibraryItems,
} from './compose.js';
export { contentLang, sortByPinnedThenName } from './search.js';
export { createLibraryThemeResolver, renderLibraryThumb } from './thumb.js';

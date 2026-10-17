/**
 * Slide import - the feature's public seam: importing an existing deck as
 * image slides (B700, B306). The two-slot chooser (PDF for the images, the
 * PowerPoint file for the notes) and the streamed import behind it, shared by
 * the editor's "Import from file" tab and the creation view's "PowerPoint or
 * PDF" import sub-tab.
 */

export { createDeckImagesPicker } from './picker.js';
export { importDeckImages } from './stream.js';

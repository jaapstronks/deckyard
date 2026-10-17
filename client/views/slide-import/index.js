/**
 * Slide import - the feature's public seam: importing an existing deck as
 * image slides (B700, B306) or as editable slides (B753). The two-slot
 * chooser (the PDF for the pages, the PowerPoint file for the notes), the
 * streamed import behind it and the words for an editable import's report,
 * shared by the editor's "Import from file" tab and the creation view's
 * "PowerPoint or PDF" import sub-tab.
 */

export { createDeckFilesPicker } from './picker.js';
export { slidesImportOutcome } from './report.js';
export { importDeckFiles } from './stream.js';

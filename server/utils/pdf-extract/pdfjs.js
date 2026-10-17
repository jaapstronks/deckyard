/**
 * pdf.js for Node, configured once (B751).
 *
 * The server reads PDFs with the legacy build of `pdfjs-dist` (a hard
 * dependency, same version as the vendored browser build); the browser build
 * itself does not run in Node. The worker runs in-process ("fake worker"),
 * loaded from the same `legacy/build` folder. The data folders pdf.js reads
 * fonts, CMaps and its JPEG 2000 decoder from are resolved from the installed
 * package, never from the working directory, so the module works from any cwd.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  VerbosityLevel,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

const buildDir = path.dirname(
  fileURLToPath(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
);
const packageDir = path.resolve(buildDir, '..', '..');

GlobalWorkerOptions.workerSrc = import.meta
  .resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

/** pdf.js factory URLs in Node are file paths with a trailing separator. */
const dataDir = (name) => path.join(packageDir, name) + path.sep;

/**
 * Open a PDF from bytes. The bytes are copied: pdf.js may take ownership of
 * the array it is given, and the caller's buffer stays untouched.
 *
 * `isEvalSupported: false` keeps pdf.js from compiling font programs with
 * `new Function`; offscreen canvas and the image decoder are off, so image
 * pixels come back as plain arrays instead of bitmaps.
 *
 * @param {Uint8Array} bytes
 * @returns {import('pdfjs-dist').PDFDocumentLoadingTask}
 */
export function openPdf(bytes) {
  return getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    standardFontDataUrl: dataDir('standard_fonts'),
    cMapUrl: dataDir('cmaps'),
    cMapPacked: true,
    wasmUrl: dataDir('wasm'),
    verbosity: VerbosityLevel.ERRORS,
  });
}

export { OPS };

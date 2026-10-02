/**
 * Response headers an export sends beside the file, shared by the server that
 * writes them and the editor that reads them.
 *
 * A header rather than a body field because the body is the file.
 */

/**
 * The slides an editable PPTX wrote as an image, as 1-based numbers separated
 * by commas (`3,7`). Absent when every slide is editable. The editor's export
 * menu reads it to say which slides became pictures; the v1 route sends it
 * too, so an API client learns the same thing.
 */
export const IMAGE_SLIDES_HEADER = 'X-Image-Slides';

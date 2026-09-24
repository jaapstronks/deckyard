/**
 * The image formats an upload to the image library may carry.
 *
 * One declaration for a fact that was spelled twice and drifted: the policy
 * allowlist in `server/storage/uploads.js` accepts five formats, while the
 * dropzone hint beside it named three and the file picker offered any image at
 * all (B366). The server stays the authority — it still refuses on the MIME
 * type — but the tables it refuses from, and the strings the user reads, are
 * now derived from this one list rather than re-typed next to it.
 *
 * Deliberately image-only, and deliberately narrower than `LocalProvider`'s
 * MIME table: fonts and other provider-supported types are not offered here.
 */

/**
 * Accepted image uploads, in the order the hint names them.
 *
 * `label` is the format's name as it is written in every language. `exts`
 * lists the file extensions that spell it, the first being canonical. `mime`
 * is the one content type the server accepts for it: a format has one
 * registered type, so a second spelling (the unregistered image/jpg, B403)
 * has no place to go.
 *
 * @type {ReadonlyArray<{label: string, exts: string[], mime: string}>}
 */
export const IMAGE_UPLOAD_FORMATS = Object.freeze([
  { label: 'PNG', exts: ['png'], mime: 'image/png' },
  { label: 'JPG', exts: ['jpg', 'jpeg'], mime: 'image/jpeg' },
  { label: 'GIF', exts: ['gif'], mime: 'image/gif' },
  { label: 'WebP', exts: ['webp'], mime: 'image/webp' },
  { label: 'SVG', exts: ['svg'], mime: 'image/svg+xml' },
]);

/**
 * Every accepted content type, mapped to the canonical extension it is saved
 * under.
 * @type {Readonly<Record<string, string>>}
 */
export const IMAGE_UPLOAD_MIME_TO_EXT = Object.freeze(
  Object.fromEntries(IMAGE_UPLOAD_FORMATS.map((f) => [f.mime, f.exts[0]])),
);

/**
 * Every accepted extension, mapped to the content type that carries it.
 * @type {Readonly<Record<string, string>>}
 */
export const IMAGE_UPLOAD_EXT_TO_MIME = Object.freeze(
  Object.fromEntries(
    IMAGE_UPLOAD_FORMATS.flatMap((f) => f.exts.map((e) => [e, f.mime])),
  ),
);

/**
 * The format names, as the dropzone hint lists them: `PNG, JPG, GIF, WebP, SVG`.
 * @returns {string}
 */
export function imageUploadFormatList() {
  return IMAGE_UPLOAD_FORMATS.map((f) => f.label).join(', ');
}

/**
 * The value for a file input's `accept`, so the picker offers exactly what the
 * server takes — no wider (an AVIF the user could choose and the server would
 * refuse) and no narrower.
 * @returns {string}
 */
export function imageUploadAccept() {
  return IMAGE_UPLOAD_FORMATS.flatMap((f) => [
    f.mime,
    ...f.exts.map((e) => `.${e}`),
  ]).join(',');
}

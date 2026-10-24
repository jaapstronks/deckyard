/**
 * The renderer-bundle manifest: one canonical byte string, one hash.
 *
 * A render bundle is identified by the SHA-256 of its manifest bytes, and the
 * manifest names every file in the bundle by content hash. So the identity is
 * the content: two builds of the same renderer sources give the same hash, and
 * one changed byte anywhere gives a different one. Release version, commit and
 * build time are *provenance*, not identity - they live in `provenance.json`
 * beside the manifest and are deliberately outside the hash, because a bundle
 * rebuilt from the same sources on another day is the same renderer.
 *
 * **Serialisation is defined here and nowhere else.** The canonical form is
 * minified JSON with a declared key order, file entries sorted by path, and a
 * single trailing newline. Hashing an arbitrary `JSON.stringify` of an object
 * assembled by some other caller is what makes two honest implementations
 * disagree about the same bundle, so every writer and every reader goes through
 * `canonicalManifestBytes()`. `tests/renderer-bundle-manifest.test.js` holds
 * the test vectors.
 *
 * Integrity spelling is the one the `.deck` bundle already uses: SHA-256 hex
 * per file, with the SRI form (`sha256-<base64>`) available from the same
 * digest. No second integrity vocabulary (AGENTS.md § Safety).
 */

import { createHash } from 'node:crypto';

/** The only manifest schema this build writes and reads. */
export const RENDERER_BUNDLE_SCHEMA = 'deckyard.renderer-bundle/1';

/** SHA-256 hex of a buffer or string. */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SRI-shaped integrity id (`sha256-<base64>`) from a hex digest. */
export function sriFromSha256Hex(hex) {
  return `sha256-${Buffer.from(hex, 'hex').toString('base64')}`;
}

/**
 * A capability edge the closure scan found: an import that could reach outside
 * the bundle. Recorded in the manifest so the refusal that rejected a bundle at
 * build time is readable afterwards, and so a reader can see that a bundle
 * which *was* accepted carries an unsealed edge (today: the sanitizer's
 * `jsdom`/`dompurify`, reachable only through a call this renderer never makes).
 *
 * @typedef {Object} CapabilityEdge
 * @property {string} specifier - The imported specifier
 * @property {string} importer - Bundle-relative path of the importing module
 * @property {'static'|'dynamic'} kind - How it is imported
 */

/**
 * @typedef {Object} RendererBundleManifest
 * @property {string} schema
 * @property {string} entry - Bundle-relative path of the render entry
 * @property {string} worker - Bundle-relative path of the worker entry
 * @property {Array<{path: string, sha256: string, bytes: number}>} files
 * @property {CapabilityEdge[]} unsealed - Accepted-but-unsealed import edges
 */

/** Order a file entry's keys are written in. */
function canonicalFile(file) {
  return { path: file.path, sha256: file.sha256, bytes: file.bytes };
}

/** Order a capability edge's keys are written in. */
function canonicalEdge(edge) {
  return {
    specifier: edge.specifier,
    importer: edge.importer,
    kind: edge.kind,
  };
}

/**
 * The canonical bytes of a manifest.
 *
 * @param {RendererBundleManifest} manifest
 * @returns {Buffer} UTF-8 bytes, newline-terminated
 */
export function canonicalManifestBytes(manifest) {
  const files = [...(manifest.files || [])]
    .map(canonicalFile)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.path))
      throw new Error(`renderer bundle manifest: duplicate path ${f.path}`);
    seen.add(f.path);
  }
  const unsealed = [...(manifest.unsealed || [])]
    .map(canonicalEdge)
    .sort((a, b) =>
      `${a.importer} ${a.specifier} ${a.kind}` <
      `${b.importer} ${b.specifier} ${b.kind}`
        ? -1
        : 1,
    );
  const ordered = {
    schema: manifest.schema || RENDERER_BUNDLE_SCHEMA,
    entry: manifest.entry,
    worker: manifest.worker,
    files,
    unsealed,
  };
  return Buffer.from(`${JSON.stringify(ordered)}\n`, 'utf8');
}

/**
 * The bundle's identity: SHA-256 of its canonical manifest bytes.
 *
 * @param {RendererBundleManifest} manifest
 * @returns {{rendererHash: string, bytes: Buffer}}
 */
export function rendererHashFor(manifest) {
  const bytes = canonicalManifestBytes(manifest);
  return { rendererHash: sha256Hex(bytes), bytes };
}

/** A 64-char lowercase hex digest, which is the only shape a hash may have. */
export function isRendererHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * The edition-input manifest: canonical bytes, one hash, and an offline check.
 *
 * An edition input (`./edition-input.js`) is stored as **bytes**, not as an
 * object that gets stringified again later: two honest serialisations of the
 * same object can differ, and a hash over "whatever `JSON.stringify` gave this
 * caller" is how two implementations end up disagreeing about one edition. So
 * the serialisation is defined here and nowhere else, the way
 * `./manifest.js` defines it for render bundles: object keys sorted by code
 * point at every depth, no whitespace, a single trailing newline.
 *
 * The manifest is *derived* from the input bytes and nothing else. It names
 * the input by hash and length, and hashes its three renderbepalende parts
 * (public deck, effective theme, frozen font CSS) separately, so a later
 * edition can say which of them changed. The asset inventory lists every
 * inline data URL by content hash, media type and length: the closed asset set
 * the brief asks for, readable without decoding the input.
 *
 * Integrity only. A matching hash proves equality with the bytes received; it
 * does not prove who made them or when (`docs/plans/briefs/publication-records.md`
 * § Wat het manifest bevriest). Series id, version, publication time and the
 * renderer hash belong to the edition record that wraps this manifest (T1.3).
 *
 * Pure apart from `node:crypto`, so the offline verifier can run it on a
 * downloaded package with no installation behind it.
 */

import { sha256Hex } from './manifest.js';
import { EDITION_INPUT_SCHEMA } from './edition-input.js';

/** The only manifest schema this build writes and reads. */
export const EDITION_MANIFEST_SCHEMA = 'deckyard.edition-input-manifest/1';

/** The public projection the input was made with. */
const EDITION_PROJECTION = 'published/1';

/**
 * The checks an input passed before it was sealed, by name and version. A
 * check whose rule changes gets a new version, so an old manifest keeps saying
 * what was checked on its day (D21: a named, versioned checklist, no boolean).
 */
const EDITION_INPUT_CHECKS = Object.freeze([
  'public-projection/1',
  'metadata-allowlist/1',
  'sealable-slides/1',
  'closed-assets/1',
  'no-remote-loads/1',
  'no-external-fonts/1',
]);

/**
 * Canonical JSON text of a JSON value: sorted keys, no whitespace.
 *
 * Refuses what JSON cannot say faithfully (non-finite numbers, functions,
 * `undefined` inside arrays) instead of letting `JSON.stringify` turn it into
 * `null` or drop it: a value that does not survive a round trip has no
 * canonical form. `undefined` object members are left out, as JSON does.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => {
        if (v === undefined) {
          throw new TypeError('canonicalJson: undefined array member');
        }
        return canonicalJson(v);
      })
      .join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  throw new TypeError(`canonicalJson: cannot serialise ${typeof value}`);
}

/**
 * Canonical bytes of a JSON value: {@link canonicalJson} plus one newline.
 * @param {unknown} value
 * @returns {Buffer}
 */
export function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
}

/** `url(data:…)` inside CSS text, quoted or not. */
const CSS_DATA_URL = /url\(\s*(['"]?)(data:[^'")\s]+)\1\s*\)/gi;

/** Every data URL a string carries: itself, or the `url()`s inside it. */
function dataUrlsIn(text) {
  if (text.startsWith('data:')) return [text];
  if (!text.includes('data:')) return [];
  return [...text.matchAll(CSS_DATA_URL)].map((m) => m[2]);
}

/** Visit every string in a JSON value. */
function walkStrings(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, visit);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) walkStrings(v, visit);
}

/**
 * Decode one data URL into its media type and bytes, or null when it is not a
 * well-formed one.
 * @param {string} url
 * @returns {{mediaType: string, bytes: Buffer}|null}
 */
function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  const parts = meta.split(';');
  const base64 = parts.at(-1) === 'base64';
  const mediaType = (parts[0] || 'text/plain').toLowerCase();
  try {
    const bytes = base64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { mediaType, bytes };
  } catch {
    return null;
  }
}

/**
 * The closed asset set of an input: every inline data URL in the deck, the
 * theme and the font CSS, by content hash, deduplicated and sorted.
 *
 * @param {object} input - A parsed edition input
 * @returns {Array<{sha256: string, mediaType: string, bytes: number}>}
 */
function editionAssetInventory(input) {
  const byKey = new Map();
  walkStrings(
    [input?.presentation, input?.theme, input?.css?.fontCss],
    (text) => {
      for (const url of dataUrlsIn(text)) {
        const decoded = decodeDataUrl(url);
        if (!decoded) continue;
        const sha256 = sha256Hex(decoded.bytes);
        byKey.set(`${sha256} ${decoded.mediaType}`, {
          sha256,
          mediaType: decoded.mediaType,
          bytes: decoded.bytes.length,
        });
      }
    },
  );
  return [...byKey.keys()].sort().map((key) => byKey.get(key));
}

/**
 * The manifest of one edition input, derived from its canonical bytes.
 *
 * @param {Buffer} inputBytes - {@link canonicalJsonBytes} of the input
 * @returns {object}
 */
export function buildEditionManifest(inputBytes) {
  const input = JSON.parse(inputBytes.toString('utf8'));
  const part = (value) => ({
    sha256: sha256Hex(canonicalJsonBytes(value ?? null)),
  });
  return {
    schema: EDITION_MANIFEST_SCHEMA,
    input: {
      schema: input.schema,
      sha256: sha256Hex(inputBytes),
      bytes: inputBytes.length,
    },
    content: part(input.presentation),
    theme: part(input.theme),
    fontCss: part(input.css?.fontCss ?? ''),
    assets: editionAssetInventory(input),
    projection: EDITION_PROJECTION,
    checks: [...EDITION_INPUT_CHECKS],
  };
}

/**
 * Check an edition package offline: manifest bytes and input bytes, nothing
 * from an installation.
 *
 * Every problem is named separately, so a reader can tell a corrupt input
 * (`input_hash_mismatch`) from a manifest that was edited by hand
 * (`manifest_mismatch`) or one written by another serialiser
 * (`manifest_not_canonical`).
 *
 * @param {{manifestBytes: Buffer, inputBytes: Buffer}} pkg
 * @returns {{ok: boolean, problems: Array<{code: string, message: string}>}}
 */
export function verifyEditionInput({ manifestBytes, inputBytes }) {
  const problems = [];
  const fail = (code, message) => {
    problems.push({ code, message });
    return { ok: false, problems };
  };

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    return fail('manifest_unreadable', 'the manifest is not JSON');
  }
  if (manifest?.schema !== EDITION_MANIFEST_SCHEMA) {
    return fail(
      'manifest_schema',
      `manifest declares ${JSON.stringify(manifest?.schema)}, expected ${EDITION_MANIFEST_SCHEMA}`,
    );
  }
  if (!canonicalJsonBytes(manifest).equals(manifestBytes)) {
    problems.push({
      code: 'manifest_not_canonical',
      message: 'the manifest bytes are not in canonical form',
    });
  }

  if (
    manifest.input?.sha256 !== sha256Hex(inputBytes) ||
    manifest.input?.bytes !== inputBytes.length
  ) {
    return fail(
      'input_hash_mismatch',
      'the input bytes do not match the hash and length the manifest names',
    );
  }

  let input;
  try {
    input = JSON.parse(inputBytes.toString('utf8'));
  } catch {
    return fail('input_unreadable', 'the input is not JSON');
  }
  if (input?.schema !== EDITION_INPUT_SCHEMA) {
    problems.push({
      code: 'input_schema',
      message: `input declares ${JSON.stringify(input?.schema)}, expected ${EDITION_INPUT_SCHEMA}`,
    });
  }
  if (!canonicalJsonBytes(input).equals(inputBytes)) {
    problems.push({
      code: 'input_not_canonical',
      message: 'the input bytes are not in canonical form',
    });
  }

  const expected = buildEditionManifest(inputBytes);
  const keys = new Set([...Object.keys(expected), ...Object.keys(manifest)]);
  for (const key of [...keys].sort()) {
    if (
      canonicalJson(expected[key] ?? null) !==
      canonicalJson(manifest[key] ?? null)
    ) {
      problems.push({
        code: 'manifest_mismatch',
        message: `manifest field "${key}" does not match the input`,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

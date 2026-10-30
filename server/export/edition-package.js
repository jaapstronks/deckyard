/**
 * The downloadable verification package of one edition, and its offline
 * verifier (T1.4).
 *
 * A package is a zip with three files:
 *
 *   - `edition.json` - the edition record: series, version, publication time,
 *     renderer hash, manifest hash and the manifest hash of the version
 *     before it, in canonical JSON.
 *   - `manifest.json` - the edition-input manifest, byte for byte as stored.
 *   - `input.json` - the edition input, byte for byte as stored, except that
 *     every font face in `css.fontCss` is replaced by a reference to its hash
 *     (`deckyard-withheld:<media type>;sha256,<hex>`). Fonts are licensed
 *     bytes; a package anyone can download carries their hash, not the font
 *     (D367). The edition itself keeps the font bytes.
 *
 * {@link verifyEditionPackages} reads one or more packages with nothing but
 * this module and `node:crypto`, and reports three things separately: whether
 * the bytes are what the manifest names, what it could not check because a
 * font was withheld, and whether the series chain between the packages is
 * complete. Supplying the font files (by content) restores the full input and
 * makes the input hash itself checkable.
 *
 * Integrity only: a hash proves the bytes are the ones the record names, not
 * who published them or when (`docs/reference/publication-editions.md`).
 */

import JSZip from 'jszip';

import {
  EDITION_MANIFEST_SCHEMA,
  buildEditionManifest,
  canonicalJsonBytes,
  sha256Hex,
  verifyEditionInput,
} from '../render/renderer-bundle/index.js';

/** The schema of `edition.json`. */
export const EDITION_RECORD_SCHEMA = 'deckyard.edition-record/1';

const RECORD_NAME = 'edition.json';
const MANIFEST_NAME = 'manifest.json';
const INPUT_NAME = 'input.json';

/** A base64 data URL inside CSS text. */
const DATA_URL = /data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)/gi;
/** The reference a withheld font face leaves behind. */
const WITHHELD = /deckyard-withheld:([A-Za-z0-9.+/-]+);sha256,([0-9a-f]{64})/g;

/**
 * The edition record a package carries, in canonical form.
 *
 * @param {import('../storage/editions.js').PublicEdition} edition
 * @returns {Buffer}
 */
export function editionRecordBytes(edition) {
  return canonicalJsonBytes({
    schema: EDITION_RECORD_SCHEMA,
    publicationId: edition.publicationId,
    version: edition.version,
    publishedAt: edition.publishedAt,
    rendererHash: edition.rendererHash,
    manifestHash: edition.manifestHash,
    previousManifestHash: edition.previousManifestHash ?? null,
  });
}

/**
 * The input bytes with every font face replaced by its hash reference.
 *
 * Only `css.fontCss` is touched: images in the deck and theme are what every
 * reader of the edition already receives. The replacement is exact and
 * reversible, so {@link verifyEditionPackages} can rebuild the stored bytes
 * from the package and the font files.
 *
 * @param {Buffer} inputBytes - Canonical edition-input bytes
 * @returns {{bytes: Buffer, withheld: Array<{sha256: string, mediaType: string}>}}
 */
export function withholdFonts(inputBytes) {
  const input = JSON.parse(inputBytes.toString('utf8'));
  const fontCss = input?.css?.fontCss;
  if (typeof fontCss !== 'string' || !fontCss.includes('data:')) {
    return { bytes: inputBytes, withheld: [] };
  }
  const withheld = new Map();
  const replaced = fontCss.replace(DATA_URL, (whole, mediaType, payload) => {
    const bytes = Buffer.from(payload, 'base64');
    // The preparer wrote Node's own base64, so it round-trips; anything else
    // could not be rebuilt from the font file and must not be shipped.
    if (bytes.toString('base64') !== payload) {
      throw new Error(
        'edition-package: a font data URL is not canonical base64',
      );
    }
    const sha256 = sha256Hex(bytes);
    // Verbatim, never normalized: the rebuild writes back exactly this text.
    withheld.set(`${sha256} ${mediaType}`, { sha256, mediaType });
    return `deckyard-withheld:${mediaType};sha256,${sha256}`;
  });
  return {
    bytes: canonicalJsonBytes({
      ...input,
      css: { ...input.css, fontCss: replaced },
    }),
    withheld: [...withheld.keys()].sort().map((k) => withheld.get(k)),
  };
}

/**
 * Build the verification package of one edition.
 *
 * @param {import('../storage/editions.js').PublicEdition} edition - With its
 *   bytes (`getPublicEdition(…, {withBytes: true})`)
 * @returns {Promise<Buffer>} The zip
 */
export async function buildEditionPackage(edition) {
  if (!edition?.inputBytes || !edition?.manifestBytes) {
    throw new TypeError('buildEditionPackage: the edition bytes are required');
  }
  const zip = new JSZip();
  // A fixed date keeps two downloads of one edition byte-identical.
  const date = new Date(edition.publishedAt);
  zip.file(RECORD_NAME, editionRecordBytes(edition), { date });
  zip.file(MANIFEST_NAME, edition.manifestBytes, { date });
  zip.file(INPUT_NAME, withholdFonts(edition.inputBytes).bytes, { date });
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'UNIX',
  });
}

/**
 * Read the three files of a package.
 *
 * @param {Buffer} zipBytes
 * @returns {Promise<{recordBytes: Buffer|null, manifestBytes: Buffer|null, inputBytes: Buffer|null}>}
 */
export async function readEditionPackage(zipBytes) {
  const zip = await JSZip.loadAsync(zipBytes);
  const read = async (name) => {
    const file = zip.file(name);
    return file ? Buffer.from(await file.async('uint8array')) : null;
  };
  return {
    recordBytes: await read(RECORD_NAME),
    manifestBytes: await read(MANIFEST_NAME),
    inputBytes: await read(INPUT_NAME),
  };
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Verify the bytes of one package.
 *
 * @param {{recordBytes: Buffer|null, manifestBytes: Buffer|null, inputBytes: Buffer|null}} pkg
 * @param {Map<string, Buffer>} fonts - Font files by sha256
 * @returns {{record: object|null, problems: Array<{code: string, message: string}>, withheld: Array<{sha256: string, mediaType: string, bytes: number}>, inputHashChecked: boolean}}
 */
function verifyOne(pkg, fonts) {
  const problems = [];
  const fail = (code, message) => problems.push({ code, message });
  const out = { record: null, problems, withheld: [], inputHashChecked: false };

  for (const [key, name] of [
    ['recordBytes', RECORD_NAME],
    ['manifestBytes', MANIFEST_NAME],
    ['inputBytes', INPUT_NAME],
  ]) {
    if (!pkg?.[key]) fail('package_incomplete', `the package has no ${name}`);
  }
  if (problems.length) return out;

  const record = parseJson(pkg.recordBytes);
  if (record?.schema !== EDITION_RECORD_SCHEMA) {
    fail('record_schema', `${RECORD_NAME} is not a ${EDITION_RECORD_SCHEMA}`);
    return out;
  }
  out.record = record;
  if (!canonicalJsonBytes(record).equals(pkg.recordBytes)) {
    fail('record_not_canonical', `${RECORD_NAME} is not in canonical form`);
  }
  if (record.manifestHash !== sha256Hex(pkg.manifestBytes)) {
    fail(
      'manifest_hash_mismatch',
      'the manifest bytes do not match the hash the edition record names',
    );
  }

  const manifest = parseJson(pkg.manifestBytes);
  if (manifest?.schema !== EDITION_MANIFEST_SCHEMA) {
    fail(
      'manifest_schema',
      `${MANIFEST_NAME} is not a ${EDITION_MANIFEST_SCHEMA}`,
    );
    return out;
  }
  const input = parseJson(pkg.inputBytes);
  if (!input || typeof input !== 'object') {
    fail('input_unreadable', `${INPUT_NAME} is not JSON`);
    return out;
  }

  // Rebuild the stored input from the fonts that were supplied.
  const fontCss =
    typeof input.css?.fontCss === 'string' ? input.css.fontCss : '';
  const missing = new Map();
  const rebuiltCss = fontCss.replace(WITHHELD, (whole, mediaType, sha256) => {
    const bytes = fonts.get(sha256);
    if (!bytes) {
      const known = (manifest.assets || []).find((a) => a.sha256 === sha256);
      missing.set(sha256, {
        sha256,
        mediaType,
        bytes: known ? known.bytes : null,
      });
      return whole;
    }
    return `data:${mediaType};base64,${bytes.toString('base64')}`;
  });

  if (missing.size === 0) {
    // Every byte is here: the stored-input check applies unchanged.
    const inputBytes =
      rebuiltCss === fontCss
        ? pkg.inputBytes
        : canonicalJsonBytes({
            ...input,
            css: { ...input.css, fontCss: rebuiltCss },
          });
    const full = verifyEditionInput({
      manifestBytes: pkg.manifestBytes,
      inputBytes,
    });
    problems.push(...full.problems);
    out.inputHashChecked = true;
    return out;
  }

  // Fonts withheld: check every part the manifest hashes on its own, and the
  // asset inventory, and say what is left unchecked.
  out.withheld = [...missing.values()].sort((a, b) =>
    a.sha256.localeCompare(b.sha256),
  );
  if (!canonicalJsonBytes(manifest).equals(pkg.manifestBytes)) {
    fail(
      'manifest_not_canonical',
      'the manifest bytes are not in canonical form',
    );
  }
  if (!canonicalJsonBytes(input).equals(pkg.inputBytes)) {
    fail('input_not_canonical', `${INPUT_NAME} is not in canonical form`);
  }
  if (input.schema !== manifest.input?.schema) {
    fail('input_schema', 'the input schema differs from the manifest');
  }
  const partHash = (value) => sha256Hex(canonicalJsonBytes(value ?? null));
  if (partHash(input.presentation) !== manifest.content?.sha256) {
    fail('content_hash_mismatch', 'the deck does not match the manifest');
  }
  if (partHash(input.theme) !== manifest.theme?.sha256) {
    fail('theme_hash_mismatch', 'the theme does not match the manifest');
  }
  const assetKey = (a) => `${a.sha256} ${a.mediaType}`;
  const expected = new Set((manifest.assets || []).map(assetKey));
  const present = new Set(
    buildEditionManifest(pkg.inputBytes).assets.map(assetKey),
  );
  for (const w of [...fontCss.matchAll(WITHHELD)]) {
    const key = `${w[2]} ${w[1]}`;
    if (!expected.has(key)) {
      fail('asset_mismatch', `withheld font ${w[2]} is not in the manifest`);
    }
    present.add(key);
  }
  for (const key of present) {
    if (!expected.has(key)) {
      fail(
        'asset_mismatch',
        `asset ${key.split(' ')[0]} is not in the manifest`,
      );
    }
  }
  for (const key of expected) {
    if (!present.has(key)) {
      fail(
        'asset_mismatch',
        `manifest asset ${key.split(' ')[0]} is not in the input`,
      );
    }
  }
  return out;
}

/**
 * Verify one or more packages offline.
 *
 * @param {Array<{name?: string, recordBytes: Buffer|null, manifestBytes: Buffer|null, inputBytes: Buffer|null}>} packages
 * @param {{fonts?: Buffer[]}} [options] - Font files, matched by content hash
 * @returns {{
 *   ok: boolean,
 *   packages: Array<{name: string|null, version: number|null, valid: boolean, inputHashChecked: boolean, problems: Array<{code: string, message: string}>, withheld: Array<{sha256: string, mediaType: string, bytes: number|null}>}>,
 *   chain: {complete: boolean, missing: Array<{version: number, manifestHash: string}>, mismatched: Array<{version: number, message: string}>}
 * }}
 *   `ok` means every package's bytes verified and the chain between them has
 *   no gap or mismatch. A withheld font is reported, not counted as a failure:
 *   it is what D367 asks for.
 */
export function verifyEditionPackages(packages, { fonts = [] } = {}) {
  const fontsByHash = new Map(fonts.map((buf) => [sha256Hex(buf), buf]));
  const results = packages.map((pkg) => {
    const r = verifyOne(pkg, fontsByHash);
    return {
      name: pkg.name ?? null,
      version: Number.isInteger(r.record?.version) ? r.record.version : null,
      record: r.record,
      valid: r.problems.length === 0,
      inputHashChecked: r.inputHashChecked,
      problems: r.problems,
      withheld: r.withheld,
    };
  });

  // The chain: each record names its predecessor's manifest hash. A package
  // set proves only the links it contains; an absent predecessor is missing
  // evidence, a different one is a mismatch.
  const chain = { complete: true, missing: [], mismatched: [] };
  const records = results.map((r) => r.record).filter(Boolean);
  const series = new Set(records.map((r) => r.publicationId));
  if (series.size > 1) {
    chain.complete = false;
    chain.mismatched.push({
      version: null,
      message: 'the packages belong to different publications',
    });
  }
  const byVersion = new Map(records.map((r) => [r.version, r]));
  for (const record of [...byVersion.values()].sort(
    (a, b) => a.version - b.version,
  )) {
    if (record.version === 1) {
      if (record.previousManifestHash !== null) {
        chain.complete = false;
        chain.mismatched.push({
          version: 1,
          message: 'version 1 names a predecessor',
        });
      }
      continue;
    }
    const prev = byVersion.get(record.version - 1);
    if (!prev) {
      chain.complete = false;
      chain.missing.push({
        version: record.version - 1,
        manifestHash: record.previousManifestHash,
      });
    } else if (prev.manifestHash !== record.previousManifestHash) {
      chain.complete = false;
      chain.mismatched.push({
        version: record.version,
        message: `version ${record.version} names a predecessor manifest ${record.previousManifestHash}, but version ${prev.version} has ${prev.manifestHash}`,
      });
    }
  }

  return {
    ok:
      results.every((r) => r.valid) &&
      chain.mismatched.length === 0 &&
      chain.missing.length === 0,
    packages: results.map(({ record, ...rest }) => rest),
    chain,
  };
}

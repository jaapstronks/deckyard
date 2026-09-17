/**
 * `.deck` bundle — a self-contained, content-addressed archive of a
 * presentation and its assets (move 2 of the data-model track).
 *
 * Layout (OCF/EPUB-inspired):
 *   mimetype              first entry, STORED (uncompressed) — magic-number sniff
 *   manifest.json         bundle meta + asset inventory ({hash, id, mime, bytes})
 *   deck.json             the portable deck; asset refs rewritten to bundle refs
 *   theme.json            the deck's database theme, when it has one (D90)
 *   slide-types/<slug>.json
 *                         each database slide type the deck uses (D91)
 *   assets/<sha256>.<ext> the asset bytes, content-addressed (dedup + integrity):
 *                         slide images, theme logos, curated font files
 *
 * The human upload name is kept only in the manifest's `sources`, a separate
 * name layer so hash churn never leaks into the readable structure. Refs inside
 * deck.json point at `assets/<hash>.<ext>`.
 *
 * This module owns the bytes/hashing/ZIP; the pure ref layer lives in
 * shared/slide-types/deck-assets.js.
 */

import JSZip from 'jszip';

import { mimeFromExt } from '../utils/html-utils.js';
import { LocalProvider } from '../media/local.js';
import { ValidationError } from '../utils/errors.js';
import { presentationToDeck } from '../../shared/slide-types/deck.js';
import {
  collectAssetRefs,
  rewriteAssetRefs,
  collectUploadRefsIn,
  rewriteUploadRefsIn,
  assetRefForHash,
} from '../../shared/slide-types/deck-assets.js';
import {
  DECK_FORMAT_ID,
  DECK_MIMETYPE,
  isDeckMimetype,
} from '../../shared/slide-types/deck-format-id.js';
import {
  THEME_ENTRY,
  bundleThemeFonts,
  loadBundleableTheme,
  portableThemeRecord,
} from './deck-theme.js';
import {
  loadBundleableSlideTypes,
  portableSlideTypeRecord,
  slideTypeEntryRef,
} from './deck-slide-types.js';
import { readUploadAsset, sha256Hex } from './deck-install.js';

// Re-exported so bundle callers keep one import for the whole bundle surface;
// the values themselves (and the historical ones a reader still accepts) live
// in shared/slide-types/deck-format-id.js.
export { DECK_MIMETYPE };

/**
 * The bundle version this build writes. 2 added the carried theme and its
 * font files (D90); 3 added the carried slide types (D91).
 */
export const DECK_BUNDLE_VERSION = 3;

/**
 * The bundle versions this build reads. Each version is the one before it plus
 * a part — a version-1 bundle has no theme, a version-2 bundle no slide types —
 * so an older bundle reads unchanged; a version this build does not know may
 * carry parts it would silently drop, so it is refused.
 */
const READABLE_BUNDLE_VERSIONS = Object.freeze([1, 2, 3]);

/** SRI-shaped integrity id (`sha256-<base64>`) from a hex digest. */
function sriFromSha256Hex(hex) {
  return `sha256-${Buffer.from(hex, 'hex').toString('base64')}`;
}

/**
 * The asset inventory of one bundle: bytes de-duplicated by content hash, each
 * entry carrying who referenced it.
 */
function createInventory() {
  const byHash = new Map(); // hash -> { meta, buffer }

  /** Add a slide image or theme logo read from `/uploads/`. */
  function addUpload(ref, { buffer, hash, ext, bundleRef }) {
    const entry = byHash.get(hash);
    if (entry) {
      if (!entry.meta.sources.includes(ref)) entry.meta.sources.push(ref);
      return bundleRef;
    }
    byHash.set(hash, {
      buffer,
      meta: {
        ref: bundleRef,
        id: sriFromSha256Hex(hash),
        hash,
        mime: mimeFromExt(ext),
        bytes: buffer.length,
        sources: [ref],
      },
    });
    return bundleRef;
  }

  /** Add one face of a curated font; identical files collapse to one asset. */
  function addFontFace({ family, weight, subset, buffer, hash }) {
    const face = { family, weight, subset };
    const entry = byHash.get(hash);
    if (entry) {
      entry.meta.fontFaces.push(face);
      return;
    }
    byHash.set(hash, {
      buffer,
      meta: {
        ref: assetRefForHash(hash, 'woff2'),
        id: sriFromSha256Hex(hash),
        hash,
        mime: 'font/woff2',
        bytes: buffer.length,
        fontFaces: [face],
      },
    });
  }

  return { byHash, addUpload, addFontFace };
}

/**
 * Build a `.deck` bundle for a presentation.
 *
 * @param {string} repoRoot
 * @param {object} pres - a stored presentation, every language version kept
 *   (matching the JSON deck export)
 * @param {Object} [opts]
 * @param {Object} [opts.slideTypes] - the deck organization's registry
 *   (`buildMergedSlideTypes`), so a database type's text fields are known to
 *   the translation walk
 * @returns {Promise<Buffer>} the ZIP bytes
 */
export async function buildDeckBundle(repoRoot, pres, { slideTypes } = {}) {
  const deck = presentationToDeck(pres, { slideTypes });
  const inventory = createInventory();
  const missing = [];

  /** Content-address a set of upload refs; returns ref -> bundle ref. */
  async function addUploads(refs) {
    const map = new Map();
    for (const ref of refs) {
      const asset = await readUploadAsset(repoRoot, ref);
      if (!asset) {
        if (!missing.includes(ref)) missing.push(ref);
        continue;
      }
      map.set(ref, inventory.addUpload(ref, asset));
    }
    return map;
  }

  // Rewrite the deck's asset refs to the content-addressed bundle refs.
  const slideRefs = await addUploads(collectAssetRefs(deck));
  const portableDeck = rewriteAssetRefs(deck, (ref) => slideRefs.get(ref));

  // The database theme the deck is on, as an installable record (D90). A file
  // theme has no record and travels by the id already in deck.json.
  let themeJson = null;
  let fontsNotIncluded = [];
  const record = await loadBundleableTheme(repoRoot, pres?.theme);
  if (record) {
    const portable = portableThemeRecord(record);
    const themeRefs = await addUploads(collectUploadRefsIn(portable));
    const bundledTheme = rewriteUploadRefsIn(portable, (ref) =>
      themeRefs.get(ref),
    );
    const fonts = await bundleThemeFonts(repoRoot, record);
    for (const face of fonts.faces) inventory.addFontFace(face);
    fontsNotIncluded = fonts.notIncluded;
    themeJson = JSON.stringify(bundledTheme, null, 2);
  }

  // The database slide types the deck uses, as installable records (D91). A
  // file-JS type is code and travels by the type id already on its slides.
  const typeEntries = [];
  for (const record of await loadBundleableSlideTypes(
    pres?.organizationId,
    portableDeck,
  )) {
    const portable = portableSlideTypeRecord(record);
    const typeRefs = await addUploads(collectUploadRefsIn(portable));
    const json = JSON.stringify(
      rewriteUploadRefsIn(portable, (ref) => typeRefs.get(ref)),
      null,
      2,
    );
    typeEntries.push({
      slug: portable.slug,
      ref: slideTypeEntryRef(portable.slug),
      json,
      hash: sha256Hex(Buffer.from(json, 'utf8')),
    });
  }

  const manifest = {
    format: DECK_FORMAT_ID,
    bundleVersion: DECK_BUNDLE_VERSION,
    mimetype: DECK_MIMETYPE,
    deck: 'deck.json',
    ...(themeJson
      ? {
          theme: {
            ref: THEME_ENTRY,
            hash: sha256Hex(Buffer.from(themeJson, 'utf8')),
          },
        }
      : {}),
    ...(typeEntries.length
      ? {
          slideTypes: typeEntries.map(({ slug, ref, hash }) => ({
            slug,
            ref,
            hash,
          })),
        }
      : {}),
    assets: [...inventory.byHash.values()].map((a) => a.meta),
    // Refs whose bytes could not be read (external URLs are left in place in the
    // deck and are not listed here; these are local refs that went missing).
    ...(missing.length ? { missingAssets: missing } : {}),
    ...(fontsNotIncluded.length ? { fontsNotIncluded } : {}),
  };

  const zip = new JSZip();
  // First entry, uncompressed, so the archive is identifiable by magic number.
  zip.file('mimetype', DECK_MIMETYPE, { compression: 'STORE' });
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('deck.json', JSON.stringify(portableDeck, null, 2));
  if (themeJson) zip.file(THEME_ENTRY, themeJson);
  for (const { ref, json } of typeEntries) zip.file(ref, json);
  for (const { meta, buffer } of inventory.byHash.values()) {
    zip.file(meta.ref, buffer);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** The largest single asset an import writes (matches stock media). */
const BUNDLE_ASSET_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Save a bundle asset byte-for-byte as an uploaded file.
 *
 * A bundle asset is content-addressed: its name *is* the SHA-256 of its bytes.
 * The upload path re-encodes rasters (sharp), which gave the stored file a
 * different hash from the one the bundle named — so a re-export did not
 * reproduce the bundle, and a theme installed from a bundle could never be
 * recognised as the same theme on the next import (D90). The bytes were
 * integrity-checked on read and came out of an export that already optimized
 * them. Images only: a font or any other type in a bundle is never written.
 *
 * @param {string} repoRoot
 * @param {Buffer} buffer - the asset's bytes, as the bundle carries them
 * @param {string} filename - suggested basename (sanitized by the provider)
 * @param {string} mime - the manifest mime
 * @returns {Promise<string>} the `/uploads/…` URL
 */
export async function writeBundleAsset(repoRoot, buffer, filename, mime) {
  if (!String(mime || '').startsWith('image/')) {
    throw new ValidationError(`Unsupported image type: ${mime}`);
  }
  const { publicUrl } = await new LocalProvider(repoRoot).uploadBuffer({
    buffer,
    filename,
    contentType: mime,
    maxBytes: BUNDLE_ASSET_MAX_BYTES,
    optimize: false,
  });
  return publicUrl;
}

/**
 * Parse one JSON entry of a bundle. A broken entry is refused in the format's
 * own words (`manifest.json is not valid JSON`), never with V8's parser text.
 * Every reason `readDeckBundle` throws is a bare reason: the import route owns
 * the `Invalid .deck bundle:` prefix, so none of them names the bundle again.
 * @param {string} text
 * @param {string} name entry path inside the zip
 * @returns {any}
 */
function entryJson(text, name) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

/**
 * Read + validate a `.deck` bundle. Verifies the mimetype sentinel and each
 * asset's content hash (integrity), then returns the deck plus the asset bytes
 * keyed by their bundle ref.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer
 * @returns {Promise<{ mimetype: string, manifest: object, deck: object, theme: object|null, slideTypes: object[], assets: Map<string, Buffer> }>}
 */
export async function readDeckBundle(buffer) {
  // A `.deck` is a zip first. Whatever JSZip refuses is refused here in the
  // format's own words: its message and its docs URL are the library talking,
  // and the route hands this sentence straight to the user.
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('the file is not a zip archive');
  }

  const mtEntry = zip.file('mimetype');
  const mimetype = mtEntry ? (await mtEntry.async('string')).trim() : '';
  // Accepts the historical `vnd.slidecreator.deck` too: bundles already in the
  // wild carry it, and a published format does not stop reading its own past.
  if (!isDeckMimetype(mimetype)) {
    throw new Error('mimetype sentinel missing or mismatched');
  }

  const manifestEntry = zip.file('manifest.json');
  const deckEntry = zip.file('deck.json');
  if (!manifestEntry || !deckEntry) {
    throw new Error('manifest.json or deck.json is missing');
  }
  const manifest = entryJson(
    await manifestEntry.async('string'),
    'manifest.json',
  );
  if (!READABLE_BUNDLE_VERSIONS.includes(manifest?.bundleVersion)) {
    throw new Error(
      `bundleVersion ${JSON.stringify(manifest?.bundleVersion)} is not one this install reads (${READABLE_BUNDLE_VERSIONS.join(', ')})`,
    );
  }
  const deck = entryJson(await deckEntry.async('string'), 'deck.json');

  // The carried theme is verified like an asset: the manifest names its hash.
  let theme = null;
  if (manifest.theme) {
    const themeEntry = zip.file(String(manifest.theme.ref || ''));
    if (!themeEntry) {
      throw new Error(
        `the manifest names a missing theme: ${manifest.theme.ref}`,
      );
    }
    const buf = await themeEntry.async('nodebuffer');
    if (sha256Hex(buf) !== manifest.theme.hash) {
      throw new Error('the theme failed its integrity check');
    }
    theme = entryJson(buf.toString('utf8'), manifest.theme.ref);
  }

  // Each carried slide type the same way. The entry's ref is derived from its
  // slug and the file names that slug too: one spelling, refused otherwise.
  const slideTypes = [];
  const typeEntries = manifest.slideTypes ?? [];
  if (!Array.isArray(typeEntries)) {
    throw new Error('the manifest slideTypes is not a list');
  }
  for (const entry of typeEntries) {
    const slug = String(entry?.slug || '');
    if (!slug || entry.ref !== slideTypeEntryRef(slug)) {
      throw new Error(
        `the manifest names a slide type at an unexpected path: ${entry?.ref}`,
      );
    }
    const typeEntry = zip.file(entry.ref);
    if (!typeEntry) {
      throw new Error(`the manifest names a missing slide type: ${entry.ref}`);
    }
    const buf = await typeEntry.async('nodebuffer');
    if (sha256Hex(buf) !== entry.hash) {
      throw new Error(`slide type ${entry.ref} failed its integrity check`);
    }
    const definition = entryJson(buf.toString('utf8'), entry.ref);
    if (definition?.slug !== slug) {
      throw new Error(
        `slide type ${entry.ref} names another slug: ${definition?.slug}`,
      );
    }
    slideTypes.push(definition);
  }

  const assets = new Map();
  for (const a of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    const entry = zip.file(a.ref);
    if (!entry) {
      throw new Error(`the manifest lists a missing asset: ${a.ref}`);
    }
    const buf = await entry.async('nodebuffer');
    if (sha256Hex(buf) !== a.hash) {
      throw new Error(`asset ${a.ref} failed its integrity check`);
    }
    assets.set(a.ref, buf);
  }

  return { mimetype, manifest, deck, theme, slideTypes, assets };
}

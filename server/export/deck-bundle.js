/**
 * `.deck` bundle — a self-contained, content-addressed archive of a
 * presentation and its assets (move 2 of the data-model track).
 *
 * Layout (OCF/EPUB-inspired):
 *   mimetype              first entry, STORED (uncompressed) — magic-number sniff
 *   manifest.json         bundle meta + asset inventory ({hash, id, mime, bytes})
 *   deck.json             the portable deck; asset refs rewritten to bundle refs
 *   assets/<sha256>.<ext> the asset bytes, content-addressed (dedup + integrity)
 *
 * The human upload name is kept only in the manifest's `sources`, a separate
 * name layer so hash churn never leaks into the readable structure. Refs inside
 * deck.json point at `assets/<hash>.<ext>`.
 *
 * This module owns the bytes/hashing/ZIP; the pure ref layer lives in
 * shared/slide-types/deck-assets.js.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import { uploadsDir } from '../config/storage-paths.js';
import { mimeFromExt } from '../utils/html-utils.js';
import { presentationToDeck } from '../../shared/slide-types/deck.js';
import {
  collectAssetRefs,
  rewriteAssetRefs,
  assetRefForHash,
} from '../../shared/slide-types/deck-assets.js';

export const DECK_MIMETYPE = 'application/vnd.slidecreator.deck';
export const DECK_BUNDLE_VERSION = 1;

/** SRI-shaped integrity id (`sha256-<base64>`) from a hex digest. */
function sriFromSha256Hex(hex) {
  return `sha256-${Buffer.from(hex, 'hex').toString('base64')}`;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Resolve a `/uploads/<file>` ref to an absolute path under the uploads dir,
 * or null if it would escape it. Uses the env/sandbox-aware uploadsDir.
 */
function resolveUploadPath(repoRoot, ref) {
  const base = path.resolve(uploadsDir(repoRoot));
  const rel = decodeURIComponent(String(ref).replace(/^\/uploads\//, ''));
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/**
 * Build a `.deck` bundle for a presentation.
 *
 * @param {string} repoRoot
 * @param {object} pres - a stored presentation (already lang-projected/filtered
 *   by the caller, matching the JSON deck export)
 * @returns {Promise<Buffer>} the ZIP bytes
 */
export async function buildDeckBundle(repoRoot, pres) {
  const deck = presentationToDeck(pres);
  const refs = collectAssetRefs(deck);

  // Read + hash each local asset, de-duplicating by content hash.
  const refToBundle = new Map(); // /uploads/x.png -> assets/<hash>.<ext>
  const byHash = new Map(); // hash -> { meta, buffer }
  const missing = [];
  for (const ref of refs) {
    const abs = resolveUploadPath(repoRoot, ref);
    if (!abs) {
      missing.push(ref);
      continue;
    }
    let buf;
    try {
      buf = await fs.readFile(abs);
    } catch {
      missing.push(ref);
      continue;
    }
    const hash = sha256Hex(buf);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const bundleRef = assetRefForHash(hash, ext);
    refToBundle.set(ref, bundleRef);
    if (!byHash.has(hash)) {
      byHash.set(hash, {
        buffer: buf,
        meta: {
          ref: bundleRef,
          id: sriFromSha256Hex(hash),
          hash,
          mime: mimeFromExt(ext),
          bytes: buf.length,
          sources: [ref],
        },
      });
    } else {
      byHash.get(hash).meta.sources.push(ref);
    }
  }

  // Rewrite the deck's asset refs to the content-addressed bundle refs.
  const portableDeck = rewriteAssetRefs(deck, (ref) => refToBundle.get(ref));

  const manifest = {
    format: 'slidecreator.deck',
    bundleVersion: DECK_BUNDLE_VERSION,
    mimetype: DECK_MIMETYPE,
    deck: 'deck.json',
    assets: [...byHash.values()].map((a) => a.meta),
    // Refs whose bytes could not be read (external URLs are left in place in the
    // deck and are not listed here; these are local refs that went missing).
    ...(missing.length ? { missingAssets: missing } : {}),
  };

  const zip = new JSZip();
  // First entry, uncompressed, so the archive is identifiable by magic number.
  zip.file('mimetype', DECK_MIMETYPE, { compression: 'STORE' });
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('deck.json', JSON.stringify(portableDeck, null, 2));
  for (const { meta, buffer } of byHash.values()) {
    zip.file(meta.ref, buffer);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Read + validate a `.deck` bundle. Verifies the mimetype sentinel and each
 * asset's content hash (integrity), then returns the deck plus the asset bytes
 * keyed by their bundle ref.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer
 * @returns {Promise<{ mimetype: string, manifest: object, deck: object, assets: Map<string, Buffer> }>}
 */
export async function readDeckBundle(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const mtEntry = zip.file('mimetype');
  const mimetype = mtEntry ? (await mtEntry.async('string')).trim() : '';
  if (mimetype !== DECK_MIMETYPE) {
    throw new Error('Not a .deck bundle: mimetype sentinel missing or mismatched');
  }

  const manifestEntry = zip.file('manifest.json');
  const deckEntry = zip.file('deck.json');
  if (!manifestEntry || !deckEntry) {
    throw new Error('.deck bundle is missing manifest.json or deck.json');
  }
  const manifest = JSON.parse(await manifestEntry.async('string'));
  const deck = JSON.parse(await deckEntry.async('string'));

  const assets = new Map();
  for (const a of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    const entry = zip.file(a.ref);
    if (!entry) {
      throw new Error(`.deck bundle manifest lists a missing asset: ${a.ref}`);
    }
    const buf = await entry.async('nodebuffer');
    if (sha256Hex(buf) !== a.hash) {
      throw new Error(`.deck asset failed integrity check: ${a.ref}`);
    }
    assets.set(a.ref, buf);
  }

  return { mimetype, manifest, deck, assets };
}

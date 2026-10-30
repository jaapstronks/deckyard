/**
 * The public read path of a publication edition (T1.4,
 * `docs/plans/briefs/publication-records.md` § T1.4).
 *
 * Every public view of an edition - canvas, reader, manifest, verification
 * package, preview image - is derived from that edition's stored bytes and
 * record, and from nothing the deck, the theme store or the slide-type
 * registry says today:
 *
 *   - canvas and reader come from one render of the stored input in the
 *     edition's own renderer bundle (`renderEditionInBundle`), with the
 *     canvas address taken from the edition record, never from the input;
 *   - the manifest is the stored manifest bytes;
 *   - the package is built from the stored bytes (`server/export/edition-package.js`);
 *   - the preview image is the first image the edition itself shows.
 *
 * There is no fallback. An unknown edition is null (404 upstream), a render
 * that fails is an error (never the current renderer), and a revoked edition
 * is a tombstone whose bytes are not even loaded. Revocation is checked on
 * every request, before any cache is consulted, and drops the cache.
 *
 * Rendered HTML is a disposable derivative: a bounded in-memory cache keyed by
 * edition, language and canvas address, rebuilt from the same bytes when it is
 * gone.
 */

import {
  decodeDataUrl,
  renderEditionInBundle,
} from '../render/renderer-bundle/index.js';
import { buildEditionPackage } from '../export/edition-package.js';
import { getPublicEdition } from '../storage/editions.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../shared/i18n-progress.js';
import { resolveLangModeFromPresOrUrl } from '../utils/i18n.js';

/** At most this many rendered views are kept. */
const RENDER_CACHE_ENTRIES = 64;
/** And at most this many bytes of HTML across them. */
const RENDER_CACHE_BYTES = 64 * 1024 * 1024;
/** Per-edition facts read from the input once (languages, preview image). */
const META_CACHE_ENTRIES = 256;
/** And at most this many preview-image bytes across them, as for renders. */
const META_CACHE_BYTES = 64 * 1024 * 1024;

/** @type {Map<string, {canvas: string, reader: string, size: number, editionId: string}>} */
const renders = new Map();
let renderBytes = 0;
/** @type {Map<string, Promise<{canvas: string, reader: string}>>} */
const inflight = new Map();
/** @type {Map<string, {langs: string[], defaultLang: string|null, ogImage: {mediaType: string, bytes: Buffer}|null, size: number}>} */
const metas = new Map();
let metaBytes = 0;

let renderer = renderEditionInBundle;

/**
 * Replace the renderer the read path calls. Tests only: production renders
 * through the operator runner and nothing else.
 *
 * @param {typeof renderEditionInBundle|null} fn - null restores the runner
 */
export function __setEditionRendererForTests(fn) {
  renderer = fn || renderEditionInBundle;
  clearEditionCaches();
}

/** Drop every cached view and fact. */
export function clearEditionCaches() {
  renders.clear();
  renderBytes = 0;
  inflight.clear();
  metas.clear();
  metaBytes = 0;
}

function dropMeta(editionId) {
  const entry = metas.get(editionId);
  if (!entry) return;
  metas.delete(editionId);
  metaBytes -= entry.size;
}

/** Drop what is cached for one edition (on revocation). */
export function forgetEdition(editionId) {
  for (const [key, entry] of renders) {
    if (entry.editionId === editionId) {
      renders.delete(key);
      renderBytes -= entry.size;
    }
  }
  dropMeta(editionId);
}

/** The scope a public edition read runs in: the public id is the authorization. */
const publicScope = (repoRoot) =>
  crossOrganizationScope(
    repoRoot,
    'publication-edition: the public publication id is the authorization',
  );

/**
 * The edition's canvas address on this installation.
 *
 * @param {string} origin - `https://host`, no trailing slash
 * @param {{publicationId: string, version: number}} edition
 */
export function editionCanvasUrl(origin, { publicationId, version }) {
  return `${origin}/p/${publicationId}/${version}`;
}

/**
 * The edition's status, without its bytes: what every public request asks
 * first.
 *
 * @param {string} repoRoot
 * @param {string} publicationId
 * @param {number} version
 * @returns {Promise<import('../storage/editions.js').PublicEdition|null>}
 */
export async function findPublicEdition(repoRoot, publicationId, version) {
  const edition = await getPublicEdition(
    publicScope(repoRoot),
    publicationId,
    version,
  );
  if (edition?.revokedAt) forgetEdition(edition.id);
  return edition;
}

/**
 * The edition with its bytes, or null when it is unknown or revoked by now.
 *
 * @returns {Promise<import('../storage/editions.js').PublicEdition|null>}
 */
async function loadBytes(repoRoot, edition) {
  const full = await getPublicEdition(
    publicScope(repoRoot),
    edition.publicationId,
    edition.version,
    { withBytes: true },
  );
  if (!full || full.revokedAt || full.id !== edition.id) {
    if (full?.revokedAt) forgetEdition(edition.id);
    return null;
  }
  return full;
}

/**
 * The first image the edition shows, in slide order, as bytes: what a link
 * preview of it should look like, read from its own input.
 */
function firstImage(presentation) {
  let found = null;
  const visit = (value) => {
    if (found) return;
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) found = decodeDataUrl(value);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object')
      Object.values(value).forEach(visit);
  };
  for (const slide of presentation?.slides || []) visit(slide?.content);
  return found;
}

/** Remember a small fact set per edition, read from its input once. */
function remember(editionId, input) {
  const presentation = input?.presentation || {};
  const ogImage = firstImage(presentation);
  const meta = {
    langs: existingVersionLangs(presentation),
    defaultLang: normalizeLang(resolveLangModeFromPresOrUrl(presentation)),
    ogImage,
    size: ogImage ? ogImage.bytes.length : 0,
  };
  // An image larger than the whole budget is answered, not kept.
  if (meta.size > META_CACHE_BYTES) return meta;
  dropMeta(editionId);
  metas.set(editionId, meta);
  metaBytes += meta.size;
  while (metas.size > META_CACHE_ENTRIES || metaBytes > META_CACHE_BYTES) {
    dropMeta(metas.keys().next().value);
  }
  return meta;
}

async function editionMeta(repoRoot, edition) {
  const known = metas.get(edition.id);
  if (known) return known;
  const full = await loadBytes(repoRoot, edition);
  if (!full) return null;
  return remember(edition.id, JSON.parse(full.inputBytes.toString('utf8')));
}

/**
 * The language a request may see: one the edition has a version for, or
 * the edition's own language. Anything else in `?lang=` is ignored, so a
 * crafted query cannot make the runner render more views than exist.
 */
function pickLang(meta, requested) {
  const l = normalizeLang(requested);
  if (l && (meta.langs.includes(l) || l === meta.defaultLang)) return l;
  return meta.defaultLang;
}

function store(key, editionId, views) {
  const size =
    Buffer.byteLength(views.canvas) + Buffer.byteLength(views.reader);
  if (size > RENDER_CACHE_BYTES) return;
  renders.set(key, { ...views, size, editionId });
  renderBytes += size;
  while (
    renders.size > RENDER_CACHE_ENTRIES ||
    renderBytes > RENDER_CACHE_BYTES
  ) {
    const [oldest, entry] = renders.entries().next().value;
    renders.delete(oldest);
    renderBytes -= entry.size;
  }
}

/**
 * Canvas and reader of one edition view.
 *
 * @param {string} repoRoot
 * @param {import('../storage/editions.js').PublicEdition} edition - A
 *   non-revoked edition from {@link findPublicEdition}
 * @param {{origin: string, lang?: string|null}} request
 * @returns {Promise<{canvas: string, reader: string, lang: string|null}|null>}
 *   null when the edition was revoked meanwhile
 * @throws {import('../render/renderer-bundle/errors.js').RendererBundleError}
 *   The runner refused or is unavailable; there is no other renderer
 */
export async function renderEditionViews(repoRoot, edition, { origin, lang }) {
  const meta = await editionMeta(repoRoot, edition);
  if (!meta) return null;
  const viewLang = pickLang(meta, lang);
  const canonicalUrl = editionCanvasUrl(origin, edition);
  const key = `${edition.id}\n${viewLang ?? ''}\n${canonicalUrl}`;

  const cached = renders.get(key);
  if (cached) {
    // Most recently used goes last.
    renders.delete(key);
    renders.set(key, cached);
    return { canvas: cached.canvas, reader: cached.reader, lang: viewLang };
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const full = await loadBytes(repoRoot, edition);
      if (!full) return null;
      const input = JSON.parse(full.inputBytes.toString('utf8'));
      // The address comes from the record; the stored input has none.
      const views = await renderer(full.rendererHash, {
        ...input,
        canonicalUrl,
        ...(viewLang ? { lang: viewLang } : {}),
      });
      const out = { canvas: views.canvas, reader: views.reader };
      // A revocation that landed during the render must not be cached over.
      const now = await getPublicEdition(
        publicScope(repoRoot),
        edition.publicationId,
        edition.version,
      );
      if (!now || now.revokedAt) {
        forgetEdition(edition.id);
        return null;
      }
      store(key, edition.id, out);
      return out;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const views = await pending;
  return views ? { ...views, lang: viewLang } : null;
}

/**
 * The stored manifest bytes, or null when revoked meanwhile.
 * @returns {Promise<Buffer|null>}
 */
export async function editionManifestBytes(repoRoot, edition) {
  const full = await loadBytes(repoRoot, edition);
  return full ? full.manifestBytes : null;
}

/**
 * The verification package, or null when revoked meanwhile.
 * @returns {Promise<Buffer|null>}
 */
export async function editionPackageBytes(repoRoot, edition) {
  const full = await loadBytes(repoRoot, edition);
  return full ? buildEditionPackage(full) : null;
}

/**
 * The edition's preview image: the first image it shows, from its own
 * bytes. `{image: null}` when it shows none; null when
 * revoked meanwhile.
 *
 * @returns {Promise<{image: {mediaType: string, bytes: Buffer}|null}|null>}
 */
export async function editionOgImage(repoRoot, edition) {
  const meta = await editionMeta(repoRoot, edition);
  return meta ? { image: meta.ogImage } : null;
}

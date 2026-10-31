/**
 * The edition-input preparer: one deck, sealed into the bytes a render bundle
 * may read and nothing else (T1.2).
 *
 * A preparer in the sense of `docs/reference/renderer-bundle.md` § The split:
 * it reads what only this installation can answer - the publication filter,
 * the upload bytes, the theme's font files - and hands back an
 * `deckyard.edition-input/1` input whose every renderbepalende value is inside
 * it. The output is **bytes** plus the manifest derived from them
 * (`server/render/renderer-bundle/edition-manifest.js`), never an object a
 * later caller serialises again.
 *
 * What it guarantees, each as a separate step below:
 *
 *   1. **Snapshot.** The deck is cloned before anything else, so a write to the
 *      source after this call starts cannot reach the input.
 *   2. **Public projection.** `filterForPublished` from `server/utils/public-output.js`,
 *      the one publication filter, over every language version; then an
 *      allowlist for deck and theme metadata. No second projection.
 *   3. **Closed assets.** Every served ref in every language and in the theme
 *      becomes an inline data URL; a ref this installation cannot read is a
 *      refusal, not a blank image.
 *   4. **Refusals as a list (D362).** Slide types and markup the bundle cannot
 *      seal, iframes, remote images, external font services, unreadable or
 *      foreign private fonts and an oversized input are all collected first,
 *      and refused together, so the author sees everything to fix at once.
 *
 * It writes nothing and stores nothing: keeping the bytes is T1.3's job.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { filterForPublished } from '../utils/public-output.js';
import { resolveServedAssetPath } from '../utils/served-asset-path.js';
import { mimeFromExt } from '../utils/html-utils.js';
import { buildEmbeddedFontCss } from '../utils/embed-fonts.js';
import { themeVarsCssText } from '../utils/theme-vars-css.js';
import { managedFontKeyFromUrl } from '../media/managed-fonts.js';
import { listAllFontFamiliesWithVariants } from '../storage/font-families.js';
import { exportImageEmbedTransform } from './image-compress.js';
import {
  editionMediaProvider,
  editionUploadKey,
  mapEditionImageRefs,
} from './edition-media.js';
import {
  collectServedAssetRefs,
  isServedAssetRef,
  rewriteAssetRefs,
} from '../../shared/slide-types/deck-assets.js';
import { renderSlideHtml } from '../../shared/slide-types/presentation.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { SLIDE_TYPES } from '../../shared/slide-types/registry.js';
import { isIconUrl } from '../../shared/icon-names.js';
import {
  EDITION_INPUT_SCHEMA,
  RENDERER_BUNDLE_ERRORS,
  RUNNER_REQUEST_LIMIT,
  RendererBundleError,
  buildEditionManifest,
  canonicalJsonBytes,
  findUnsealableSlides,
} from '../render/renderer-bundle/index.js';

/**
 * The theme keys a renderer reads. Everything else on an effective theme
 * record (its id, organization, authorship, font-family ids, `embedFonts` and
 * `externalFontLinks`, which become `css.fontCss` or a refusal) stays out.
 */
const THEME_KEYS = Object.freeze([
  'label',
  'cssVars',
  'assets',
  'slideBackgrounds',
  'backgroundPresets',
  'defaultBackground',
  'defaultTitleSlide',
  'slideTypes',
  'titleLayout',
  'locks',
]);

/** The keys of a language version a reader is given. */
const VERSION_KEYS = Object.freeze(['title', 'description', 'slides']);

/**
 * @typedef {Object} EditionProblem
 * @property {string} reason - Closed vocabulary, see `docs/reference/renderer-bundle.md` § Preparing an edition input
 * @property {string|null} lang - The language version, null for the main list
 * @property {string|null} slideId - The slide, when it is one: an id, because
 *   a position in the published list differs from the editor's once a hidden
 *   slide is left out
 * @property {string} message
 */

/** Pick the keys that are set, in the order given. */
function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj?.[key] !== undefined) out[key] = obj[key];
  return out;
}

/**
 * Deck metadata a reader may receive: title, description, language, the
 * auto-advance setting the canvas plays, and per language version its title,
 * description and slides. Translation sources, collaborators, notes, the
 * publication descriptor and every other author field fall outside.
 */
function publicDeck(projected) {
  const deck = pick(projected, ['title', 'description', 'lang', 'slides']);
  const autoAdvance = projected?.settings?.autoAdvance;
  if (autoAdvance && typeof autoAdvance === 'object') {
    deck.settings = { autoAdvance };
  }
  const versions = projected?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    deck.i18n = {
      ...pick(projected.i18n, ['active', 'dominant']),
      versions: Object.fromEntries(
        Object.entries(versions).map(([lang, v]) => [
          lang,
          pick(v, VERSION_KEYS),
        ]),
      ),
    };
  }
  return deck;
}

/** Every slide list of a deck, labelled by language (null = main list). */
function slideLists(deck) {
  const lists = [{ lang: null, slides: deck.slides || [] }];
  for (const [lang, v] of Object.entries(deck.i18n?.versions || {})) {
    lists.push({ lang, slides: v?.slides || [] });
  }
  return lists;
}

/** Apply `fn` to every slide list, returning a new deck. */
function mapLists(deck, fn) {
  const out = { ...deck, slides: fn(deck.slides || []) };
  if (deck.i18n?.versions) {
    out.i18n = {
      ...deck.i18n,
      versions: Object.fromEntries(
        Object.entries(deck.i18n.versions).map(([lang, v]) => [
          lang,
          { ...v, slides: fn(v.slides || []) },
        ]),
      ),
    };
  }
  return out;
}

/** A served ref inside CSS text: `url('/uploads/…')`, quoted or not. */
const CSS_ASSET_URL = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g;

/**
 * Map every served ref in a theme record: a value that is one (`assets.logo`)
 * and one inside CSS text (`cssVars['--t-logo-url']` is `url('/uploads/…')`,
 * a slide-background value likewise). Wider than `rewriteThemeImageRefs`,
 * which only looks inside the two CSS fields a stored theme *config* declares;
 * the effective record has already turned the logo into CSS.
 *
 * @param {unknown} value
 * @param {(ref: string) => string|null} mapFn - null keeps the ref
 * @returns {unknown}
 */
function mapThemeRefs(value, mapFn, isRef = isServedAssetRef) {
  if (typeof value === 'string') {
    if (isRef(value)) return mapFn(value) || value;
    return value.replace(CSS_ASSET_URL, (whole, quote, ref) => {
      if (!isRef(ref)) return whole;
      const mapped = mapFn(ref);
      return mapped ? `url(${quote}${mapped}${quote})` : whole;
    });
  }
  if (Array.isArray(value))
    return value.map((v) => mapThemeRefs(v, mapFn, isRef));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapThemeRefs(v, mapFn, isRef)]),
    );
  }
  return value;
}

/** Elements that load a live document from elsewhere. */
const FRAME_TAG = /<(iframe|frame|embed|object)\b/gi;
/** Attributes that make the browser fetch a resource. */
const LOAD_ATTR = /\s(src|srcset|poster|data|background)\s*=\s*"([^"]*)"/gi;
/** `url(...)` anywhere, e.g. an inline style. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/**
 * The resources a piece of rendered HTML or CSS would fetch that are not in
 * the edition: anything but a data URL, an in-document fragment, or an icon
 * the renderer itself emits (`docs/reference/renderer-bundle.md` § Limits).
 */
function remoteLoadsIn(text) {
  const found = [];
  const check = (url) => {
    const u = String(url || '').trim();
    if (!u || u.startsWith('data:') || u.startsWith('#') || isIconUrl(u)) {
      return;
    }
    found.push(u);
  };
  for (const m of text.matchAll(LOAD_ATTR)) {
    if (m[1].toLowerCase() === 'srcset') {
      for (const part of m[2].split(',')) check(part.trim().split(/\s+/)[0]);
    } else {
      check(m[2]);
    }
  }
  for (const m of text.matchAll(CSS_URL)) check(m[2]);
  return found;
}

/**
 * Read one local or provider-owned ref into a data URL, through the same image
 * transform the live published page applies, so an edition carries what readers
 * already get.
 *
 * @returns {Promise<string|null>} null when this installation cannot read it
 */
async function inlineServedRef(repoRoot, ref, transform, media) {
  const key = media ? editionUploadKey(ref) : null;
  const resolved = key ? null : resolveServedAssetPath(repoRoot, ref);
  if (!key && !resolved) return null;
  let buf;
  try {
    buf = key
      ? await media.readFile(key, {
          maxBytes: 20 * 1024 * 1024,
          timeoutMs: 8000,
        })
      : await readFile(resolved.path);
  } catch {
    return null;
  }
  if (!buf) return null;
  const ext = path
    .extname(key || resolved.path)
    .slice(1)
    .toLowerCase();
  let mime = mimeFromExt(ext);
  if (transform && mime.startsWith('image/')) {
    const out = await transform(buf, ext, mime, ref);
    buf = out.buf;
    mime = out.mime;
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Seal one deck into an edition input.
 *
 * @param {string} repoRoot - Installation root (served asset trees)
 * @param {object} pres - The deck as stored; not mutated, cloned first
 * @param {object} options
 * @param {import('../storage/scope.js').StorageScope} options.scope - The
 *   deck's organization: an uploaded font must be one of its own
 * @param {object} options.theme - The effective theme record, `default`
 *   already resolved (`loadThemeAssets`). Required: without one the renderer
 *   falls back to the installation's own default assets, which no input
 *   carries.
 * @param {Record<string, object>} [options.slideTypes] - The organization's
 *   merged registry, for the publication filter. Sealability is always judged
 *   against the bundle's own registry, which this one cannot widen.
 * @param {string} [options.metaDescription]
 * @param {string} [options.canonicalUrl] - The edition's canvas address
 * @returns {Promise<{inputBytes: Buffer, manifestBytes: Buffer, manifest: object}>}
 * @throws {RendererBundleError} `renderer_edition_input_unsealable`, with
 *   `details.problems` listing every {@link EditionProblem}
 */
export async function prepareEditionInput(
  repoRoot,
  pres,
  { scope, theme, slideTypes, metaDescription = '', canonicalUrl = '' } = {},
) {
  if (!theme || typeof theme !== 'object') {
    throw new TypeError('prepareEditionInput: an effective theme is required');
  }
  // 1. Snapshot: nothing below reads the caller's object again.
  const snapshot = structuredClone(pres);
  const themeSnapshot = structuredClone(theme);

  /** @type {EditionProblem[]} */
  const problems = [];
  const report = (reason, message, { lang = null, slideId = null } = {}) =>
    problems.push({ reason, lang, slideId, message });

  // 2. Public projection, then the metadata allowlist.
  let deck = publicDeck(filterForPublished(snapshot, { slideTypes }));

  for (const { lang, slides } of slideLists(deck)) {
    for (const u of findUnsealableSlides(slides)) {
      report(u.reason, u.message, {
        lang,
        slideId: slides[u.index]?.id ?? null,
      });
    }
  }

  // 3. Closed assets: one read per distinct ref, deck and theme alike.
  const publicTheme = pick(themeSnapshot, THEME_KEYS);
  const media = editionMediaProvider();
  const isRef = (ref) =>
    isServedAssetRef(ref) || !!(media && editionUploadKey(ref));
  const refs = new Set();
  mapThemeRefs(
    publicTheme,
    (ref) => {
      refs.add(ref);
      return null;
    },
    isRef,
  );
  for (const { slides } of slideLists(deck)) {
    for (const ref of collectServedAssetRefs({ slides })) refs.add(ref);
    for (const slide of slides) {
      mapEditionImageRefs(slide, (ref) => {
        if (isRef(ref)) refs.add(ref);
        return null;
      });
    }
  }
  const transform = exportImageEmbedTransform();
  const inlined = new Map();
  for (const ref of refs) {
    const dataUrl = await inlineServedRef(repoRoot, ref, transform, media);
    if (dataUrl) inlined.set(ref, dataUrl);
    else
      report(
        'asset_unreadable',
        `"${ref}" cannot be read on this installation`,
      );
  }
  const toData = (ref) => inlined.get(ref) || null;
  deck = mapLists(
    deck,
    (slides) => rewriteAssetRefs({ slides }, toData).slides,
  );
  for (const { slides } of slideLists(deck)) {
    for (const slide of slides) mapEditionImageRefs(slide, toData);
  }
  const sealedTheme = mapThemeRefs(publicTheme, toData, isRef);

  // 4. What the input would still fetch from elsewhere.
  const links = Array.isArray(themeSnapshot.externalFontLinks)
    ? themeSnapshot.externalFontLinks.filter((l) => l?.url)
    : [];
  for (const l of links) {
    report(
      'external_font',
      `the theme loads fonts from ${l.url}; a font service cannot be frozen into an edition`,
    );
  }

  const ownedFonts = await ownedManagedFontUrls(scope, themeSnapshot);
  for (const f of themeSnapshot.embedFonts || []) {
    const url = typeof f?.url === 'string' ? f.url.trim() : '';
    if (url && managedFontKeyFromUrl(url) && !ownedFonts.has(url)) {
      report(
        'foreign_font',
        `font "${f.family}" is an uploaded font that does not belong to this deck's organization`,
      );
    }
  }
  const fontCss = await buildEmbeddedFontCss(
    repoRoot,
    {
      embedFonts: (themeSnapshot.embedFonts || []).filter(
        (f) => !f?.url || ownedFonts.has(String(f.url).trim()),
      ),
    },
    {
      onUnresolved: (face) =>
        report(
          'font_unreadable',
          `font "${face.family}" (${face.weight} ${face.style}) cannot be read on this installation`,
        ),
    },
  );

  for (const url of remoteLoadsIn(themeVarsCssText(sealedTheme))) {
    report('remote_resource', `the theme loads ${url} from elsewhere`);
  }
  for (const { lang, slides } of slideLists(deck)) {
    for (const slide of slides) {
      if (findUnsealableSlides([slide]).length) continue; // already reported
      const html = renderSlideHtml(slide, {
        theme: sealedTheme,
        slideTypes: SLIDE_TYPES,
        stripEditorAttrs: true,
        // A version renders its own copy; the main list the deck's.
        lang: lang ?? resolveDeckLang(deck),
      });
      const frame = [...html.matchAll(FRAME_TAG)][0];
      if (frame) {
        report(
          'live_embed',
          `a ${slide.type} slide shows an <${frame[1].toLowerCase()}>, whose content can change after publication; replace it with text or a link`,
          { lang, slideId: slide?.id ?? null },
        );
      }
      for (const url of new Set(remoteLoadsIn(html))) {
        report(
          'remote_resource',
          `a ${slide.type} slide loads ${url} from elsewhere; upload the file instead`,
          { lang, slideId: slide?.id ?? null },
        );
      }
    }
  }

  const input = {
    schema: EDITION_INPUT_SCHEMA,
    presentation: deck,
    theme: sealedTheme,
    css: { fontCss },
    metaDescription: String(metaDescription || ''),
    canonicalUrl: String(canonicalUrl || ''),
  };
  const inputBytes = problems.length ? null : canonicalJsonBytes(input);
  if (inputBytes && inputBytes.length > RUNNER_REQUEST_LIMIT) {
    report(
      'too_large',
      `the edition is ${inputBytes.length} bytes, over the renderer's ${RUNNER_REQUEST_LIMIT}-byte limit`,
    );
  }

  if (problems.length) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT,
      `the deck has ${problems.length} dependenc${problems.length === 1 ? 'y' : 'ies'} an edition cannot freeze`,
      { problems },
    );
  }

  const manifest = buildEditionManifest(inputBytes);
  return {
    inputBytes,
    manifestBytes: canonicalJsonBytes(manifest),
    manifest,
  };
}

/**
 * The `/fonts/managed/` URLs of the deck organization's own uploaded fonts.
 * Asked only when the theme embeds one; an unreadable database answers with
 * none, so a managed font is then refused rather than assumed to be owned.
 */
async function ownedManagedFontUrls(scope, theme) {
  const wanted = (theme?.embedFonts || []).some(
    (f) => typeof f?.url === 'string' && managedFontKeyFromUrl(f.url.trim()),
  );
  if (!wanted || !scope) return new Set();
  const families = await listAllFontFamiliesWithVariants(scope);
  return new Set(
    families.flatMap((family) =>
      (family.variants || []).map((v) => v.url).filter(Boolean),
    ),
  );
}

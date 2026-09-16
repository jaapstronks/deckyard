/**
 * Import a `.deck` bundle — the mirror of the bundle export
 * (server/export/deck-bundle.js). A `.deck` archive carries its own asset bytes
 * content-addressed as `assets/<hash>.<ext>`; here we unpack those bytes back
 * into `/uploads/`, rewrite the deck's bundle refs to the new upload URLs, and
 * create a presentation from the re-hydrated deck.
 *
 * Flow (see docs/reference/deck-bundle-format.md):
 *   readDeckBundle(buffer)                     verify sentinel + asset integrity
 *   → settleBundledTheme                       existing / install / not-installed
 *   → writeBundleAsset per asset                assets/<hash> -> /uploads/<uuid>
 *   → rewriteBundleRefs(deck, mapFn)           bundle refs -> /uploads/ refs
 *   → createTheme (install only)               the carried theme, never over one
 *   → deckToPresentationParts(deck, {theme})   normalize (shared with JSON import)
 *   → createPresentation + updatePresentation  same shape as import-json.js
 *
 * `?install=theme` asks for the carried theme to be installed (D90); only a
 * user who may manage themes gets it. The list form is the same flag D91 uses
 * for slide types; a value this build does not know is refused.
 *
 * Degrades gracefully: a bundle that lists an unsupported asset (or one that
 * fails to save) keeps its original ref rather than crashing the import; unknown
 * slide types become a harmless placeholder (deckToPresentationParts).
 *
 * Error handling lives in the `withErrorHandler` wrapper on the presentations
 * dispatcher: typed AppErrors (sandbox quota, 413) surface their own status,
 * anything else is a generic 500.
 */

import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import { readRequestBody, serveJson, badRequest } from '../../../utils/http.js';
import {
  readDeckBundle,
  writeBundleAsset,
} from '../../../export/deck-bundle.js';
import {
  installBundledTheme,
  settleBundledTheme,
} from '../../../export/deck-theme.js';
import { getDefaultThemeId } from '../../../storage/settings.js';
import { canManage } from '../../../utils/route-middleware.js';
import {
  deckImportLang,
  deckToPresentationParts,
} from '../../../../shared/slide-types.js';
import {
  collectBundleRefsIn,
  rewriteBundleRefs,
  rewriteBundleRefsIn,
} from '../../../../shared/slide-types/deck-assets.js';
import { loadDeckTheme } from '../../../utils/themes.js';

/** What `?install=` may name. B251 adds `slideTypes` (D91). */
const DECK_INSTALLABLES = Object.freeze(['theme']);

/**
 * The `install` query as a set, or an error message for a value this build
 * does not know. One or more `install` params, each a comma-separated list.
 * @param {URL|undefined} url
 * @returns {{ok: true, install: Set<string>} | {ok: false, message: string}}
 */
function parseDeckInstall(url) {
  const install = new Set();
  for (const raw of url?.searchParams?.getAll('install') ?? []) {
    for (const part of raw.split(',')) {
      const value = part.trim();
      if (!value) continue;
      if (!DECK_INSTALLABLES.includes(value)) {
        return {
          ok: false,
          message: `install=${value} is not something a .deck import installs (${DECK_INSTALLABLES.join(', ')})`,
        };
      }
      install.add(value);
    }
  }
  return { ok: true, install };
}

export async function handlePresentationsImportDeck({
  repoRoot,
  storageScope,
  req,
  res,
  url,
  authedUser,
} = {}) {
  const asked = parseDeckInstall(url);
  if (!asked.ok) {
    badRequest(res, asked.message);
    return true;
  }

  const raw = await readRequestBody(req);
  if (!raw || raw.length === 0) {
    badRequest(res, 'Empty request body (expected a .deck bundle)');
    return true;
  }

  let bundle;
  try {
    bundle = await readDeckBundle(raw);
  } catch (err) {
    // Not a bundle / failed sentinel or integrity check → client error.
    badRequest(res, `Invalid .deck bundle: ${err.message}`);
    return true;
  }

  const { manifest, deck, theme: bundledThemeJson, assets } = bundle;
  // The deck names its own language (D89); the manifest has never carried one.
  const resolved = deckImportLang(deck);
  if (!resolved.ok) {
    badRequest(res, `Invalid .deck bundle: ${resolved.message}`);
    return true;
  }
  const { lang } = resolved;

  // What the carried theme becomes here, decided before any bytes are written
  // so a theme that is not installed leaves no logo files behind.
  const settled = bundledThemeJson
    ? await settleBundledTheme({
        repoRoot,
        scope: storageScope,
        theme: bundledThemeJson,
        install: asked.install.has('theme'),
        permitted: canManage(authedUser),
      })
    : null;
  const deckRefs = new Set(collectBundleRefsIn(deck));
  const skipRefs = new Set(
    settled?.status === 'install'
      ? []
      : collectBundleRefsIn(bundledThemeJson).filter((r) => !deckRefs.has(r)),
  );

  // Re-hydrate each asset into /uploads/ and build bundle-ref -> upload-url map.
  // The human name is recovered from the manifest's `sources` (the separate
  // name layer), so re-imported files keep a readable basename. Font files are
  // not written: a curated family renders from this instance's own vendored
  // files, and nothing here stores a curated face (D90).
  const refToUpload = new Map();
  const failedAssets = [];
  for (const asset of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    if (asset.fontFaces || skipRefs.has(asset.ref)) continue;
    const buf = assets.get(asset.ref);
    if (!buf) continue; // readDeckBundle guarantees presence, but be defensive
    const sourceName = Array.isArray(asset.sources) ? asset.sources[0] : '';
    try {
      const uploadUrl = await writeBundleAsset(
        repoRoot,
        buf,
        sourceName || asset.ref,
        asset.mime,
      );
      refToUpload.set(asset.ref, uploadUrl);
    } catch (err) {
      // Unsupported mime / oversized asset: leave the ref in place so the rest
      // of the deck still imports (degrade, don't crash).
      failedAssets.push({ ref: asset.ref, reason: err.message });
    }
  }

  // Rewrite the deck's content-addressed refs back to the new /uploads/ URLs.
  const rehydrated = rewriteBundleRefs(deck, (ref) => refToUpload.get(ref));

  // The theme the deck lands on. Without a carried theme, the id in deck.json.
  let themeId = null;
  let bundledTheme = null;
  if (settled) {
    bundledTheme = {
      slug: bundledThemeJson.slug,
      label: bundledThemeJson.label,
      status: settled.status === 'install' ? 'installed' : settled.status,
      ...(settled.reason ? { reason: settled.reason } : {}),
      ...(settled.fontsMissing.length
        ? { fontsMissing: settled.fontsMissing }
        : {}),
    };
    if (settled.status === 'existing') {
      themeId = settled.record.id;
    } else if (settled.status === 'install') {
      const theme = rewriteBundleRefsIn(settled.theme, (ref) =>
        refToUpload.get(ref),
      );
      const result = await installBundledTheme(
        storageScope,
        theme,
        settled.familyIds,
      );
      if (!result.ok) {
        badRequest(
          res,
          `Invalid .deck bundle: its theme cannot be installed (${result.field || result.reason})`,
        );
        return true;
      }
      themeId = result.theme.id;
    } else {
      themeId = await getDefaultThemeId(storageScope);
    }
    if (settled.status !== 'not-installed') bundledTheme.themeId = themeId;
  }

  // The deck's theme, so imported slides compose against it (background
  // presets, theme slide-background variants).
  const themeConfig = await loadDeckTheme(
    repoRoot,
    themeId ?? rehydrated?.theme,
    storageScope,
  );

  const parts = deckToPresentationParts(rehydrated, {
    theme: themeConfig,
    lang,
  });
  const theme = themeId ?? parts.theme;

  const created = await createPresentation(storageScope, {
    title: parts.title,
    theme,
    lang,
    ownerEmail: authedUser?.email || null,
  });

  // Update i18n.versions[lang] with the imported slides, otherwise
  // normalizeI18n overwrites them with defaults (mirrors import-json.js). The
  // deck's translations land as the other language versions (D89).
  const i18n = {
    dominant: lang,
    active: lang,
    versions: {
      ...parts.translations,
      [lang]: {
        title: parts.title,
        slides: parts.slides,
      },
    },
  };

  const updated = await updatePresentation(
    storageScope,
    created.id,
    {
      title: parts.title,
      theme,
      lang,
      slides: parts.slides,
      i18n,
    },
    {
      actorEmail: authedUser?.email || null,
    },
  );

  serveJson(res, 201, {
    ...updated,
    ...(failedAssets.length ? { failedAssets } : {}),
    ...(bundledTheme ? { bundledTheme } : {}),
  });
  return true;
}

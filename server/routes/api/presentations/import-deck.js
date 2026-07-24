/**
 * Import a `.deck` bundle — the mirror of the bundle export
 * (server/export/deck-bundle.js). A `.deck` archive carries its own asset bytes
 * content-addressed as `assets/<hash>.<ext>`; here we unpack those bytes back
 * into `/uploads/`, rewrite the deck's bundle refs to the new upload URLs, and
 * create a presentation from the re-hydrated deck.
 *
 * Flow (see docs/reference/deck-bundle-format.md):
 *   readDeckBundle(buffer)                     verify sentinel + asset integrity
 *   → saveUploadedFile per asset               assets/<hash> -> /uploads/<uuid>
 *   → rewriteBundleRefs(deck, mapFn)           bundle refs -> /uploads/ refs
 *   → deckToPresentationParts(deck, {theme})   normalize (shared with JSON import)
 *   → createPresentation + updatePresentation  same shape as import-json.js
 *
 * Degrades gracefully: a bundle that lists an unsupported asset (or one that
 * fails to save) keeps its original ref rather than crashing the import; unknown
 * slide types become a harmless placeholder (deckToPresentationParts).
 */

import { createPresentation, updatePresentation } from '../../../storage/presentations.js';
import {
  readRequestBody,
  serveJson,
  badRequest,
  serverError,
} from '../../../utils/http.js';
import { isAppError } from '../../../utils/errors.js';
import { readDeckBundle } from '../../../export/deck-bundle.js';
import { saveUploadedFile } from '../../../storage/uploads.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { rewriteBundleRefs } from '../../../../shared/slide-types/deck-assets.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('import-deck');

export async function handlePresentationsImportDeck({
  repoRoot,
  req,
  res,
  authedUser,
} = {}) {
  try {
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

    const { manifest, deck, assets } = bundle;
    const lang = manifest?.lang === 'en-GB' ? 'en-GB' : 'nl';

    // Re-hydrate each asset into /uploads/ and build bundle-ref -> upload-url map.
    // The human name is recovered from the manifest's `sources` (the separate
    // name layer), so re-imported files keep a readable basename.
    const refToUpload = new Map();
    const failedAssets = [];
    for (const asset of Array.isArray(manifest?.assets) ? manifest.assets : []) {
      const buf = assets.get(asset.ref);
      if (!buf) continue; // readDeckBundle guarantees presence, but be defensive
      const sourceName = Array.isArray(asset.sources) ? asset.sources[0] : '';
      try {
        const url = await saveUploadedFile(repoRoot, buf, sourceName || asset.ref, asset.mime);
        refToUpload.set(asset.ref, url);
      } catch (err) {
        // Unsupported mime / oversized asset: leave the ref in place so the rest
        // of the deck still imports (degrade, don't crash).
        failedAssets.push({ ref: asset.ref, reason: err.message });
      }
    }

    // Rewrite the deck's content-addressed refs back to the new /uploads/ URLs.
    const rehydrated = rewriteBundleRefs(deck, (ref) => refToUpload.get(ref));

    // Load the deck's theme so imported title slides can take a background image
    // from its presets (mirrors import-json.js).
    let themeConfig = null;
    try {
      themeConfig = await loadTheme(repoRoot, resolveThemeId(rehydrated?.theme));
    } catch {
      // ignore — title slides are imported without a background image
    }

    const parts = deckToPresentationParts(rehydrated, { theme: themeConfig });

    const created = await createPresentation(repoRoot, {
      title: parts.title,
      theme: parts.theme,
      lang,
      ownerEmail: authedUser?.email || null,
    });

    // Update i18n.versions[lang] with the imported slides, otherwise
    // normalizeI18n overwrites them with defaults (mirrors import-json.js).
    const i18n = {
      dominant: lang,
      active: lang,
      versions: {
        [lang]: {
          title: parts.title,
          slides: parts.slides,
        },
      },
    };

    const updated = await updatePresentation(
      repoRoot,
      created.id,
      {
        title: parts.title,
        theme: parts.theme,
        lang,
        slides: parts.slides,
        i18n,
      },
      {
        actorEmail: authedUser?.email || null,
      }
    );

    serveJson(res, 201, {
      ...updated,
      ...(failedAssets.length ? { failedAssets } : {}),
    });
    return true;
  } catch (err) {
    // Typed application errors (e.g. sandbox quota) carry their own 4xx status
    // + safe message — surface it instead of masking as a 500.
    if (isAppError(err)) {
      serveJson(res, err.statusCode, err.toJSON());
      return true;
    }
    log.error('[import-deck] Error:', err.message);
    serverError(res, 'Failed to import .deck bundle');
    return true;
  }
}

/**
 * Import a deck in the portable JSON format as a new presentation.
 *
 * The one implementation behind `POST /api/presentations/import/json` and the
 * sandbox "open an example" route (B353), so both create the same deck from
 * the same document.
 */

import { updatePresentation } from '../storage/presentations/index.js';
import { createPresentation } from './presentations.js';
import {
  deckImportLang,
  deckToPresentationParts,
} from '../../shared/slide-types.js';
import { settleNewDeckTheme } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {import('../storage/scope.js').StorageScope} opts.storageScope
 * @param {object|null} opts.actor - The authenticated user creating the deck.
 * @param {object} opts.deck - The deck document.
 * @param {string|null} [opts.lang] - The requested language, if any.
 * @returns {Promise<{ok:false, message:string}|{ok:true, presentation:object}>}
 *   `ok:false` when the deck's language is unsupported or contradicts the
 *   requested one; a theme this instance does not have throws its typed error.
 */
export async function importJsonDeck({
  repoRoot,
  storageScope,
  actor,
  deck,
  lang: requestLang = null,
}) {
  const resolved = deckImportLang(deck, requestLang);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { lang } = resolved;

  // The deck's theme, so imported slides compose against it (background
  // presets, theme slide-background variants). A theme this instance does not
  // have is refused like on every create (B486); a `.deck` bundle is the
  // format that carries its theme along.
  const { themeId, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    deck?.theme,
    storageScope,
  );

  // The organization's own registry, so a slide of one of its database types
  // imports as itself rather than as the placeholder.
  const parts = deckToPresentationParts(deck, {
    theme: themeConfig,
    lang,
    slideTypes: await buildMergedSlideTypes(storageScope),
  });

  const created = await createPresentation(
    storageScope,
    { actor },
    {
      title: parts.title,
      theme: themeId,
      extensions: parts.extensions,
      lang,
    },
  );

  // Build the update payload with proper i18n structure.
  // We need to update i18n.versions[lang] with the imported slides,
  // otherwise normalizeI18n will overwrite our slides with the default ones.
  // The deck's translations land as the other language versions (D89).
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

  const presentation = await updatePresentation(
    storageScope,
    created.id,
    {
      title: parts.title,
      theme: themeId,
      extensions: parts.extensions,
      lang,
      slides: parts.slides,
      i18n,
    },
    {
      actorEmail: actor?.email || null,
    },
  );
  return { ok: true, presentation };
}

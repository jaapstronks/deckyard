/**
 * Import a deck in the portable JSON format as a new presentation.
 *
 * The one implementation behind `POST /api/presentations/import/json` and the
 * sandbox "open an example" route (B353), so both create the same deck from
 * the same document. {@link createImportedPresentation} is the write step every
 * importer shares: this one, the file and Notion converters and the Markdown
 * import.
 */

import { updatePresentation } from '../storage/presentations/index.js';
import { createPresentation } from './presentations.js';
import {
  deckImportLang,
  deckToPresentationParts,
} from '../../shared/slide-types.js';
import { settleNewDeckTheme } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { assertValidImportedDeck } from './slide-field-validation.js';

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {import('../storage/scope.js').StorageScope} opts.storageScope
 * @param {object|null} opts.actor - The authenticated user creating the deck.
 * @param {object} opts.deck - The deck document.
 * @param {string|null} [opts.lang] - The requested language, if any.
 * @returns {Promise<{ok:false, message:string}|{ok:true, presentation:object}>}
 *   `ok:false` when the deck's language is unsupported or contradicts the
 *   requested one; a theme this instance does not have throws its typed error,
 *   and so does a slide field the editor would refuse (400 `invalid`).
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
  const slideTypes = await buildMergedSlideTypes(storageScope);
  const parts = deckToPresentationParts(deck, {
    theme: themeConfig,
    lang,
    slideTypes,
  });

  const presentation = await createImportedPresentation(
    storageScope,
    { actor },
    { parts, slideTypes, lang, theme: themeId },
  );
  return { ok: true, presentation };
}

/**
 * Create a deck from the parts `deckToPresentationParts` composed, for an
 * actor: the write step of every importer (JSON, the file converters, Notion,
 * Markdown). The slides meet the declared field rules a save meets before any
 * deck exists, per language version, naming the slide and the field (B693,
 * B694); a converter's model output has been through the AI fix pipeline
 * already, so what is still invalid here is refused, not repaired. Then an
 * empty deck is created and the slides land as the language versions, since
 * the factory's `normalizeI18n` would otherwise replace them with its default.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {{ actor: object|null }} identity - The creating actor.
 * @param {object} opts
 * @param {{title?: string, extensions?: object, slides?: Array<object>, translations?: Record<string, {slides?: Array<object>}>}} opts.parts
 * @param {Record<string, Object>} opts.slideTypes - The organization's map
 *   the parts were composed with.
 * @param {string} opts.lang - The deck's language.
 * @param {string} opts.theme - The settled theme id.
 * @param {object} [opts.fields] - Further create fields (`title` overrides
 *   the parts' title, `settings`, `notionSourcePageId`).
 * @returns {Promise<Object>} The stored presentation.
 * @throws {AppError} 400 `invalid`: a slide field the editor would refuse
 *   (`details.lang`, `index`, `slideId`, `field`, `errors`).
 */
export async function createImportedPresentation(
  scope,
  { actor },
  { parts, slideTypes, lang, theme, fields = {} },
) {
  assertValidImportedDeck(parts, slideTypes, { lang });

  const title = fields.title ?? parts.title;
  const created = await createPresentation(
    scope,
    { actor },
    { ...fields, title, theme, extensions: parts.extensions, lang },
  );

  // The deck's translations land as the other language versions (D89).
  const i18n = {
    dominant: lang,
    active: lang,
    versions: {
      ...parts.translations,
      [lang]: { title, slides: parts.slides },
    },
  };
  return updatePresentation(
    scope,
    created.id,
    {
      title,
      theme,
      extensions: parts.extensions,
      lang,
      slides: parts.slides,
      i18n,
    },
    { actorEmail: actor?.email || null },
  );
}

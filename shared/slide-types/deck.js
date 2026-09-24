import { cryptoUuid, slideJumpTarget } from './helpers.js';
import { newSlide } from './presentation.js';
import { allowedEnumValues } from './field-types.js';
import {
  applyContentTranslation,
  contentTranslation,
  isTextField,
  textFieldSpec,
  textFieldSpecForType,
} from './text-fields.js';
import { DEFAULT_DECK_LANG, normalizeLang } from '../i18n-utils.js';
import { existingVersionLangs, pickVersion } from '../i18n-progress.js';
import { VISIBILITY_PRESETS } from '../slide-visibility.js';
import {
  SLIDE_TYPES,
  canonicalSlideType,
  getSlideType,
  resolveSlideTypeName,
} from './registry.js';
import { tryParseTypeId } from './type-id.js';
import { unresolvedSlideAsMarkdown } from './unresolved.js';
import { DECK_FORMAT_ID } from './deck-format-id.js';
import { migratePresentation } from './schema-version.js';

// --------
// Portable deck format (for export/import)
//
// This is intentionally readable and stable:
// - No UUIDs/timestamps required
// - `slides` is an array of `{ type, content }`, plus the optional slide keys
//   `translations`, `notes`, `duration` and `visibility` (see Languages below)
//
// Example:
// {
//   "format": "deckyard.deck",
//   "version": 1,
//   "title": "My deck",
//   "theme": "default",
//   "slides": [
//     { "type": "eu.deckyard.slide.title", "content": { "title": "...", "subheading": "", "background": "lime" } }
//   ]
// }
//
// `slides[].type` carries the type's ONE published spelling: the canonical
// reverse-DNS id (`eu.deckyard.slide.title[@version]`), `namespace/name` for a
// declarant without an authority. Storage keeps the bare registry key
// internally; export projects it to the canonical id via `canonicalSlideType`,
// and import folds any spelling back to the key — round-trip stable by
// construction. There is no separate slide-type manifest: the id on each slide
// already names the definition (and MAY pin an `@version`), so a second map
// would only duplicate what the id carries.
//
// The `format` sentinel and the bundle mimetype both live in
// ./deck-format-id.js — one place to change them, and the place that records
// which historical values a reader still accepts.
// --------

// Languages (D89). A stored deck keeps a full copy of its slides per language
// (`i18n.versions[lang]`); the portable deck carries structure once. `content`,
// `title` and `notes` are the dominant language, named by the envelope `lang`;
// every other version travels as `translations.<lang>` — on the envelope for
// the title, on each slide for its per-language keys plus `notes`. Which keys
// are per-language is the text-field predicate's answer, applied by the same
// pair of walks in both directions (`contentTranslation` on export,
// `applyContentTranslation` on import). Everything is optional: a reader that
// does not know `translations` still gets a complete deck in one language.
//
// `notes` is a slide key, not a content key, so inside a slide translation it
// always means the notes; no type may declare a content field named `notes`
// (pinned by tests/deck-translations.test.js).
// --------

const VISIBILITY_FLAGS = Object.keys(VISIBILITY_PRESETS.visible);
const MIN_DURATION = 1;
const MAX_DURATION = 300;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function portableDuration(value) {
  return typeof value === 'number' &&
    value >= MIN_DURATION &&
    value <= MAX_DURATION
    ? Math.round(value)
    : null;
}

/**
 * The visibility flags a slide sets, or `null` when it sets none. Only the four
 * known flags, and only when `true`: an absent flag already means "visible".
 * @param {*} value
 * @returns {Object|null}
 */
function portableVisibility(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const key of VISIBILITY_FLAGS) if (value[key] === true) out[key] = true;
  return Object.keys(out).length ? out : null;
}

/**
 * The slide in another language version that answers to `slide`: same id, else
 * same position — the match every language walk makes.
 */
function matchingSlide(slide, index, versionSlides, byId) {
  return (
    (typeof slide?.id === 'string' && slide.id && byId.get(slide.id)) ||
    versionSlides[index] ||
    null
  );
}

/**
 * Project a stored presentation onto the portable `deckyard.deck` envelope.
 *
 * Every language version travels: `content` holds the dominant language and
 * the others become `translations` (D89). The input is the stored deck, not a
 * projection onto one language — projecting first is what used to drop them.
 *
 * @param {Object} pres - a stored presentation (or presentation parts)
 * @param {Object} [opts]
 * @param {Object} [opts.slideTypes] - the registry the deck resolves against;
 *   the deck organization's (`buildMergedSlideTypes`) so the text fields of a
 *   database type are known and its translations travel
 * @returns {Object} the portable deck
 */
export function presentationToDeck(pres, { slideTypes = SLIDE_TYPES } = {}) {
  const lang =
    normalizeLang(pres?.i18n?.dominant) || normalizeLang(pres?.lang) || null;
  const base = lang
    ? pickVersion(pres, lang)
    : {
        title: typeof pres?.title === 'string' ? pres.title : '',
        slides: Array.isArray(pres?.slides) ? pres.slides : [],
      };
  const others = lang
    ? existingVersionLangs(pres)
        .filter((l) => l !== lang)
        .map((l) => {
          const version = pickVersion(pres, l);
          const byId = new Map(
            version.slides
              .filter((s) => typeof s?.id === 'string' && s.id)
              .map((s) => [s.id, s]),
          );
          return { lang: l, version, byId };
        })
    : [];

  const slides = base.slides.map((s, index) => {
    const entry = {
      type: canonicalSlideType(s?.type),
      content: s?.content || {},
    };
    const spec = textFieldSpecForType(s?.type, slideTypes);
    const translations = {};
    for (const { lang: l, version, byId } of others) {
      const match = matchingSlide(s, index, version.slides, byId);
      if (!match) continue;
      const tr = contentTranslation(spec, s?.content, match.content);
      if (typeof match.notes === 'string' && match.notes)
        tr.notes = match.notes;
      if (Object.keys(tr).length) translations[l] = tr;
    }
    if (Object.keys(translations).length) entry.translations = translations;
    if (typeof s?.notes === 'string' && s.notes) entry.notes = s.notes;
    const duration = portableDuration(s?.duration);
    if (duration !== null) entry.duration = duration;
    const visibility = portableVisibility(s?.visibility);
    if (visibility) entry.visibility = visibility;
    return entry;
  });

  const deck = {
    format: DECK_FORMAT_ID,
    version: 1,
    title: base.title || pres?.title || 'Untitled presentation',
  };
  if (lang) deck.lang = lang;
  const titles = {};
  for (const { lang: l, version } of others) {
    if (version.title) titles[l] = { title: version.title };
  }
  if (Object.keys(titles).length) deck.translations = titles;
  deck.theme = pres?.theme || 'default';
  deck.slides = slides;
  return deck;
}

/**
 * The deck language an import writes, and whether the deck's own language
 * claims can be honoured.
 *
 * The envelope `lang` is the language of `content`; a request that names a
 * different one contradicts the deck, and a deck in a language this install
 * does not author in cannot be stored as if it were another. Both are refused
 * rather than repaired (beta doctrine: refuse over silently repair). A deck
 * without `lang` takes the request's language, then the default.
 *
 * @param {Object|Array} input - a deck object, or a bare slides array
 * @param {string|null} [requestLang] - the language the request names
 * @returns {{ok: true, lang: string} | {ok: false, message: string}}
 */
export function deckImportLang(input, requestLang = null) {
  const deck = isPlainObject(input) ? input : {};
  const requested = normalizeLang(requestLang);
  let lang = requested || DEFAULT_DECK_LANG;
  if (deck.lang != null) {
    const own = normalizeLang(deck.lang);
    if (!own) {
      return {
        ok: false,
        message: `Deck language ${JSON.stringify(deck.lang)} is not supported`,
      };
    }
    if (requested && requested !== own) {
      return {
        ok: false,
        message: `Deck language "${own}" contradicts the requested language "${requested}"`,
      };
    }
    lang = own;
  }
  for (const tag of deckTranslationTags(deck)) {
    const l = normalizeLang(tag);
    if (!l) {
      return {
        ok: false,
        message: `Translation language ${JSON.stringify(tag)} is not supported`,
      };
    }
    if (l === lang) {
      return {
        ok: false,
        message: `Translation "${tag}" repeats the deck language "${lang}"`,
      };
    }
  }
  return { ok: true, lang };
}

/** Every language tag a deck names under `translations`, envelope or slide. */
function deckTranslationTags(deck) {
  const tags = new Set();
  const collect = (tr) => {
    if (isPlainObject(tr)) for (const tag of Object.keys(tr)) tags.add(tag);
  };
  collect(deck?.translations);
  for (const s of Array.isArray(deck?.slides) ? deck.slides : [])
    collect(s?.translations);
  return [...tags];
}

/**
 * The theme id a deck declares, or `'default'`.
 *
 * Exported because a caller has to know it *before* it can normalize: the
 * theme decides which background presets and slide-background variants a slide
 * composes against, so the route loads the theme first and hands it to
 * `deckToPresentationParts`. Reading `parts.theme` afterwards is too late, and
 * spelling the trim-and-fall-back rule a second time at the call site is how
 * the two drift.
 *
 * @param {Object|Array|null} [input] - a deck object, or a bare slides array
 * @returns {string}
 */
export function deckThemeId(input) {
  const raw = Array.isArray(input) ? null : input?.theme;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'default';
}

/**
 * What an imported slide's type resolves to here: the definition and the key
 * the slide is stored under, or no definition.
 *
 * A type whose definition a `.deck` bundle carries is looked up through
 * `carriedSlideTypes` (D91), never by the name on the slide: the receiving
 * organization may hold an unrelated type under the same slug, and the carried
 * definition, not the name, is what the slide means. It resolves under the key
 * the definition landed on (an existing type with this content, or an install
 * with a suffix), or — not installed — to nothing, and imports as the
 * placeholder that names the bundle.
 *
 * @param {string} type - the type as the deck names it
 * @param {Object} slideTypes
 * @param {Map<string, string|null>} carriedSlideTypes
 * @returns {{def: Object|undefined, name: string}}
 */
function importedSlideType(type, slideTypes, carriedSlideTypes) {
  const ref = carriedSlideTypes.has(type) ? carriedSlideTypes.get(type) : type;
  const def = ref ? getSlideType(ref, slideTypes) : undefined;
  const name =
    (ref && resolveSlideTypeName(ref, slideTypes)) ||
    tryParseTypeId(type)?.name ||
    type;
  return { def, name };
}

/**
 * Normalize an imported deck (JSON, markdown, Notion, AI output) into
 * presentation parts.
 *
 * Every slide is composed by `newSlide()` — import cleans the input into a
 * patch and hands it over — so a caller passes what the factory reads: the
 * loaded theme and the deck's language. Both are the caller's to know (the
 * route loads the theme, the request or manifest names the language); a guard
 * test pins that no call site leaves either out.
 *
 * @param {Object|Array} input - a deck object, or a bare slides array
 * @param {Object} [opts]
 * @param {Object} [opts.theme] - the loaded theme. Types declaring
 *   `autoBackgroundPreset` take a background from `theme.backgroundPresets`,
 *   and a theme's slide-background variants are on offer for `background`.
 * @param {string|null} [opts.lang] - the deck's language; a type declaring
 *   `defaultsByLang` composes from that variant, exactly as an editor insert.
 *   It is also the base language `translations` are read against; without it
 *   the deck's own `lang` is.
 * @param {Object} [opts.slideTypes] - the registry slide types resolve against:
 *   the importing organization's (`buildMergedSlideTypes`), so a database type
 *   it has imports as itself rather than as the placeholder
 * @param {Map<string, string|null>} [opts.carriedSlideTypes] - for each type
 *   key a `.deck` bundle carries the definition of (D91): the key it landed on
 *   in `slideTypes`, or `null` when it was not installed, in which case its
 *   placeholder says the definition is in the bundle
 * @returns {{title: string, theme: string, slides: Object[], translations: Record<string, {title: string, slides: Object[]}>}}
 *   `translations` holds one stored language version per translated language
 *   (D89); `{}` for a deck in one language.
 */
export function deckToPresentationParts(
  input,
  {
    theme: themeConfig = null,
    lang = null,
    slideTypes = SLIDE_TYPES,
    carriedSlideTypes = new Map(),
  } = {},
) {
  // Accept either the full object or a raw slides array (super simple use-case).
  // An imported deck is a read of unknown vintage, so it goes through the same
  // migration funnel as a stored one. The portable format carries no
  // `schemaVersion` (a deck exported today left the funnel already current),
  // so a hand-kept or pre-fold export runs the full chain and its legacy
  // shapes (numbered slot families, `steps`/`stages`, …) fold into the
  // canonical arrays HERE — before the per-slide default merge below, whose
  // array-seeding defaults would otherwise shadow the legacy keys and win on
  // the next storage read. On a clone: the funnel migrates in place, and the
  // caller's object is not ours to rewrite.
  const deck = migratePresentation(
    structuredClone(Array.isArray(input) ? { slides: input } : input || {}),
  );
  const title =
    typeof deck.title === 'string' && deck.title.trim()
      ? deck.title.trim()
      : 'Imported presentation';
  const theme = deckThemeId(deck);
  const slidesRaw = Array.isArray(deck.slides) ? deck.slides : [];

  const slides = slidesRaw.map((raw) =>
    normalizeDeckSlide(raw, {
      theme: themeConfig,
      lang,
      slideTypes,
      carriedSlideTypes,
    }),
  );
  rewriteSlideJumpIds(slidesRaw, slides, slideTypes);
  const baseLang = normalizeLang(lang) || normalizeLang(deck.lang) || null;
  const translations = baseLang
    ? deckTranslations(
        deck,
        slidesRaw,
        slides,
        baseLang,
        (type) => importedSlideType(type, slideTypes, carriedSlideTypes).def,
      )
    : {};
  return { title, theme, slides, translations };
}

/**
 * Every imported slide gets a fresh id (`normalizeDeckSlide` / `newSlide`),
 * so an in-deck jump written as `#slide:<old id>` (an action button, a card
 * link, a logo-wall link - any `url`-typed field, at slide level or inside an
 * `items` field's `itemFields`, via the declaration, no key list: B314) would
 * otherwise point nowhere. Build the old→new map positionally (`slidesRaw`
 * and `slides` share order and length by construction) and rewrite in place,
 * mutating `slides` before `deckTranslations` reads it so a translated
 * version inherits the same, already-correct target. The portable `.deck`
 * format carries no per-slide `id` (deck.js top-of-file note), so a `.deck`
 * import contributes nothing to the map and rewrites nothing - correct,
 * since there is no old id to resolve from. A jump to an id outside this
 * deck (or with no entry in the map) is left exactly as written.
 *
 * @param {Object[]} slidesRaw
 * @param {Object[]} slides
 * @param {Object} slideTypes
 */
function rewriteSlideJumpIds(slidesRaw, slides, slideTypes) {
  const idMap = new Map();
  slidesRaw.forEach((raw, i) => {
    if (typeof raw?.id === 'string' && raw.id && slides[i]) {
      idMap.set(raw.id, slides[i].id);
    }
  });
  if (!idMap.size) return;

  for (const slide of slides) {
    const def = slideTypes?.[slide.type];
    if (!def || !Array.isArray(def.fields) || !slide.content) continue;
    for (const field of def.fields) {
      if (field.type === 'url') {
        if (field.key in slide.content) {
          slide.content[field.key] = rewriteSlideJumpValue(
            slide.content[field.key],
            idMap,
          );
        }
        continue;
      }
      if (field.type === 'items' && Array.isArray(slide.content[field.key])) {
        const urlKeys = (field.itemFields || [])
          .filter((f) => f?.type === 'url')
          .map((f) => f.key);
        if (!urlKeys.length) continue;
        for (const item of slide.content[field.key]) {
          if (!item || typeof item !== 'object') continue;
          for (const key of urlKeys) {
            if (key in item)
              item[key] = rewriteSlideJumpValue(item[key], idMap);
          }
        }
      }
    }
  }
}

/** Rewrite one `url` value's `#slide:<id>` jump via `idMap`; anything else
 * (a web address, `#N`, an id the map does not carry) is returned unchanged. */
function rewriteSlideJumpValue(value, idMap) {
  if (typeof value !== 'string') return value;
  const jump = slideJumpTarget(value);
  if (!jump || !('id' in jump)) return value;
  const newId = idMap.get(jump.id);
  return newId ? `#slide:${newId}` : value;
}

/**
 * The stored language versions a deck's `translations` describe, one per
 * language: `{ [lang]: { title, slides } }`, the slides carrying the same ids,
 * types and machine values as the base slides and the translation's text where
 * it has some (`''` where it has none).
 *
 * A tag that does not normalize to a deck language, or that names the base
 * language, is skipped here; the import routes refuse such a deck before it
 * gets this far (`deckImportLang`). A slide that imported as the unknown-type
 * placeholder has no type to read its translation against, so every version
 * keeps the base placeholder.
 */
function deckTranslations(deck, slidesRaw, slides, baseLang, resolveType) {
  const langs = new Map(); // normalized lang -> raw tags that spell it
  for (const tag of deckTranslationTags(deck)) {
    const l = normalizeLang(tag);
    if (!l || l === baseLang) continue;
    if (!langs.has(l)) langs.set(l, []);
    langs.get(l).push(tag);
  }
  const pick = (tr, tags) => {
    if (!isPlainObject(tr)) return null;
    for (const tag of tags) if (isPlainObject(tr[tag])) return tr[tag];
    return null;
  };

  const out = {};
  for (const [l, tags] of langs) {
    const titleTr = pick(deck.translations, tags);
    out[l] = {
      title: typeof titleTr?.title === 'string' ? titleTr.title : '',
      slides: slides.map((slide, i) => {
        const raw = slidesRaw[i];
        const def = resolveType(typeof raw?.type === 'string' ? raw.type : '');
        const { notes, ...contentTr } = pick(raw?.translations, tags) || {};
        return {
          ...slide,
          content: def
            ? applyContentTranslation(
                textFieldSpec(def.fields),
                slide.content,
                contentTr,
              )
            : structuredClone(slide.content),
          notes: typeof notes === 'string' ? notes : '',
        };
      }),
    };
  }
  return out;
}

function normalizeDeckSlide(
  raw,
  { theme = null, lang = null, slideTypes, carriedSlideTypes },
) {
  const type = typeof raw?.type === 'string' ? raw.type : '';
  // Resolve by identity so any spelling imports — a qualified ref
  // (core/title-slide, acme/hero) or the canonical reverse-DNS id
  // (eu.deckyard.slide.title). Storage keeps the registry key, so downstream
  // bare lookups keep working and no deck is rewritten by the rename.
  const { def, name: localName } = importedSlideType(
    type,
    slideTypes,
    carriedSlideTypes,
  );
  if (!def) {
    // Unknown types become a real content-slide so the imported deck stays
    // editable and saveable (an unregistered type would be neither). The
    // archived-slide contract still applies to what that placeholder SAYS: it
    // names the type, says whether it was deliberately removed and what
    // replaces it, and carries the original content across as text. Import is
    // the one surface that persists rather than renders, so dropping the
    // content here would lose it for good.
    const { title, body } = unresolvedSlideAsMarkdown(
      { type: localName, content: raw?.content },
      { definitionInBundle: carriedSlideTypes.get(type) === null },
    );
    return withSlideKeys(
      {
        id: cryptoUuid(),
        type: 'content-slide',
        content: { title, body, background: 'mist' },
      },
      raw,
    );
  }

  // Import cleans; it does not compose. What this builds is a *patch* over the
  // type's defaults, which `newSlide()` then composes into a slide — so an
  // imported slide of type T and a freshly inserted one of type T come out of
  // the same factory. Every "don't blank a required field" rule below is
  // expressed by leaving the key out of the patch: an omitted key keeps the
  // type's default, and does so for the deck's language too.
  const contentIn =
    raw?.content && typeof raw.content === 'object' ? raw.content : {};
  const patch = {};

  const fieldByKey = new Map((def.fields || []).map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(contentIn)) {
    const field = fieldByKey.get(k);
    if (!field) {
      // Allow unknown keys (forward-compatible), but ignore explicit null/undefined.
      if (v != null) patch[k] = v;
      continue;
    }

    // Normalize by field type/requirements so imports (and AI outputs) can't break validation.
    if (field.type === 'enum') {
      if (
        typeof v === 'string' &&
        allowedEnumValues(field, theme).includes(v)
      ) {
        patch[k] = v;
      }
      continue;
    }
    if (field.type === 'image') {
      if (typeof v === 'string' && v.trim()) patch[k] = v.trim();
      // If missing/empty, keep default (prevents required image fields from being blanked)
      continue;
    }
    if (field.type === 'images') {
      if (Array.isArray(v)) {
        const cleaned = v
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => x.trim());
        const limited = field.maxItems
          ? cleaned.slice(0, field.maxItems)
          : cleaned;
        if (field.required && limited.length === 0) continue; // don't blank required fields
        patch[k] = limited;
      }
      continue;
    }
    if (isTextField(field)) {
      if (typeof v !== 'string') continue;
      const t = v;
      if (field.required && !t.trim()) continue; // don't blank required fields
      patch[k] = t;
      continue;
    }

    // Fallback: accept non-null values.
    if (v != null) patch[k] = v;
  }

  // An enum value that is not on offer drops out of the patch rather than being
  // rewritten to `def.defaults[key]`: dropping it is what "fall back to the
  // default" means once the factory owns the defaults, and it falls back to the
  // per-language default where the type declares one.
  for (const field of def.fields) {
    if (
      field.type === 'enum' &&
      patch[field.key] != null &&
      !allowedEnumValues(field, theme).includes(patch[field.key])
    ) {
      delete patch[field.key];
    }
  }

  // Nothing is composed here. Whether the slide takes a theme background is the
  // type's declaration (`autoBackgroundPreset`, read by the factory) — import
  // used to seed the core title slide by name on top of that, a second rule
  // for one question, retired with D92.
  const slide = newSlide({
    type: localName,
    theme,
    lang,
    content: patch,
    slideTypes: { [localName]: def },
  });

  return withSlideKeys(
    { id: slide.id, type: localName, content: slide.content },
    raw,
  );
}

/**
 * The envelope-level slide keys an imported slide keeps: `notes`, `duration`
 * and `visibility`, cleaned the way export writes them. Their meaning does not
 * depend on the type, so a placeholder keeps them too.
 */
function withSlideKeys(slide, raw) {
  const out = {
    ...slide,
    notes: typeof raw?.notes === 'string' ? raw.notes : '',
    visibility: portableVisibility(raw?.visibility) || {},
  };
  const duration = portableDuration(raw?.duration);
  if (duration !== null) out.duration = duration;
  return out;
}

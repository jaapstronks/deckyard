import { cryptoUuid } from './helpers.js';
import { newSlide } from './presentation.js';
import { allowedEnumValues } from './field-types.js';
import { isTextField } from './text-fields.js';
import {
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
// - `slides` is an array of `{ type, content }`
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

export function presentationToDeck(pres) {
  const slides = (pres?.slides || []).map((s) => ({
    type: canonicalSlideType(s?.type),
    content: s?.content || {},
  }));
  return {
    format: DECK_FORMAT_ID,
    version: 1,
    title: pres?.title || 'Untitled presentation',
    theme: pres?.theme || 'default',
    slides,
  };
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
 */
export function deckToPresentationParts(
  input,
  { theme: themeConfig = null, lang = null } = {},
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
    normalizeDeckSlide(raw, { theme: themeConfig, lang }),
  );
  return { title, theme, slides };
}

function normalizeDeckSlide(raw, { theme = null, lang = null } = {}) {
  const type = typeof raw?.type === 'string' ? raw.type : '';
  // Resolve by identity so any spelling imports — a qualified ref
  // (core/title-slide, acme/hero) or the canonical reverse-DNS id
  // (eu.deckyard.slide.title). Storage keeps the registry key, so downstream
  // bare lookups keep working and no deck is rewritten by the rename.
  const def = getSlideType(type);
  const localName =
    resolveSlideTypeName(type) || tryParseTypeId(type)?.name || type;
  if (!def) {
    // Unknown types become a real content-slide so the imported deck stays
    // editable and saveable (an unregistered type would be neither). The
    // archived-slide contract still applies to what that placeholder SAYS: it
    // names the type, says whether it was deliberately removed and what
    // replaces it, and carries the original content across as text. Import is
    // the one surface that persists rather than renders, so dropping the
    // content here would lose it for good.
    const { title, body } = unresolvedSlideAsMarkdown({
      type: localName,
      content: raw?.content,
    });
    return {
      id: cryptoUuid(),
      type: 'content-slide',
      content: { title, body, background: 'mist' },
    };
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

  return { id: slide.id, type: localName, content: slide.content };
}

import { cryptoUuid } from './helpers.js';
import { pickBackgroundPreset } from '../theme-background-presets.js';
import { resolveTitleSlideBackground } from './title-slide-background.js';
import {
  collectSlideTypeManifest,
  getSlideType,
} from './registry.js';
import { tryParseTypeId } from './type-id.js';

// --------
// Portable deck format (for export/import)
//
// This is intentionally readable and stable:
// - No UUIDs/timestamps required
// - `slides` is an array of `{ type, content }`
//
// Example:
// {
//   "format": "slidecreator.deck",
//   "version": 1,
//   "title": "My deck",
//   "theme": "default",
//   "slideTypes": { "title-slide": "core/title-slide" },
//   "slides": [
//     { "type": "title-slide", "content": { "title": "...", "subtitle": "", "background": "lime" } }
//   ]
// }
//
// `slideTypes` records which slide-type DEFINITIONS this deck was written
// against, as a map of the bare type key -> its `namespace/name[@version]`
// identity. It is recomputed from the registry on every export (never
// hand-maintained, so it can't drift) and lets a second implementation see
// which type definitions/versions a deck needs. `slides[].type` stays the bare
// key for back-compat.
// --------

export function presentationToDeck(pres) {
  const slides = (pres?.slides || []).map((s) => ({
    type: s?.type,
    content: s?.content || {},
  }));
  return {
    format: 'slidecreator.deck',
    version: 1,
    title: pres?.title || 'Untitled presentation',
    theme: pres?.theme || 'default',
    slideTypes: collectSlideTypeManifest(slides),
    slides,
  };
}

/**
 * Normalize an imported deck (JSON, markdown, Notion, AI output) into
 * presentation parts.
 *
 * @param {Object|Array} input - a deck object, or a bare slides array
 * @param {Object} [opts]
 * @param {Object} [opts.theme] - the loaded theme, when the caller has one.
 *   Title slides without a background image take one from
 *   `theme.backgroundPresets`; without a theme they stay empty.
 */
export function deckToPresentationParts(input, { theme: themeConfig = null } = {}) {
  // Accept either the full object or a raw slides array (super simple use-case).
  const deck = Array.isArray(input) ? { slides: input } : input || {};
  const title =
    typeof deck.title === 'string' && deck.title.trim()
      ? deck.title.trim()
      : 'Imported presentation';
  const theme =
    typeof deck.theme === 'string' && deck.theme.trim()
      ? deck.theme.trim()
      : 'default';
  const slidesRaw = Array.isArray(deck.slides) ? deck.slides : [];

  const slides = slidesRaw.map((raw) => normalizeDeckSlide(raw, themeConfig));
  return { title, theme, slides };
}

function enumOptionValues(field) {
  const opts = Array.isArray(field?.options) ? field.options : [];
  return opts
    .map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object' && o.value != null) return String(o.value);
      return '';
    })
    .filter(Boolean);
}

function normalizeDeckSlide(raw, theme = null) {
  const type = typeof raw?.type === 'string' ? raw.type : '';
  // Resolve by identity so a qualified ref (core/title-slide, acme/hero) imports;
  // storage keeps the bare local name so downstream bare lookups keep working.
  const def = getSlideType(type);
  const localName = tryParseTypeId(type)?.name || type;
  if (!def) {
    // Unknown types are preserved as a harmless placeholder so imports never crash.
    return {
      id: cryptoUuid(),
      type: 'content-slide',
      content: {
        title: 'Unknown slide type',
        body: `This deck contains an unknown slide type: ${type || '(missing)'}`,
        background: 'mist',
      },
    };
  }

  const contentIn =
    raw?.content && typeof raw.content === 'object' ? raw.content : {};
  const content = structuredClone(def.defaults || {});

  // Merge input content into defaults, but never overwrite required fields with "empty" values.
  const fieldByKey = new Map((def.fields || []).map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(contentIn)) {
    const field = fieldByKey.get(k);
    if (!field) {
      // Allow unknown keys (forward-compatible), but ignore explicit null/undefined.
      if (v != null) content[k] = v;
      continue;
    }

    // Normalize by field type/requirements so imports (and AI outputs) can't break validation.
    if (field.type === 'enum') {
      const allowed = enumOptionValues(field);
      if (typeof v === 'string' && allowed.includes(v)) content[k] = v;
      continue;
    }
    if (field.type === 'image') {
      if (typeof v === 'string' && v.trim()) content[k] = v.trim();
      // If missing/empty, keep default (prevents required image fields from being blanked)
      continue;
    }
    if (field.type === 'images') {
      if (Array.isArray(v)) {
        const cleaned = v
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => x.trim());
        const limited = field.maxItems ? cleaned.slice(0, field.maxItems) : cleaned;
        if (field.required && limited.length === 0) continue; // don't blank required fields
        content[k] = limited;
      }
      continue;
    }
    if (
      field.type === 'string' ||
      field.type === 'markdown' ||
      field.type === 'csv'
    ) {
      if (typeof v !== 'string') continue;
      const t = v;
      if (field.required && !t.trim()) continue; // don't blank required fields
      content[k] = t;
      continue;
    }

    // Fallback: accept non-null values.
    if (v != null) content[k] = v;
  }

  // Light normalization for enums (avoid validation failures)
  for (const field of def.fields) {
    if (
      field.type === 'enum' &&
      content[field.key] != null &&
      !enumOptionValues(field).includes(content[field.key])
    ) {
      content[field.key] = (def.defaults || {})[field.key];
    }
  }

  // Type-specific normalization for back-compat and better defaults.
  if (localName === 'title-slide') {
    // Seed a theme background on the canonical key only when the slide has no
    // background at all (canonical or legacy). An imported deck that still
    // carries a legacy bgImage is left as-is — it renders via the fallback and
    // migrates on edit — so we never stack a preset on top of it.
    if (resolveTitleSlideBackground(content).source === 'none') {
      const preset = pickBackgroundPreset(theme);
      if (preset) content.slideBgImage = preset;
    }
  }
  if (localName === 'poll-slide') {
    // pollId is required at runtime for interaction state. Deck imports (including AI output)
    // may omit it, so we ensure it exists here (mirrors newSlide()).
    const pollId =
      typeof content.pollId === 'string' ? content.pollId.trim() : '';
    if (!pollId) content.pollId = cryptoUuid();
  }

  return { id: cryptoUuid(), type: localName, content };
}

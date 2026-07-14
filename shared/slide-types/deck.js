import { cryptoUuid, pickRandom, TITLE_BG_PRESETS } from './helpers.js';
import { SLIDE_TYPES } from './registry.js';

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
//   "slides": [
//     { "type": "title-slide", "content": { "title": "...", "subtitle": "", "background": "lime" } }
//   ]
// }
// --------

export function presentationToDeck(pres) {
  return {
    format: 'slidecreator.deck',
    version: 1,
    title: pres?.title || 'Untitled presentation',
    theme: pres?.theme || 'default',
    slides: (pres?.slides || []).map((s) => ({
      type: s?.type,
      content: s?.content || {},
    })),
  };
}

export function deckToPresentationParts(input) {
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

  const slides = slidesRaw.map((raw) => normalizeDeckSlide(raw));
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

function normalizeDeckSlide(raw) {
  const type = typeof raw?.type === 'string' ? raw.type : '';
  const def = SLIDE_TYPES[type];
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
    if (field.type === 'string' || field.type === 'markdown') {
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
  if (type === 'title-slide') {
    const bgImage = typeof content.bgImage === 'string' ? content.bgImage.trim() : '';
    if (!bgImage) content.bgImage = pickRandom(TITLE_BG_PRESETS);
  }
  if (type === 'poll-slide') {
    // pollId is required at runtime for interaction state. Deck imports (including AI output)
    // may omit it, so we ensure it exists here (mirrors newSlide()).
    const pollId =
      typeof content.pollId === 'string' ? content.pollId.trim() : '';
    if (!pollId) content.pollId = cryptoUuid();
  }

  return { id: cryptoUuid(), type, content };
}

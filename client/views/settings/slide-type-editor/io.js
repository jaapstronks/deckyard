/**
 * Import / export of custom slide-type definitions.
 *
 * A definition is exported as a small self-describing JSON envelope so an import
 * can recognise it (and reject unrelated JSON) without guessing. Only the
 * portable half of a type travels: the shape (label, base type, fields,
 * defaults, template, CSS) but never install-specific identity (id, org, audit
 * columns, sort order) or publish state — imports always land as an unpublished
 * draft the user reviews and publishes explicitly.
 */

/** Envelope marker written to every exported file. */
export const SLIDE_TYPE_ENVELOPE = 'deckyard-custom-slide-type';
export const SLIDE_TYPE_ENVELOPE_VERSION = 1;

/** The fields that make up a portable definition, in a stable order. */
const PORTABLE_KEYS = ['label', 'baseType', 'fields', 'defaults', 'defaultsByLang', 'template', 'css'];

/**
 * Reduce a full custom slide-type record to its portable definition.
 * @param {Object} ct - A custom slide type as returned by the API.
 * @returns {Object} definition with only the portable keys present.
 */
export function toPortableDefinition(ct) {
  const def = {};
  for (const key of PORTABLE_KEYS) {
    if (ct?.[key] !== undefined && ct?.[key] !== null) def[key] = ct[key];
  }
  return def;
}

/**
 * Serialize a custom slide type to a pretty-printed envelope string.
 * @param {Object} ct
 * @returns {string}
 */
export function serializeSlideType(ct) {
  return JSON.stringify(
    {
      [SLIDE_TYPE_ENVELOPE]: SLIDE_TYPE_ENVELOPE_VERSION,
      definition: toPortableDefinition(ct),
    },
    null,
    2
  );
}

/**
 * Turn a `.slidetype.json` string back into a definition, tolerating both the
 * envelope and a bare definition object (so a hand-written or older file still
 * imports). Validates only the minimum the create endpoint also requires: a
 * non-empty label and a fields array.
 *
 * @param {string} text - Raw file contents.
 * @returns {{ ok: true, definition: Object } | { ok: false, reason: string }}
 */
export function parseImportedSlideType(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_shape' };
  }

  // Envelope form: { 'deckyard-custom-slide-type': 1, definition: {...} }.
  // Bare form: the definition object itself (has a label).
  const raw =
    parsed.definition && typeof parsed.definition === 'object'
      ? parsed.definition
      : parsed;

  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label) return { ok: false, reason: 'missing_label' };
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    return { ok: false, reason: 'missing_fields' };
  }

  return { ok: true, definition: toPortableDefinition({ ...raw, label }) };
}

/**
 * Slugify a label the same way the editor and server do, so a client-derived
 * slug matches what the server would generate.
 * @param {string} label
 * @returns {string}
 */
export function slugifyLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Derive a slug from `label` that does not collide with any slug in
 * `existingSlugs`, appending `-2`, `-3`, … when needed. Deterministic, so an
 * import never has to interpret a server error string to handle a name clash.
 *
 * @param {string} label
 * @param {Iterable<string>} existingSlugs
 * @returns {string}
 */
export function deriveUniqueSlug(label, existingSlugs) {
  const taken = new Set(existingSlugs);
  const base = slugifyLabel(label) || 'custom-type';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`.slice(0, 80);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`.slice(0, 80);
}

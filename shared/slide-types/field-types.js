import { isNonEmptyString, safeHref, slideJumpTarget } from './helpers.js';
import {
  SLIDE_BG_ID_RE,
  mergeBackgroundOptions,
} from '../theme-slide-backgrounds.js';

/**
 * The single declared vocabulary of inspector field types.
 *
 * Every `field.type` used in a slide-type definition's `fields[]` (and in
 * `itemFields[]`) MUST be one of the keys below. This registry is the single
 * source of truth that validation, the editor field-renderer and the developer
 * docs all read from - replacing the three hand-synced `if (field.type === …)`
 * chains that had silently drifted apart (see the datamodel-purity audit,
 * move 1a). The drift test in `tests/field-types.test.js` fails the build if a
 * definition introduces an unknown type or the docs stop matching this list.
 *
 * NOT part of this vocabulary: the enum VALUES an item's own `type` property
 * may take inside an `items[]` field (e.g. `'text'`, `'heading'`, `'image'`).
 * Those are content values, not `field.type` values. The datamodel-purity audit
 * conflated the two; they are deliberately kept separate here.
 *
 * Each entry carries:
 * - `label`       - short human name (docs / tooling).
 * - `description` - what the field stores and how it renders (docs source).
 * - `docExtra`    - the "Extra Properties" the field honours (docs source).
 * - `valueKind`   - coarse JSON value shape, for JSON-Schema generation (PR 3).
 * - `validate`    - `(value, field) => string[]`, the full validation for a
 *   content value of this type, returning complete error messages.
 */

/** Normalised list of allowed values for an `enum` field's `options`. */
export function enumOptionValues(field) {
  const opts = Array.isArray(field?.options) ? field.options : [];
  return opts
    .map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object' && o.value != null) return String(o.value);
      return null; // Mark invalid entries as null
    })
    .filter((v) => v !== null); // Filter out null but keep empty strings
}

/**
 * The values an `enum` field actually accepts in a deck, theme included.
 *
 * `background` is the one field whose option list is not closed by the
 * definition alone: a theme may declare slide-background variants, and every
 * surface that asks "is this value on offer" must offer their union — the
 * editor's picker, the agent-facing schema, and the import funnel. Without a
 * theme in hand the declared options are the answer.
 *
 * @param {Object} field - a field schema
 * @param {Object} [theme] - the loaded theme, when the caller has one
 * @returns {string[]}
 */
export function allowedEnumValues(field, theme) {
  if (field?.key === 'background' && theme) {
    return mergeBackgroundOptions(field.options, theme.slideBackgrounds).map(
      (o) => o.value,
    );
  }
  return enumOptionValues(field);
}

/** A value is "present" (not cleared) when it is neither null/undefined nor ''. */
function isPresentValue(v) {
  return v != null && v !== '';
}

function pathOf(field) {
  return `Slide.content.${field?.key}`;
}

/** string / markdown / csv / code all store a plain string. */
function validateText(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isNonEmptyString(val))
    errors.push(`${path} is required`);
  // Optional text fields may be missing/null in older decks or external
  // integrations. Only enforce the string type when a value is present.
  if (val != null && typeof val !== 'string')
    errors.push(`${path} must be a string`);
  if (
    field.maxLength &&
    typeof val === 'string' &&
    val.length > field.maxLength
  ) {
    errors.push(`${path} exceeds max length (${field.maxLength})`);
  }
  return errors;
}

function validateNumber(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isPresentValue(val))
    errors.push(`${path} is required`);
  // Accept a real number or a finite numeric string (older decks/integrations
  // sometimes store "50"); reject anything that is not coercible.
  if (isPresentValue(val)) {
    const ok =
      (typeof val === 'number' && Number.isFinite(val)) ||
      (typeof val === 'string' &&
        val.trim() !== '' &&
        Number.isFinite(Number(val)));
    if (!ok) errors.push(`${path} must be a number`);
  }
  return errors;
}

function validateBoolean(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isPresentValue(val))
    errors.push(`${path} is required`);
  // Cleared boolean fields use the repo's '' convention (like enums); only a
  // present non-empty value must be an actual boolean.
  if (val != null && val !== '' && typeof val !== 'boolean') {
    errors.push(`${path} must be a boolean`);
  }
  return errors;
}

function validateUrl(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isNonEmptyString(val))
    errors.push(`${path} is required`);
  if (val != null && typeof val !== 'string') {
    errors.push(`${path} must be a string`);
    return errors;
  }
  if (
    field.maxLength &&
    typeof val === 'string' &&
    val.length > field.maxLength
  ) {
    errors.push(`${path} exceeds max length (${field.maxLength})`);
  }
  // A present value must be a link we would actually render: http(s)/mailto, a
  // root-/protocol-relative path, or a jump to a slide of this deck. Rejects
  // javascript:/data: so a stored value can never become a live XSS sink when
  // the projection emits <a href>, and a bare domain, which a document cannot
  // tell from a relative path.
  if (
    typeof val === 'string' &&
    val.trim() !== '' &&
    !safeHref(val) &&
    !slideJumpTarget(val)
  ) {
    errors.push(
      `${path} must be an http(s), mailto, or root-relative URL, or a slide jump (#slide:<id>, #N)`,
    );
  }
  return errors;
}

/**
 * The shape an `email` value must have: one `@` with something on both sides
 * and a dot in the domain, no whitespace. Deliberately coarse: the point is a
 * `mailto:` that goes somewhere, not RFC 5322.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Is this a usable e-mail address? The validator and the projection ask the
 * same question, so a value the editor accepts is a value the reader links.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmailAddress(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function validateEmail(val, field) {
  const errors = validateText(val, field);
  if (typeof val === 'string' && val.trim() !== '' && !isEmailAddress(val)) {
    errors.push(`${pathOf(field)} must be an email address`);
  }
  return errors;
}

/**
 * Field types whose value is a link target, and therefore validated wherever
 * it sits: a `url` inside an item is the same promise as one on the slide.
 */
const LINK_FIELD_TYPES = new Set(['url', 'email']);

function validateColor(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isPresentValue(val))
    errors.push(`${path} is required`);
  // Colours are stored as a theme token or a raw string; we only guard the
  // coarse type here (format varies by theme/picker).
  if (val != null && val !== '' && typeof val !== 'string') {
    errors.push(`${path} must be a string`);
  }
  return errors;
}

function validateEnum(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isNonEmptyString(val))
    errors.push(`${path} is required`);
  const allowed = enumOptionValues(field);
  // The background field also accepts theme-defined variant ids
  // (theme.slideBackgrounds - see shared/theme-slide-backgrounds.js).
  // Validation has no theme context, so any safe slug passes; unknown ids
  // render as an inert class and fall back to the default background.
  const isThemeBgVariant =
    field.key === 'background' &&
    typeof val === 'string' &&
    SLIDE_BG_ID_RE.test(val);
  // Cleared enum fields use the repo's '' convention: empty = unset / follow the
  // type default. Required enums still reject '' via the required check above.
  if (
    val != null &&
    val !== '' &&
    !allowed.includes(val) &&
    !isThemeBgVariant
  ) {
    errors.push(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return errors;
}

function validateImage(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && !isNonEmptyString(val))
    errors.push(`${path} is required`);
  // A single image is a URL/reference string.
  if (val != null && typeof val !== 'string')
    errors.push(`${path} must be a string`);
  return errors;
}

function validateImages(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (
    field.required &&
    (!Array.isArray(val) || val.filter((v) => isNonEmptyString(v)).length === 0)
  ) {
    errors.push(`${path} is required`);
  }
  // Skip value checks when missing (back-compat for decks without this field).
  if (val == null) return errors;
  if (!Array.isArray(val)) {
    errors.push(`${path} must be an array`);
    return errors;
  }
  const bad = val.filter((v) => typeof v !== 'string' || !v.trim());
  if (bad.length) errors.push(`${path} must be an array of non-empty strings`);
  if (field.maxItems && val.length > field.maxItems) {
    errors.push(`${path} must have at most ${field.maxItems} items`);
  }
  return errors;
}

function validateItems(val, field) {
  const errors = [];
  const path = pathOf(field);
  if (field.required && (!Array.isArray(val) || val.length === 0)) {
    errors.push(`${path} is required`);
  }
  // Skip value checks when missing (back-compat for decks without this field).
  if (val == null) return errors;
  if (!Array.isArray(val)) {
    errors.push(`${path} must be an array`);
    return errors;
  }
  const minItems = Math.max(0, Number(field.minItems || 0) || 0);
  const maxItems = Number(field.maxItems || 0) || 0;
  if (minItems && val.length < minItems) {
    errors.push(`${path} must have at least ${minItems} items`);
  }
  if (maxItems && val.length > maxItems) {
    errors.push(`${path} must have at most ${maxItems} items`);
  }
  const itemFields = Array.isArray(field.itemFields) ? field.itemFields : [];
  for (let i = 0; i < val.length; i += 1) {
    const it = val[i];
    if (!it || typeof it !== 'object') {
      errors.push(`${path}[${i}] must be an object`);
      continue;
    }
    for (const f of itemFields) {
      if (!f || typeof f.key !== 'string') continue;
      const iv = it[f.key];
      if (f.required && !isNonEmptyString(iv)) {
        errors.push(`${path}[${i}].${f.key} is required`);
      }
      // A link type validates in full at any depth: its value becomes an
      // `href`, and a sub-field that skipped the check would be the one place
      // a `javascript:` target could be stored. The rest of nested item
      // validation stays shallow (string only).
      if (LINK_FIELD_TYPES.has(f.type)) {
        const prefix = pathOf(f);
        for (const e of FIELD_TYPES[f.type].validate(iv, {
          ...f,
          required: false,
        })) {
          errors.push(`${path}[${i}].${f.key}${e.slice(prefix.length)}`);
        }
      }
      if (f.type === 'string') {
        if (iv != null && typeof iv !== 'string') {
          errors.push(`${path}[${i}].${f.key} must be a string`);
        }
        if (f.maxLength && typeof iv === 'string' && iv.length > f.maxLength) {
          errors.push(
            `${path}[${i}].${f.key} exceeds max length (${f.maxLength})`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * The declared field-type vocabulary. Keys are the only valid `field.type`
 * values; everything else in the codebase reads its type knowledge from here.
 * @type {Record<string, {label: string, description: string, docExtra: string, valueKind: string, validate: (value: unknown, field: any) => string[]}>}
 */
export const FIELD_TYPES = {
  string: {
    label: 'Single-line text',
    description:
      'Single-line text. `mediaRef` marks the string as a reference to media the document cannot embed (a video source) rather than document text: the reflowable projection renders a named stand-in, linked where a link resolves, instead of printing the reference, and the field is not offered for translation — a video id is the same in every language. Three declarations pair the string with a sibling, which the projection then consumes: `unitKey` (a value and its unit read as one block, no space added), `hrefKey` (the string is the text of a link to a sibling `url`; without a target nothing projects) and `headingKey` (a sibling string is the `<h3>` over this block).',
    docExtra:
      '`maxLength`, `required`, `placeholder`, `helpText`, `mediaRef` (`{ label, linkKey }`), `unitKey`, `hrefKey`, `headingKey`',
    valueKind: 'string',
    validate: validateText,
  },
  markdown: {
    label: 'Rich text',
    description:
      'Multi-line rich text (renders to HTML; **HTML is escaped**). `headingKey` names a sibling string that heads this block in the reflowable projection, as an `<h3>`, and is consumed there.',
    docExtra: '`maxLength`, `required`, `headingKey`',
    valueKind: 'string',
    validate: validateText,
  },
  code: {
    label: 'Code',
    description:
      'Monospace textarea storing the raw string verbatim (no markdown, no escaping on input). The reflowable projection shows it as source (`<pre><code>`), unless the field declares `markup: true`: then it is author HTML the canvas renders, and the reader renders it too, through the same sanitizer, and names an untitled slide by its first `h1..h3`.',
    docExtra: '`maxLength`, `required`, `capability`, `markup`',
    valueKind: 'string',
    validate: validateText,
  },
  csv: {
    label: 'Tabular text',
    description:
      'Tabular text stored as a CSV/TSV string. Editor renders a chart-type-aware grid with a "Raw CSV" toggle (`client/views/editor/fields/csv-grid.js`); serialises to exactly the string the parser eats. Treated as a per-language, collaborative text field everywhere `markdown` is. Used by the chart `data` field.',
    docExtra: '`maxLength`, `required`, `encodingKeys`',
    valueKind: 'string',
    validate: validateText,
  },
  number: {
    label: 'Number',
    description:
      "Numeric input. A number is configuration to the reflowable projection, unless it declares `duration: { secondsKey }`: then it is the minutes of a length whose seconds sit in the named sibling, clamped to both fields' `min`/`max` (a zero length takes the declared defaults), and it projects as one `<time datetime>`.",
    docExtra: '`min`, `max`, `step`, `required`, `duration` (`{ secondsKey }`)',
    valueKind: 'number',
    validate: validateNumber,
  },
  boolean: {
    label: 'Toggle',
    description: "Boolean toggle. Cleared fields use the `''` convention.",
    docExtra: '`required`',
    valueKind: 'boolean',
    validate: validateBoolean,
  },
  enum: {
    label: 'Dropdown',
    description: 'Dropdown selection',
    docExtra: '`options` (array of strings or `{value,label}`), `required`',
    valueKind: 'string',
    validate: validateEnum,
  },
  color: {
    label: 'Colour',
    description:
      'Colour value (theme token or raw string) rendered via the colour picker',
    docExtra: '`helpText`, `required`',
    valueKind: 'string',
    validate: validateColor,
  },
  image: {
    label: 'Image',
    description:
      "Image picker (stores a URL/reference string). Its a11y siblings follow one spelling: `<key>Alt` or `alt`, `<key>Caption` or `caption`, `<key>Role` or `imageRole` (`decorative` hides it). `nameKey` names a sibling string that says what the picture shows (a logo's organisation, the author beside a portrait): the reflowable projection uses it as the alt when the alt is empty, before an item's own heading and never a caption or a filename. Publishing refuses a picture that is not decorative and has no alt at the end of that ladder.",
    // `presetSource` only reads `'backgrounds'` here; the partner-logo preset
    // list belongs to the `images` field, which is the one that renders it.
    docExtra: "`presetSource` (`'backgrounds'`), `required`, `nameKey`",
    valueKind: 'string',
    validate: validateImage,
  },
  url: {
    label: 'Link',
    description:
      'A hyperlink target (http(s), mailto, root-/protocol-relative, or a slide jump `#slide:<id>` / `#N`). Validated + allowlisted (javascript:/data: and bare domains rejected), also inside an item; projects as an `<a href>`, a slide jump as a link to that slide in the reader. Not a translatable field, so link targets are never sent to translation.',
    docExtra: '`maxLength`, `required`, `placeholder`, `helpText`',
    valueKind: 'string',
    validate: validateUrl,
  },
  email: {
    label: 'Email address',
    description:
      'An e-mail address. The editor offers an e-mail input; a present value must look like an address (also inside an item); projects as a `mailto:` link. Not a translatable field.',
    docExtra: '`maxLength`, `required`, `placeholder`, `helpText`',
    valueKind: 'string',
    validate: validateEmail,
  },
  images: {
    label: 'Images',
    description:
      'Multiple images (gallery), stored as an array of URL strings. No core type declares it since logo-wall moved to `items` (v7 -> v8); it stays as an extension point — one of the six types the custom-slide-type editor offers. URLs only: a collection that needs per-image alt text or a caption declares `items` with its own sub-fields instead.',
    docExtra: "`maxItems`, `required`, `presetSource` (`'partnerlogos'`)",
    valueKind: 'stringArray',
    validate: validateImages,
  },
  items: {
    label: 'Repeating items',
    description:
      "Repeating list of structured objects, each shaped by `itemFields`. The document projection makes it a list: an `<ol>` when `ordered: true` (order always matters) or while `orderedWhen: { field, in }` holds (the `visibleWhen` predicate on a sibling enum — a list slide in its `numbers` style), otherwise a `<ul>`. An item's heading string is an `<h3>` only when something projects below it; an item that is one line (a poll answer) is the `<li>`'s text. On a `tabular` type, `rowHeader: 'first'` makes the first column's cells `<th scope=\"row\">`.",
    docExtra:
      '`minItems`, `maxItems`, `itemFields`, `itemDefaults`, `itemDefaultsByLang`, `required`, `collapsible`, `ordered`, `orderedWhen`, `relationField`, `relationLabels`, `itemLabelField`, `columnCountKey`, `headerRowKey`, `rowHeader`, `captionKey`',
    valueKind: 'objectArray',
    validate: validateItems,
  },
};

/** All valid field-type names, as a sorted array. */
export const FIELD_TYPE_NAMES = Object.keys(FIELD_TYPES).sort();

/** Whether `type` is a declared field type. */
export function isKnownFieldType(type) {
  return (
    typeof type === 'string' &&
    Object.prototype.hasOwnProperty.call(FIELD_TYPES, type)
  );
}

/**
 * Validate a single content value against its field definition, delegating to
 * the declared type. Unknown types return no errors here (the drift test guards
 * definitions); callers stay lenient at runtime.
 * @param {unknown} value
 * @param {{type?: string, key?: string}} field
 * @returns {string[]}
 */
export function validateFieldValue(value, field) {
  const spec = field && FIELD_TYPES[field.type];
  if (!spec) return [];
  return spec.validate(value, field);
}

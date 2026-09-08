/**
 * The content schema of a slide type, derived from its `fields[]`.
 *
 * D87: strict validation is **one derivation**, not a Zod map plus two length
 * tables. Before this, `create_presentation_from_slides` checked agent content
 * against 32 hand-written schemas, a `MAX_LENGTHS` table and a three-type item
 * table — three second spellings of what `fields[]` already says. They drifted,
 * as second spellings do: 19 field places carried a length the definition
 * disagreed with, and strict refused the `example` that `get_slide_types` hands
 * out for four of thirty-three types (`list`, `poll`, `countdown`, `embed`),
 * each on a shape the registry had already folded away.
 *
 * Zod stays the engine — this directory is the only place in the tree that may
 * import it (`tests/zod-scope-guard.test.js`) — but it is no longer the
 * *source*. The source is the definition, the same one
 * `shared/slide-types/json-schema.js` publishes and `deriveAgentSchema()`
 * offers to agents. What differs is only the answer to an undeclared key: the
 * published deck schema stays lenient because stored decks carry history, while
 * an agent authoring a *new* slide gets told, so the content is not silently
 * dropped on the way to the deck.
 *
 * ## The conventions it derives
 *
 * - `required` — the key is present and, for text, not blank. A missing
 *   required field and a blank one are the same slide.
 * - `maxLength` / `min` / `max` / `minItems` / `maxItems` — read off the field.
 * - `enum` — the declared options, plus `''` when the field is optional (the
 *   repo-wide cleared-value convention). `background` additionally takes the
 *   theme's own variants, but only when the caller supplies a theme (D88):
 *   without one, this module has no way to know they exist and refusing them
 *   would be a claim it cannot back.
 * - `itemFields` — recursively, so `rows[].blocks[]` is checked as deeply as it
 *   is declared.
 * - an undeclared key is `unknown_field`, at every level. `fields[]` is not the
 *   only declaration a type makes about its content: `instanceKeys` names the
 *   keys bound to the slide instance rather than to its text (`pollId`), which
 *   is why they carry no field. They are known keys, and unconstrained —
 *   nothing but the creating code writes them. `validate-definition.js` reads
 *   the two declarations together for the same reason.
 */

import { z } from 'zod';
import {
  FIELD_TYPES,
  enumOptionValues,
} from '../../../../shared/slide-types/field-types.js';
import { mergeBackgroundOptions } from '../../../../shared/theme-slide-backgrounds.js';
import { slideInstanceKeys } from '../../../../shared/slide-types/instance-keys.js';

/** Per-definition cache. Keyed by theme, because `background` reads it. */
const cache = new WeakMap();
/** Stand-in key for "no theme", so the WeakMap can hold both branches. */
const NO_THEME = Symbol('no-theme');

/** A number, or the `''` a cleared field stores. */
function numberSchema(field) {
  let num = z.number();
  if (Number.isFinite(Number(field?.min))) num = num.min(Number(field.min));
  if (Number.isFinite(Number(field?.max))) num = num.max(Number(field.max));
  return z.union([num, z.literal('')]);
}

/**
 * The values an enum field accepts. `background` is the one field whose option
 * list is not closed by the definition alone: a theme may add slide-background
 * variants, and the editor's picker offers their union (`mergeBackgroundOptions`).
 */
function enumValues(field, theme) {
  if (field?.key === 'background' && theme) {
    return mergeBackgroundOptions(field.options, theme.slideBackgrounds).map(
      (o) => o.value,
    );
  }
  return enumOptionValues(field);
}

/** A single field's value schema, before optionality is applied. */
function valueSchema(field, theme) {
  const kind = FIELD_TYPES[field?.type]?.valueKind || 'string';
  switch (kind) {
    case 'number':
      return numberSchema(field);
    case 'boolean':
      return z.union([z.boolean(), z.literal('')]);
    case 'stringArray':
      return withArrayBounds(z.array(z.string()), field);
    case 'objectArray':
      return withArrayBounds(z.array(itemSchema(field, theme)), field);
    case 'string':
    default:
      if (field?.type === 'enum') {
        const values = enumValues(field, theme);
        // A blank enum is the cleared state, which only an optional field has.
        const accepted = field?.required ? values : [...values, ''];
        return accepted.length
          ? z.enum(Array.from(new Set(accepted)))
          : z.string();
      }
      return stringSchema(field);
  }
}

/** A string field: its declared cap, and non-blank when it is required. */
function stringSchema(field) {
  let s = z.string();
  if (Number.isFinite(Number(field?.maxLength)))
    s = s.max(Number(field.maxLength));
  if (field?.required)
    s = s.refine((v) => v.trim().length > 0, {
      error: BLANK_MESSAGE,
    });
  return s;
}

/** `minItems`/`maxItems` on an array-valued field. */
function withArrayBounds(schema, field) {
  let out = schema;
  if (Number.isFinite(Number(field?.minItems)))
    out = out.min(Number(field.minItems));
  if (Number.isFinite(Number(field?.maxItems)))
    out = out.max(Number(field.maxItems));
  return out;
}

/** One entry of an `items` field, shaped by its `itemFields`. */
function itemSchema(field, theme) {
  const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : [];
  return objectSchema(itemFields, theme);
}

/**
 * An object whose keys are exactly the given fields. Strict at every level:
 * a key the definition never declared is content the deck will not render, and
 * an agent that is told keeps its content.
 */
function objectSchema(fields, theme, extraKeys = []) {
  /** @type {Record<string, any>} */
  const shape = {};
  for (const key of extraKeys) shape[key] = z.unknown().optional();
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = typeof field?.key === 'string' ? field.key.trim() : '';
    if (!key) continue;
    const value = valueSchema(field, theme);
    shape[key] = field?.required ? value : value.optional();
  }
  return z.strictObject(shape);
}

/**
 * The Zod schema for one slide type's `content`, derived from its `fields[]`.
 *
 * Cached per definition object (and per theme), because the derivation walks
 * every field of every type and the MCP write path validates a whole deck.
 *
 * @param {Object} def - A composed slide-type definition (see `compose.js`)
 * @param {Object} [options]
 * @param {Object|null} [options.theme] - The deck's theme, when the caller has
 *   one. Only `background` reads it.
 * @returns {import('zod').ZodType}
 */
export function contentSchemaFor(def, { theme = null } = {}) {
  let byTheme = cache.get(def);
  if (!byTheme) {
    byTheme = new Map();
    cache.set(def, byTheme);
  }
  const key = theme || NO_THEME;
  let schema = byTheme.get(key);
  if (!schema) {
    schema = objectSchema(
      def?.fields,
      theme,
      Object.keys(slideInstanceKeys(def)),
    );
    byTheme.set(key, schema);
  }
  return schema;
}

/** The message a blank required field produces, so the issue stays readable. */
const BLANK_MESSAGE = 'expected a non-blank value';

/** The value a Zod issue points at, so an error can report what it got. */
function valueAt(content, path) {
  let cur = content;
  for (const step of path) {
    if (cur == null) return undefined;
    cur = cur[step];
  }
  return cur;
}

/**
 * Turn the first Zod issue into the `{ field, expected, got }` triple
 * `RawSlideValidationError` carries, in the vocabulary of the declaration that
 * produced it — `maxLength`, `minItems` — rather than Zod's own.
 *
 * @param {import('zod').core.$ZodIssue} issue
 * @param {Object} content - the content that was validated, for `got`
 * @returns {{field: string, expected: string, got: any, message: string}}
 */
export function describeIssue(issue, content) {
  const path = Array.isArray(issue?.path) ? issue.path : [];
  const at = path.join('.');
  const value = valueAt(content, path);

  switch (issue.code) {
    case 'unrecognized_keys': {
      const key = issue.keys?.[0];
      return {
        field: [...path, key].filter((p) => p !== undefined).join('.'),
        expected: 'a field this slide type declares (see get_slide_types)',
        got: key,
        message: `unknown field "${key}"`,
      };
    }
    case 'too_big':
      return issue.origin === 'array'
        ? {
            field: at,
            expected: `maxItems ${issue.maximum}`,
            got: Array.isArray(value) ? value.length : undefined,
            message: `"${at}" allows at most ${issue.maximum} items`,
          }
        : {
            field: at,
            expected: `maxLength ${issue.maximum}`,
            got: typeof value === 'string' ? value.length : undefined,
            message: `"${at}" exceeds max length (${
              typeof value === 'string' ? value.length : '?'
            } > ${issue.maximum})`,
          };
    case 'too_small':
      return issue.origin === 'array'
        ? {
            field: at,
            expected: `minItems ${issue.minimum}`,
            got: Array.isArray(value) ? value.length : undefined,
            message: `"${at}" requires at least ${issue.minimum} items`,
          }
        : {
            field: at,
            expected: `a non-blank value`,
            got: value,
            message: `"${at}" must not be blank`,
          };
    case 'invalid_value':
      return {
        field: at,
        expected: `one of: ${(issue.values || []).join(', ')}`,
        got: value,
        message: `"${at}" is not one of the values this field offers`,
      };
    case 'invalid_type':
      return {
        field: at,
        expected: String(issue.expected),
        got: value === undefined ? 'undefined' : typeof value,
        message: at
          ? `"${at}" must be ${issue.expected}`
          : `content must be ${issue.expected}`,
      };
    case 'custom':
      // The only custom rule here is `required` on a text field: Zod has no
      // "not blank", so the refine carries it.
      if (issue.message === BLANK_MESSAGE) {
        return {
          field: at,
          expected: 'a non-blank value',
          got: value,
          message: `"${at}" must not be blank`,
        };
      }
    // falls through
    default:
      return {
        field: at || 'content',
        expected: 'schema match',
        got: value,
        message: `${at || 'content'}: ${issue.message}`,
      };
  }
}

/**
 * Validate one slide's content against its type's derivation.
 *
 * Non-throwing: the fix pipeline logs what it finds and repairs what it can,
 * while `strict.js` turns the first issue into a `RawSlideValidationError`.
 * A definition it does not have cannot be checked — that is not the same as
 * valid, and the `warning` says so.
 *
 * @param {Object|undefined} def - The composed slide-type definition
 * @param {Object} content
 * @param {Object} [options]
 * @param {Object|null} [options.theme]
 * @returns {{valid: boolean, issues: Array<import('zod').core.$ZodIssue>, warning?: string}}
 */
export function validateSlideContent(def, content, { theme = null } = {}) {
  if (!def) {
    return { valid: true, issues: [], warning: 'Unknown slide type' };
  }
  const result = contentSchemaFor(def, { theme }).safeParse(content);
  if (result.success) return { valid: true, issues: [] };
  return { valid: false, issues: result.error.issues };
}

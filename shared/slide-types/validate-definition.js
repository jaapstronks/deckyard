/**
 * Slide-type DEFINITION validation — the schema of the schema.
 *
 * `validateSlide()` (presentation.js) validates a slide's CONTENT against a
 * type's `fields[]`. Nothing validated the `fields[]` themselves, so a fork's
 * file-JS type could declare a typo'd `field.type`, an `enum` with no options
 * or a `labelField` pointing nowhere, load cleanly, and then fail per slide at
 * render time — in front of an audience. `validateFieldValue()` returns `[]`
 * for an unknown type (field-types.js), which is exactly why the mistake stays
 * silent all the way to the projector.
 *
 * This module closes that hole: it turns those runtime surprises into a
 * boot-time report and a test-time failure. It does no I/O of its own, so it
 * imports on both client and server the way `field-types.js` does, and the
 * scaffolder (`scripts/new-slide-type.js`) can run it on generated source
 * before writing anything. The one thing it does beyond reading the object is
 * call the definition's OWN `renderHtml` on an empty sample, to check the root
 * class the CSS-scoping convention rests on — see {@link slideRootClass}.
 *
 * ## What it deliberately does NOT check
 *
 * - **A core-name collision without `override: true`.** `mergeSlideTypes()`
 *   already refuses that shadow and says so loudly in the same boot. Reporting
 *   it twice is a second spelling of one fact. The check exists here as the
 *   opt-in `coreNames` option instead, for the moment where it is genuinely
 *   new information: the scaffolder, deciding whether a name is available
 *   BEFORE a file exists.
 * - **Content.** A definition is valid or not regardless of any deck.
 *
 * @see docs/developer/slide-types.md
 */

import { enumOptionValues, isKnownFieldType } from './field-types.js';
import { canonicalTypeName, isValidNamespace } from './type-id.js';

/**
 * The `ai.category` vocabulary read by the custom AI catalog loader
 * (`server/utils/ai/slide-catalog/custom-loader.js`). A category outside this
 * set silently becomes `content` there, so it is a warning, not an error.
 */
const AI_CATEGORIES = [
  'structural',
  'content',
  'interactive',
  'media',
  'people',
];

/**
 * @typedef {object} DefinitionReport
 * @property {string[]} errors - Findings that make the type unusable. The
 *   loader refuses to register a definition that has any.
 * @property {string[]} warnings - Findings that degrade the type but leave it
 *   renderable (a silently-ignored property, a shadowed global field).
 */

/** True for a string with at least one non-space character. */
function isNonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Walk a JSON-ish value looking for function values.
 *
 * `inline` is serialized to the client over `/api/slide-types`, so a function
 * anywhere inside it does not travel: the descriptor arrives with the key
 * missing and the affordance quietly does not appear. Core descriptors may use
 * function-valued options (they are never serialized); a definition's own
 * `inline` may not — see docs/developer/slide-types.md § fork-safe seams.
 *
 * @param {unknown} value
 * @param {string} path - dotted path for the message.
 * @param {Set<object>} seen - cycle guard.
 * @returns {string[]} paths at which a function was found.
 */
function functionPaths(value, path, seen) {
  if (typeof value === 'function') return [path];
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      found.push(...functionPaths(v, `${path}[${i}]`, seen)),
    );
    return found;
  }
  for (const [k, v] of Object.entries(value)) {
    found.push(...functionPaths(v, `${path}.${k}`, seen));
  }
  return found;
}

/**
 * Validate one field descriptor. Shared by `fields[]` and `itemFields[]` — the
 * two levels `validateItems()` walks — so a nested field gets the same key and
 * type checks as a top-level one.
 *
 * @param {unknown} field
 * @param {string} path - e.g. `fields[2]` or `fields[2].itemFields[0]`.
 * @param {{errors: string[], warnings: string[]}} out
 * @returns {string|null} the field's key, or null when it has none.
 */
function checkField(field, path, out) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    out.errors.push(`${path} must be an object`);
    return null;
  }
  const key = isNonEmpty(field.key) ? field.key : null;
  if (!key) {
    out.errors.push(`${path}.key must be a non-empty string`);
  }
  const where = key ? `${path} (${key})` : path;
  if (!isKnownFieldType(field.type)) {
    out.errors.push(
      `${where}.type ${JSON.stringify(field.type)} is not a declared field ` +
        `type — see FIELD_TYPES in shared/slide-types/field-types.js`,
    );
    return key;
  }
  if (field.type === 'enum' && enumOptionValues(field).length === 0) {
    out.errors.push(
      `${where} is an enum with no usable options — give it \`options: [...]\` ` +
        `of strings or \`{ value, label }\` objects`,
    );
  }
  return key;
}

/**
 * The root class a slide type's `renderHtml` must put on its outermost element:
 * `slide-` plus the canonical (suffix-free) type name, so `acme-hero-slide`
 * renders `.slide-acme-hero` and `comparison-slide` renders `.slide-comparison`.
 *
 * That class is what a file-JS type's stylesheet nests under. The one place
 * the codebase scopes author CSS mechanically is the custom-html slide
 * (`scopeCss` in types/custom-html-slide.js); a fork's `custom/styles/*.css`
 * is hand-written and concatenated after all core CSS on every render path —
 * so without a root of its own, a selector there has nothing to be nested
 * under and reaches deck chrome instead. One derivation, used by the
 * scaffolder's stub, this check, and the docs.
 *
 * @param {string} name - the registry key (the bare filename for a file-JS type).
 * @returns {string}
 * @see docs/developer/slide-types.md § Add CSS
 */
export function slideRootClass(name) {
  return `slide-${canonicalTypeName(String(name || '').trim())}`;
}

/** The first element tag in a chunk of markup, or `null`. */
function firstTag(html) {
  const m = /<([a-zA-Z][\w-]*)\b[^>]*>/.exec(html);
  return m ? { tag: m[1], attrs: m[0] } : null;
}

/**
 * Warn when a rendered sample's root element does not carry
 * {@link slideRootClass}. A cheap string check, deliberately a warning: the
 * slide renders fine without it, it is the fork's *stylesheet* that loses its
 * anchor, and a type that ships no CSS at all is a legitimate shape.
 *
 * The sample is the type's own `defaults` — the nearest thing to real content
 * a definition carries. A renderer that throws or returns a non-string on it is
 * not reported here: whether empty content must render is a separate contract
 * from which class the root wears.
 *
 * @param {object} def
 * @param {string} who - the registry key, already trimmed.
 * @param {{errors: string[], warnings: string[]}} out
 */
function checkRootClass(def, who, out) {
  const sample = isPlainObject(def.defaults) ? def.defaults : {};
  let html;
  try {
    html = def.renderHtml(sample, { type: who, content: sample }, {});
  } catch {
    return;
  }
  if (typeof html !== 'string' || !html.trim()) return;
  const root = firstTag(html);
  if (!root) return;
  const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(root.attrs);
  const list = String(classes?.[1] ?? classes?.[2] ?? '').split(/\s+/);
  const want = slideRootClass(who);
  if (list.includes(want)) return;
  out.warnings.push(
    `${who}: the rendered root <${root.tag}> does not carry \`${want}\` ` +
      `(it has ${classes ? JSON.stringify(classes[1] ?? classes[2]) : 'no class'}) ` +
      `— every slide type scopes its CSS under that one root class, so ` +
      `without it a stylesheet for this type has nothing to nest under and ` +
      `its selectors reach deck chrome instead`,
  );
}

/**
 * Validate a slide-type definition — the object a `custom/slide-types/*.js`
 * file default-exports, or a core type's definition.
 *
 * Same input, same report. It calls `def.renderHtml` once on an empty sample
 * for the root-class check; a definition whose renderer throws or returns a
 * non-string on empty content simply skips that one check.
 *
 * @param {unknown} def - the definition to check.
 * @param {string} name - the registry key it would be registered under (the
 *   bare filename for a file-JS type). Used in the messages.
 * @param {object} [options]
 * @param {string[]} [options.globalFieldKeys] - `GLOBAL_SLIDE_FIELD_KEYS` from
 *   the registry. Passed in rather than imported: `registry.js` reaches the
 *   loader (and through it this module) mid-evaluation, so importing back into
 *   it would be a cycle. Omit it and the shadowing warning is simply not
 *   produced; the keys are also accepted as valid `inline` references.
 * @param {string[]} [options.coreNames] - core registry keys. Supply them to
 *   get the "this name shadows core" warning (the scaffolder does; the loader
 *   deliberately does not — see the module header).
 * @returns {DefinitionReport}
 */
export function validateSlideTypeDefinition(def, name, options = {}) {
  const errors = [];
  const warnings = [];
  const out = { errors, warnings };
  const globalFieldKeys = Array.isArray(options.globalFieldKeys)
    ? options.globalFieldKeys
    : [];
  const coreNames = Array.isArray(options.coreNames) ? options.coreNames : [];
  const who = isNonEmpty(name) ? name.trim() : '<unnamed>';

  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    errors.push(`${who}: the default export must be a slide-type object`);
    return out;
  }

  // --- The two properties without which nothing works ------------------------
  if (!isNonEmpty(def.label)) {
    errors.push(`${who}: \`label\` must be a non-empty string`);
  }
  if (typeof def.renderHtml !== 'function') {
    errors.push(
      `${who}: \`renderHtml\` must be a function — without it the type ` +
        `registers but every slide of it fails to render`,
    );
  } else {
    checkRootClass(def, who, out);
  }

  // --- fields[] --------------------------------------------------------------
  const hasFields = def.fields !== undefined && def.fields !== null;
  if (hasFields && !Array.isArray(def.fields)) {
    errors.push(`${who}: \`fields\` must be an array`);
  }
  const fields = Array.isArray(def.fields) ? def.fields : [];
  const keys = [];
  const itemsKeys = new Map(); // key -> Set of its itemFields keys
  const globals = new Set(globalFieldKeys);

  fields.forEach((field, i) => {
    const path = `${who}.fields[${i}]`;
    const key = checkField(field, path, out);
    if (key) {
      if (keys.includes(key)) {
        errors.push(`${who}: duplicate field key \`${key}\``);
      }
      keys.push(key);
      if (globals.has(key)) {
        warnings.push(
          `${who}: field \`${key}\` shadows the global slide field of the same ` +
            `name, so this type does not get the injected one — rename it ` +
            `unless the override is deliberate`,
        );
      }
    }
    if (field?.type === 'items') {
      const nested = new Set();
      if (!Array.isArray(field.itemFields)) {
        errors.push(
          `${path} (${key || '?'}) is an \`items\` field without an ` +
            `\`itemFields\` array — nothing describes the shape of an item`,
        );
      } else {
        field.itemFields.forEach((sub, j) => {
          const subKey = checkField(sub, `${path}.itemFields[${j}]`, out);
          if (!subKey) return;
          if (nested.has(subKey)) {
            errors.push(
              `${who}: duplicate item field key \`${key}[].${subKey}\``,
            );
          }
          nested.add(subKey);
        });
      }
      if (key) itemsKeys.set(key, nested);
    }
  });

  // Keys a descriptor or a defaults map may legitimately reference: the type's
  // own fields plus the globals the registry injects into every type.
  const known = new Set([...keys, ...globals]);

  // --- labelField ------------------------------------------------------------
  // A warning, not an error: every consumer falls back when the key names
  // nothing (editor-utils and semantic-projection both fall through to the
  // heuristic resolvers), so the type renders fine — only the outline label
  // degrades. Refusing a renderable type here would be stricter than the
  // error contract above.
  if (def.labelField !== undefined && def.labelField !== null) {
    if (!isNonEmpty(def.labelField) || !known.has(def.labelField)) {
      warnings.push(
        `${who}: \`labelField\` ${JSON.stringify(def.labelField)} does not ` +
          `name a field of this type, so it is ignored and the outline label ` +
          `falls back to the built-in resolvers`,
      );
    }
  }

  // --- namespace -------------------------------------------------------------
  if (def.namespace !== undefined && def.namespace !== null) {
    if (typeof def.namespace !== 'string' || !isValidNamespace(def.namespace)) {
      warnings.push(
        `${who}: \`namespace\` ${JSON.stringify(def.namespace)} is not a valid ` +
          `namespace, so the type falls back to \`custom\` — use a kebab label ` +
          `(\`acme\`) or a reverse-DNS authority (\`nl.example.slide\`)`,
      );
    }
  }

  // --- inline (JSON, serialized to the client) -------------------------------
  if (def.inline !== undefined && def.inline !== null) {
    if (typeof def.inline !== 'object' || Array.isArray(def.inline)) {
      errors.push(`${who}: \`inline\` must be an object`);
    } else {
      for (const path of functionPaths(
        def.inline,
        `${who}.inline`,
        new Set(),
      )) {
        errors.push(
          `${path} is a function — \`inline\` travels to the client as JSON, ` +
            `so a function value is dropped and its affordance never appears`,
        );
      }
      checkInline(def.inline, { who, known, itemsKeys }, out);
    }
  }

  // --- ai --------------------------------------------------------------------
  checkAi(def.ai, who, known, warnings);

  // --- defaults --------------------------------------------------------------
  // A default may also seed an instance-bound key (`instanceKeys`, e.g.
  // `poll-slide.pollId`). Those are real content keys that deliberately have no
  // field — the clone/save helpers rewrite them, no form edits them — and
  // `defaults` is where a type declares one exists at all, so they are known
  // here. Not folded into `known`: `ai.schema` or `inline` naming one is still
  // a mistake, because neither surface can reach it.
  const defaultsKnown = new Set(known);
  if (isPlainObject(def.instanceKeys)) {
    for (const key of Object.keys(def.instanceKeys)) defaultsKnown.add(key);
  }
  for (const prop of ['defaults', 'defaultsByLang']) {
    const val = def[prop];
    if (val === undefined || val === null) continue;
    if (typeof val !== 'object' || Array.isArray(val)) {
      warnings.push(
        `${who}: \`${prop}\` should be an object, so it is ignored`,
      );
      continue;
    }
    // defaultsByLang nests one level deeper: { nl: { key: value } }.
    const maps =
      prop === 'defaultsByLang'
        ? Object.values(val).filter(isPlainObject)
        : [val];
    for (const map of maps) {
      for (const key of Object.keys(map)) {
        if (!defaultsKnown.has(key)) {
          warnings.push(
            `${who}: \`${prop}\` has no field \`${key}\`, so that default is ` +
              `never applied`,
          );
        }
      }
    }
  }

  const defaults = isPlainObject(def.defaults) ? def.defaults : {};
  for (const field of fields) {
    if (!field?.required || !isNonEmpty(field.key)) continue;
    if (globals.has(field.key)) continue;
    if (!Object.prototype.hasOwnProperty.call(defaults, field.key)) {
      warnings.push(
        `${who}: required field \`${field.key}\` has no entry in \`defaults\`, ` +
          `so a freshly inserted slide of this type starts invalid`,
      );
    }
  }

  // --- name availability (opt-in; see the module header) ---------------------
  if (coreNames.includes(who) && def.override !== true) {
    warnings.push(
      `${who}: a core type already uses this name, so the registry keeps core ` +
        `and refuses this one — rename it, or declare \`override: true\` to ` +
        `replace core on purpose`,
    );
  }

  return out;
}

/** True for a non-array object. */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check the field references inside an `inline` descriptor. The grammar itself
 * lives in `client/views/editor/inline-edit/descriptors.js`; what is checkable
 * without a DOM is whether the keys it names exist.
 *
 * @param {object} inline
 * @param {{who: string, known: Set<string>, itemsKeys: Map<string, Set<string>>}} ctx
 * @param {{errors: string[], warnings: string[]}} out
 */
function checkInline(inline, { who, known, itemsKeys }, out) {
  if (inline.formText !== undefined) {
    if (!Array.isArray(inline.formText)) {
      out.errors.push(
        `${who}: \`inline.formText\` must be an array of field keys`,
      );
    } else {
      inline.formText.forEach((key, i) => {
        if (!isNonEmpty(key) || !known.has(key)) {
          out.errors.push(
            `${who}: \`inline.formText[${i}]\` ${JSON.stringify(key)} does not ` +
              `name a field of this type`,
          );
        }
      });
    }
  }

  const cards = inline.cards;
  if (cards === undefined || cards === null) return;
  if (!isPlainObject(cards)) {
    out.errors.push(`${who}: \`inline.cards\` must be an object`);
    return;
  }
  const parent = cards.field;
  if (!isNonEmpty(parent) || !known.has(parent)) {
    out.errors.push(
      `${who}: \`inline.cards.field\` ${JSON.stringify(parent)} does not name ` +
        `a field of this type`,
    );
    return;
  }
  if (!itemsKeys.has(parent)) {
    out.errors.push(
      `${who}: \`inline.cards.field\` names \`${parent}\`, which is not an ` +
        `\`items\` field — card affordances add and remove repeated items`,
    );
    return;
  }
  const child = cards.child;
  if (child === undefined || child === null) return;
  if (!isPlainObject(child)) {
    out.errors.push(`${who}: \`inline.cards.child\` must be an object`);
    return;
  }
  // A child card level writes to `<parent>.<index>.<child.field>`, so its key
  // is one of the PARENT's itemFields, not a top-level content key.
  const nested = itemsKeys.get(parent);
  if (!isNonEmpty(child.field) || !nested.has(child.field)) {
    out.errors.push(
      `${who}: \`inline.cards.child.field\` ${JSON.stringify(child.field)} is ` +
        `not an item field of \`${parent}\``,
    );
  }
}

/**
 * Check the `ai` property. Two shapes are live: `false` (this type is not
 * offered to agents) and an object of editorial metadata a custom type ships
 * for the AI catalog. Everything here is a warning — a bad `ai` block costs the
 * type its agent copy, never its rendering.
 *
 * @param {unknown} ai
 * @param {string} who
 * @param {Set<string>} known
 * @param {string[]} warnings
 */
function checkAi(ai, who, known, warnings) {
  if (ai === undefined || ai === null || ai === false) return;
  if (!isPlainObject(ai)) {
    warnings.push(
      `${who}: \`ai\` must be \`false\` (hide this type from agents) or an ` +
        `object of agent-facing copy — ${JSON.stringify(ai)} is ignored`,
    );
    return;
  }
  if (!isNonEmpty(ai.description)) {
    warnings.push(
      `${who}: \`ai\` has no \`description\`, so the whole block is dropped ` +
        `and agents never learn when to pick this type`,
    );
  }
  if (ai.category !== undefined && !AI_CATEGORIES.includes(ai.category)) {
    warnings.push(
      `${who}: \`ai.category\` ${JSON.stringify(ai.category)} is not one of ` +
        `${AI_CATEGORIES.join(' | ')}, so it falls back to \`content\``,
    );
  }
  if (ai.schema !== undefined) {
    warnings.push(
      `${who}: \`ai.schema\` is ignored — the agent-facing schema is derived ` +
        `from \`fields[]\`. Move the constraint onto the field itself, and use ` +
        `\`ai: false\` on a field agents should not fill`,
    );
    if (isPlainObject(ai.schema)) {
      for (const key of Object.keys(ai.schema)) {
        if (!known.has(key)) {
          warnings.push(
            `${who}: \`ai.schema\` names an unknown field \`${key}\``,
          );
        }
      }
    }
  }
}

/**
 * Render a report as console lines, or `[]` when the definition is clean.
 * Shared by the loader and the scaffolder so one file's findings look the same
 * wherever they surface. Every message already names its type, so nothing here
 * repeats it.
 *
 * @param {DefinitionReport} report
 * @returns {string[]}
 */
export function formatDefinitionReport(report) {
  const lines = [];
  for (const e of report?.errors || []) lines.push(`  ERROR    ${e}`);
  for (const w of report?.warnings || []) lines.push(`  WARNING  ${w}`);
  return lines;
}

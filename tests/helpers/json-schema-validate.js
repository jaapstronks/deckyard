/**
 * A small, test-only JSON Schema validator.
 *
 * Covers exactly the keywords the deck schema generator
 * (shared/slide-types/json-schema.js) emits for a content object — enough to
 * prove that generated schemas accept real slide content, and that the
 * published deck-format example conforms to the single-source schema. It is
 * deliberately not a full JSON Schema implementation (no external dependency).
 */

export function typeOk(v, t) {
  if (Array.isArray(t)) return t.some((tt) => typeOk(v, tt));
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return v != null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
}

/** Resolve a local `#/$defs/...` pointer against the root document. */
function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    if (node == null || typeof node !== 'object') return null;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node && typeof node === 'object' ? node : null;
}

/**
 * @param {object} schema
 * @param {any} value
 * @param {string} path
 * @param {string[]} errors
 * @param {object} [root] - the document `$ref`s resolve against; defaults to
 *   `schema`, which is what a caller validating one self-contained schema wants.
 */
export function validate(schema, value, path, errors, root = schema) {
  if (!schema || typeof schema !== 'object') return errors;
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    if (!target) {
      errors.push(`${path}: unresolvable $ref ${schema.$ref}`);
      return errors;
    }
    return validate(target, value, path, errors, root);
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => validate(sub, value, path, [], root).length === 0);
    if (!ok) errors.push(`${path}: no anyOf branch matched ${JSON.stringify(value)}`);
    return errors;
  }
  // The deck schema discriminates content by slide type with `allOf` of
  // `if`/`then` pairs. An unknown type matches no `if`, so no `then` applies and
  // its content is unconstrained — the behaviour that makes the schema open.
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (!sub || typeof sub !== 'object') continue;
      if (sub.if) {
        const matched = validate(sub.if, value, path, [], root).length === 0;
        const branch = matched ? sub.then : sub.else;
        if (branch) validate(branch, value, path, errors, root);
      } else {
        validate(sub, value, path, errors, root);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: ${JSON.stringify(value)} !== const ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.type && !typeOk(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${JSON.stringify(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string' && schema.maxLength != null && value.length > schema.maxLength) {
    errors.push(`${path}: exceeds maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'string' && typeof schema.pattern === 'string') {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: < minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: > maximum`);
  }
  // Keyed off the keywords, not off `type: 'object'`: the discriminator's `if`
  // subschemas are bare `{properties: {type: {const: X}}}` with no declared
  // type, and treating those as "nothing to check" would make every branch
  // match and every content schema apply at once.
  if (typeOk(value, 'object') && (schema.properties || schema.required)) {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}.${req}: required`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (v == null) continue; // absent/null == unset (matches validateSlide leniency)
      if (props[k]) validate(props[k], v, `${path}.${k}`, errors, root);
    }
  }
  if (Array.isArray(value) && (schema.items || schema.minItems != null || schema.maxItems != null)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((it, i) => validate(schema.items, it, `${path}[${i}]`, errors, root));
  }
  return errors;
}

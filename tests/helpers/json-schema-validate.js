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

export function validate(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return errors;
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => validate(sub, value, path, []).length === 0);
    if (!ok) errors.push(`${path}: no anyOf branch matched ${JSON.stringify(value)}`);
    return errors;
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
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: < minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: > maximum`);
  }
  if (typeOk(value, 'object') && schema.type === 'object') {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}.${req}: required`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (v == null) continue; // absent/null == unset (matches validateSlide leniency)
      if (props[k]) validate(props[k], v, `${path}.${k}`, errors);
    }
  }
  if (Array.isArray(value) && schema.type === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((it, i) => validate(schema.items, it, `${path}[${i}]`, errors));
  }
  return errors;
}

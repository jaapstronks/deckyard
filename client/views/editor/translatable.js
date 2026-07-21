export function translatableKeysForType({ SLIDE_TYPES, type } = {}) {
  const def = SLIDE_TYPES?.[type];
  const fields = Array.isArray(def?.fields) ? def.fields : [];
  return fields
    .filter(
      (f) => f && (f.type === 'string' || f.type === 'markdown' || f.type === 'csv')
    )
    .map((f) => String(f.key || '').trim())
    .filter(Boolean);
}

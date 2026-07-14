function safeKeyPart(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === '%') return 'pct';
  return s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function normalizeOption(opt) {
  if (typeof opt === 'string') {
    const v = String(opt);
    return { value: v, label: v, title: v, ariaLabel: v };
  }
  if (opt && typeof opt === 'object') {
    const value = String(opt.value ?? '');
    const label = String(opt.label ?? opt.title ?? value);
    const title = String(opt.title ?? opt.label ?? value);
    const ariaLabel = String(opt.ariaLabel ?? opt.label ?? title ?? value);
    return { ...opt, value, label, title, ariaLabel };
  }
  return { value: '', label: '', title: '', ariaLabel: '' };
}

function addKeysToField(prefix, field) {
  if (!field || typeof field !== 'object') return field;
  const key = String(field.key || '').trim();
  if (!key) return field;

  const base = `${prefix}.field.${key}`;
  const out = { ...field };
  if (!out.labelKey) out.labelKey = `${base}.label`;
  if (typeof out.placeholder === 'string' && !out.placeholderKey)
    out.placeholderKey = `${base}.placeholder`;
  if (typeof out.helpText === 'string' && !out.helpTextKey)
    out.helpTextKey = `${base}.help`;

  // Items fields use `itemFields` (editor-only nested fields).
  if (Array.isArray(out.itemFields)) {
    out.itemFields = out.itemFields.map((f) => {
      if (!f || typeof f !== 'object') return f;
      const ik = String(f.key || '').trim();
      if (!ik) return f;
      const next = { ...f };
      if (!next.labelKey) next.labelKey = `${base}.item.${ik}.label`;
      if (typeof next.placeholder === 'string' && !next.placeholderKey)
        next.placeholderKey = `${base}.item.${ik}.placeholder`;
      if (typeof next.helpText === 'string' && !next.helpTextKey)
        next.helpTextKey = `${base}.item.${ik}.help`;
      return next;
    });
  }

  if (Array.isArray(out.options)) {
    out.options = out.options.map((raw) => {
      const opt = normalizeOption(raw);
      const id =
        safeKeyPart(opt.value || opt.label) ||
        safeKeyPart(opt.label) ||
        'option';
      const next = { ...opt };
      if (!next.labelKey) next.labelKey = `${base}.option.${id}.label`;
      if (typeof next.title === 'string' && !next.titleKey)
        next.titleKey = `${base}.option.${id}.title`;
      if (typeof next.ariaLabel === 'string' && !next.ariaLabelKey)
        next.ariaLabelKey = `${base}.option.${id}.ariaLabel`;
      return next;
    });
  }

  if (Array.isArray(out.fields)) {
    out.fields = out.fields.map((f) => addKeysToField(base, f));
  }

  return out;
}

export function addUiI18nKeysToSlideType(type, def) {
  const t = String(type || '').trim();
  if (!t) return def;
  const d = def && typeof def === 'object' ? def : {};
  const prefix = `slideType.${t}`;
  const out = { ...d };
  if (!out.labelKey) out.labelKey = `${prefix}.label`;
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.map((f) => addKeysToField(prefix, f));
  }
  return out;
}

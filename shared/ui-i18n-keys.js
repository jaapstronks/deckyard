/**
 * The i18n key annotations the slide-type registry stamps on a definition —
 * the one place that decides WHICH `slideType.*` keys exist.
 *
 * The rule for options (B145): **an option contributes a key only for copy it
 * actually declares.** A bare-string option (`options: ['contain', 'cover']`)
 * normalizes to `label === value`, so its "English default" would be the
 * storage token — and minting a key for it asks eleven translators to
 * translate a CSS keyword. That is exactly what happened: 234 keys and 942
 * translated strings, of which `contain` became fr `contenir` ("to hold").
 *
 * So a bare string means "display the value, it is not copy" (a column count,
 * an aspect ratio, a legacy field that never renders), and copy means an
 * object that says so: `{ value: 'contain', label: 'Fit (no crop)' }`. The
 * key walker (scripts/lib/slide-type-i18n-keys.js) already assumed this and
 * its skip branch had silently gone unreachable; the two agree again.
 *
 * `title`/`ariaLabel` only earn their own key when they say something the
 * label does not — otherwise the UI falls back to the translated label
 * (client/views/editor/fields/option-copy.js), one text, one key.
 */

function safeKeyPart(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === '%') return 'pct';
  return s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

/**
 * Fold an option (string shorthand or object) into the four shapes every
 * surface reads. The one definition: the registry stamps keys through it, the
 * key walker reads English defaults from it and the editor renders from it, so
 * "what does this option say?" cannot drift between them.
 *
 * @param {string|Object} opt
 * @returns {{value: string, label: string, title: string, ariaLabel: string, labelKey?: string, titleKey?: string, ariaLabelKey?: string}}
 */
export function normalizeOption(opt) {
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

/**
 * Whether an option's `title`/`ariaLabel` slot says something of its own —
 * declared on the raw option, and different from both the label it would
 * otherwise inherit and the storage token.
 *
 * @param {string|Object} raw - the option as declared
 * @param {string} slot - 'title' or 'ariaLabel'
 * @param {{value: string, label: string}} opt - the normalized option
 * @returns {boolean}
 */
function declaresOwn(raw, slot, opt) {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw[slot];
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return !!s && s !== opt.label && s !== opt.value;
}

function addKeysToOption(base, raw) {
  const opt = normalizeOption(raw);
  const id = safeKeyPart(opt.value || opt.label) || 'option';
  const next = { ...opt };
  // Copy, not a token: the resolved label says something the stored value
  // does not. A bare string or `{ value: 'x', label: 'x' }` mints nothing.
  if (!next.labelKey && next.label && next.label !== next.value)
    next.labelKey = `${base}.option.${id}.label`;
  if (!next.titleKey && declaresOwn(raw, 'title', next))
    next.titleKey = `${base}.option.${id}.title`;
  if (!next.ariaLabelKey && declaresOwn(raw, 'ariaLabel', next))
    next.ariaLabelKey = `${base}.option.${id}.ariaLabel`;
  return next;
}

/** Stamp label/placeholder/help/option/nested keys on a field-shaped object
 *  whose key base is already resolved (used for itemFields entries). */
function addKeysWithBase(base, field) {
  const out = { ...field };
  if (!out.labelKey) out.labelKey = `${base}.label`;
  if (typeof out.placeholder === 'string' && !out.placeholderKey)
    out.placeholderKey = `${base}.placeholder`;
  if (typeof out.helpText === 'string' && !out.helpTextKey)
    out.helpTextKey = `${base}.help`;

  // Items fields use `itemFields` (editor-only nested fields). Each item
  // field gets the same treatment as a top-level field — label/placeholder/
  // help keys, option keys for item enums, and further itemFields for nested
  // collections (text-blocks rows → blocks) — under `${base}.item.${ik}`.
  if (Array.isArray(out.itemFields)) {
    out.itemFields = out.itemFields.map((f) => {
      if (!f || typeof f !== 'object') return f;
      const ik = String(f.key || '').trim();
      if (!ik) return f;
      return addKeysWithBase(`${base}.item.${ik}`, f);
    });
  }

  if (Array.isArray(out.options)) {
    out.options = out.options.map((raw) => addKeysToOption(base, raw));
  }

  return out;
}

function addKeysToField(prefix, field) {
  if (!field || typeof field !== 'object') return field;
  const key = String(field.key || '').trim();
  if (!key) return field;

  const base = `${prefix}.field.${key}`;
  const out = addKeysWithBase(base, field);

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

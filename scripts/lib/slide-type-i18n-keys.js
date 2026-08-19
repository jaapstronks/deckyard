/**
 * The one generator that turns the live slide-type registry into its `slideType.*`
 * i18n keys — labels, field labels/placeholders/help, item fields, and options.
 *
 * `i18n-sync.js` reads the registry through it to prune locale keys the registry
 * no longer produces. (`i18n-extract.js` was the second reader until B94 retired
 * it; the skip-set parameter below is the shape it left behind.)
 *
 * Keeping the walk here means "which keys does a type own?" has a single answer.
 * A departed type, field or option simply stops appearing in the returned set,
 * which is exactly what lets the sync step delete its orphaned translations.
 */

/**
 * Fold an option (string shorthand or object) into the four shapes the editor
 * reads. Mirrors the normalisation the field renderer applies at runtime, so the
 * generated keys line up with what the UI actually asks for.
 * @param {string|Object} opt
 * @returns {{value: string, label: string, title: string, ariaLabel: string, labelKey?: string, titleKey?: string, ariaLabelKey?: string}}
 */
export function normalizeOption(opt) {
  if (typeof opt === 'string') return { value: opt, label: opt, title: opt, ariaLabel: opt };
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
 * Every `slideType.*` key the registry produces, mapped to its English default.
 *
 * A field/option that declares an explicit `*Key` reuses that key verbatim
 * (some options localise through a hand-picked key rather than the generated
 * one); everything else follows the `slideType.<type>.field.<key>…` convention.
 *
 * @param {Record<string, {label?: string, labelKey?: string, fields?: Array}>} slideTypes - `SLIDE_TYPES`
 * @param {Iterable<string>} [customNames] - fork-only type names to skip (`CUSTOM_SLIDE_TYPE_NAMES`)
 * @returns {Map<string, string>} key → English default
 */
function slideTypeUiStrings(slideTypes, customNames = []) {
  const out = new Map();
  const custom = new Set(customNames || []);
  const add = (key, def) => {
    const k = String(key || '').trim();
    if (!k) return;
    if (!out.has(k)) out.set(k, String(def ?? ''));
  };

  for (const [type, def] of Object.entries(slideTypes || {})) {
    if (custom.has(type)) continue;
    add(def?.labelKey || `slideType.${type}.label`, def?.label || type);

    for (const f of Array.isArray(def?.fields) ? def.fields : []) {
      const fk = String(f?.key || '').trim();
      if (!fk) continue;
      const base = `slideType.${type}.field.${fk}`;
      add(f.labelKey || `${base}.label`, f?.label || fk);
      if (typeof f?.placeholder === 'string') add(f.placeholderKey || `${base}.placeholder`, f.placeholder);
      if (typeof f?.helpText === 'string') add(f.helpTextKey || `${base}.help`, f.helpText);

      for (const it of Array.isArray(f?.itemFields) ? f.itemFields : []) {
        const ik = String(it?.key || '').trim();
        if (!ik) continue;
        const ibase = `${base}.item.${ik}`;
        add(it.labelKey || `${ibase}.label`, it?.label || ik);
        if (typeof it?.placeholder === 'string') add(it.placeholderKey || `${ibase}.placeholder`, it.placeholder);
        if (typeof it?.helpText === 'string') add(it.helpTextKey || `${ibase}.help`, it.helpText);
      }

      for (const raw of Array.isArray(f?.options) ? f.options : []) {
        const opt = normalizeOption(raw);
        // An option only contributes keys when it names them explicitly — the
        // generated fallbacks below are the option *value*, which is a machine
        // token, not copy.
        if (!(opt?.labelKey || opt?.titleKey || opt?.ariaLabelKey)) continue;
        if (opt.labelKey) add(opt.labelKey, opt.label);
        if (opt.titleKey) add(opt.titleKey, opt.title);
        if (opt.ariaLabelKey) add(opt.ariaLabelKey, opt.ariaLabel);
      }
    }
  }
  return out;
}

/**
 * The set of `slideType.*` keys the registry currently produces. A locale key
 * matching `slideType.` but absent here is an orphan from a removed type, field
 * or option and is safe to prune.
 * @param {Record<string, Object>} slideTypes
 * @param {Iterable<string>} [customNames]
 * @returns {Set<string>}
 */
export function slideTypeUiKeys(slideTypes, customNames = []) {
  return new Set(slideTypeUiStrings(slideTypes, customNames).keys());
}

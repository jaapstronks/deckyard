/**
 * The one generator that turns the live slide-type registry into its `slideType.*`
 * i18n keys — labels, field labels/placeholders/help, options, and the same again
 * for every level of nested `itemFields`.
 *
 * `i18n-sync.js` reads the registry through it to prune locale keys the registry
 * no longer produces. It is the only reader since B94 retired `i18n-extract.js`,
 * and it walks the *whole* registry on purpose: there is no skip-set to pass,
 * so a fork type's keys can never be left out of the valid set (#499).
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
  if (typeof opt === 'string')
    return { value: opt, label: opt, title: opt, ariaLabel: opt };
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
 * @returns {Map<string, string>} key → English default
 */
function slideTypeUiStrings(slideTypes) {
  const out = new Map();
  const add = (key, def) => {
    const k = String(key || '').trim();
    if (!k) return;
    if (!out.has(k)) out.set(k, String(def ?? ''));
  };

  /**
   * Walk one level of field declarations, then recurse into `itemFields`.
   *
   * `fields[]` and `itemFields[]` are the same declaration shape (field-types.js
   * validates them against one registry), so they get one walk: an item field
   * carries options like any other, and an `items` field nested inside an item
   * (text-blocks' `rows[].blocks[]`) keeps descending. Walking only the outer
   * level is what made the prune propose deleting live keys in #938/#939.
   *
   * @param {string} base - key prefix, e.g. `slideType.<type>.field`
   * @param {Array<Object>} fields - `fields[]` or `itemFields[]`
   */
  const walkFields = (base, fields) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      const fk = String(f?.key || '').trim();
      if (!fk) continue;
      const fbase = `${base}.${fk}`;
      add(f.labelKey || `${fbase}.label`, f?.label || fk);
      if (typeof f?.placeholder === 'string')
        add(f.placeholderKey || `${fbase}.placeholder`, f.placeholder);
      if (typeof f?.helpText === 'string')
        add(f.helpTextKey || `${fbase}.help`, f.helpText);

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

      if (Array.isArray(f?.itemFields))
        walkFields(`${fbase}.item`, f.itemFields);
    }
  };

  for (const [type, def] of Object.entries(slideTypes || {})) {
    add(def?.labelKey || `slideType.${type}.label`, def?.label || type);
    walkFields(`slideType.${type}.field`, def?.fields);
  }
  return out;
}

/**
 * The set of `slideType.*` keys the registry currently produces. A locale key
 * matching `slideType.` but absent here is an orphan from a removed type, field
 * or option and is safe to prune.
 * @param {Record<string, Object>} slideTypes
 * @returns {Set<string>}
 */
export function slideTypeUiKeys(slideTypes) {
  return new Set(slideTypeUiStrings(slideTypes).keys());
}

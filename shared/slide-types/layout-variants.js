/**
 * Layout-variant helpers for the editor's layout switcher.
 *
 * A slide-type definition may declare `layoutVariants` (see
 * types/image-text-slide.js for the shape). These helpers stay type-agnostic:
 * everything is read from the definition, so forks that override a core type
 * by name bring their own variant set (or none, hiding the switcher).
 */
import { SLIDE_TYPES } from './registry.js';

/**
 * The declared layout variants for a slide type, or [] when it has none.
 * @param {Object} def - slide-type definition (SLIDE_TYPES[type])
 * @returns {Array<Object>}
 */
export function getLayoutVariants(def) {
  return Array.isArray(def?.layoutVariants) ? def.layoutVariants : [];
}

/**
 * Effective value of a content field, falling back to the definition's
 * defaults so an older slide without the field still matches its variant.
 * @param {Object} content
 * @param {Object} def
 * @param {string} key
 * @returns {string}
 */
function effectiveValue(content, def, key) {
  const v = content?.[key];
  if (v != null && v !== '') return String(v);
  const d = def?.defaults?.[key];
  return d != null ? String(d) : '';
}

/**
 * Which declared variant matches the slide's current content. Variants with
 * `convertTo` (cross-type tiles) are never active on this type; among the
 * rest the first variant whose full `set` matches wins.
 * @param {Object} slide
 * @param {Object} [def] - defaults to SLIDE_TYPES[slide.type]
 * @returns {string|null} variant id
 */
export function activeLayoutVariantId(slide, def = SLIDE_TYPES?.[slide?.type]) {
  const content = slide?.content && typeof slide.content === 'object' ? slide.content : {};
  for (const variant of getLayoutVariants(def)) {
    if (variant?.convertTo) continue;
    const set = variant?.set;
    if (!set || typeof set !== 'object' || !Object.keys(set).length) continue;
    const matches = Object.entries(set).every(
      ([key, value]) => effectiveValue(content, def, key) === String(value)
    );
    if (matches) return variant.id || null;
  }
  return null;
}

/**
 * Apply a same-type variant to the slide's content (mutates, like the other
 * editor field updates). Cross-type variants (`convertTo`) go through the
 * shared convert seam instead and are rejected here.
 * @param {Object} slide
 * @param {Object} variant
 * @returns {boolean} true when any field changed
 */
export function applyLayoutVariant(slide, variant) {
  if (!slide?.content || typeof slide.content !== 'object') return false;
  if (variant?.convertTo) return false;
  const set = variant?.set;
  if (!set || typeof set !== 'object') return false;
  let changed = false;
  for (const [key, value] of Object.entries(set)) {
    if (slide.content[key] !== value) {
      slide.content[key] = value;
      changed = true;
    }
  }
  return changed;
}

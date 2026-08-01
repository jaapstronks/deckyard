/**
 * Content NORMALIZATION — the type's own migration of a slide's stored shape
 * to its canonical one, run when the editor opens the slide.
 *
 * A definition-level hook, the same kind of thing as `renderHtml`: a function
 * on the definition module, so a fork overriding a type by name brings its own
 * and never needs a file outside its directory. (The declaration axes on
 * FIELDS — `editor`, `visibleWhen`, `formLayout`, `group` — are JSON-safe data;
 * this one is not, because migrating a shape is code. That is the same split
 * `renderHtml` already lives on.)
 *
 * Being function-valued has one consequence worth stating plainly: the editor
 * does NOT hold the registry, it holds the `/api/slide-types` response, and a
 * function cannot travel as JSON. So resolution is definition-first, bundled
 * registry second — the same "function-valued, so core-map only" rule the
 * inline descriptors already document for `focus.cropMode`. A database-defined
 * custom type therefore cannot declare one, which is correct: it has no legacy
 * shape to migrate.
 *
 * Why it exists: the legacy-to-canonical folds (`ensureImageSlideImage`,
 * `ensureImageTextImages`, `ensureContentColumnsImages`) used to run as a SIDE
 * EFFECT of rendering a per-type form. That coupled "this type is edited by a
 * hand-built form" to "this type migrates its content", so deleting the form
 * would silently have deleted the migration too. They are separate concerns and
 * are now declared separately: the type says how its content canonicalizes, the
 * editor calls it once per slide, and both editing surfaces then read canonical
 * values regardless of which widgets render.
 *
 * Contract: `normalizeContent(content)` MUTATES and must be IDEMPOTENT,
 * render-equivalent (normalizing must not change what the slide looks like,
 * only where the values live) and safe on a null/non-object argument. It runs
 * on every editor render, so it must be cheap.
 *
 *   // shared/slide-types/types/image-slide.js
 *   export default {
 *     normalizeContent: ensureImageSlideImage,
 *     …
 *   }
 */

import { SLIDE_TYPES } from '../slide-types.js';

/**
 * Run a slide type's content normalization, if it declares one.
 *
 * Degrades to a no-op — an unresolved type, a type without the hook, or a hook
 * that throws must never take the editor down with it: the slide still renders,
 * just from its un-migrated values (which every resolver already falls back to
 * by design).
 *
 * @param {string} [type] - the slide's type name (for the registry fallback)
 * @param {Object} [def] - the slide-type definition the caller holds
 * @param {Object} [content] - the slide's content object (mutated in place)
 * @returns {Object|undefined} the same content object
 */
export function normalizeSlideContent(type, def, content) {
  const own = def?.normalizeContent;
  const fn =
    typeof own === 'function' ? own : SLIDE_TYPES?.[type]?.normalizeContent;
  if (typeof fn !== 'function' || !content || typeof content !== 'object') {
    return content;
  }
  try {
    fn(content);
  } catch {
    // A broken migration must not block editing; resolvers read legacy values.
  }
  return content;
}

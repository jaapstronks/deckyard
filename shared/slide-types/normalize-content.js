/**
 * Content NORMALIZATION — a slide's stored shape folded to its canonical one,
 * run when the editor opens the slide.
 *
 * Two folds live here, and they answer different questions. The type's own
 * `normalizeContent` hook migrates its SHAPE (a flat `image` into `images[]`,
 * numbered slots into `items[]`) — code, so it is a function on the definition.
 * {@link foldUnofferedEnums} settles a VALUE against what the field declares
 * today, and needs no per-type code at all: the field's `options` are the whole
 * input, so it is one fold for every type instead of a hand-written one each.
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

import { SLIDE_TYPES } from './registry.js';
import { enumOptionValues } from './field-types.js';

/**
 * Fold every stored enum value the type no longer offers down to the value the
 * field declares it folds to.
 *
 * The declaration is `foldUnofferedTo` on an `enum` field: "a stored value
 * outside my options means this one". It exists because retiring an option is
 * not the same as retiring a field — the value stays on disk, the strict enum
 * validation still sees it, and every reader has to decide what it means. Two
 * types were answering that by hand, in their own `normalizeContent`, with the
 * retired value spelled out in each (`density: 'comfortable'` on `content-slide`
 * and `image-text-slide`). That is one meaning in two places, and it went stale
 * the moment a third type retired an option.
 *
 * Driven by the field's own `options`, so it needs no list of retired values:
 * whatever the type offers today is what a stored value is measured against.
 * Opt-in, deliberately — a field that says nothing keeps every stored value,
 * because an enum whose renderer still reads a value it no longer offers is a
 * defect to find, not a deck to rewrite silently.
 *
 * Render-equivalent by construction where it is declared today: neither
 * `content-slide` nor `image-text-slide` has a `comfortable` branch, so the
 * retired value already rendered as `auto` did. Idempotent: after one run the
 * stored value is offered, so a second run is a no-op.
 *
 * @param {Object} [def] - the slide-type definition
 * @param {Object} [content] - the slide's content object (mutated in place)
 * @returns {Object|undefined} the same content object
 */
export function foldUnofferedEnums(def, content) {
  if (!content || typeof content !== 'object') return content;
  const fields = Array.isArray(def?.fields) ? def.fields : [];
  for (const field of fields) {
    if (field?.type !== 'enum') continue;
    const target = field.foldUnofferedTo;
    if (typeof target !== 'string' || !target) continue;
    const key = typeof field.key === 'string' ? field.key : '';
    if (!key) continue;
    const stored = content[key];
    // Only a stored, non-empty string can be an unoffered option: absent and
    // '' both mean "no value", which every resolver already handles.
    if (typeof stored !== 'string' || !stored) continue;
    const offered = enumOptionValues(field);
    if (offered.includes(stored)) continue;
    // A declaration that names a value the field does not offer would fold one
    // unoffered value into another; validate-definition.js warns about it, and
    // here it is simply left alone rather than made worse.
    if (!offered.includes(target)) continue;
    content[key] = target;
  }
  return content;
}

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
  if (!content || typeof content !== 'object') return content;
  const resolved = def || SLIDE_TYPES?.[type];
  const own = def?.normalizeContent;
  const fn =
    typeof own === 'function' ? own : SLIDE_TYPES?.[type]?.normalizeContent;
  if (typeof fn === 'function') {
    try {
      fn(content);
    } catch (err) {
      // A broken migration must not block editing; resolvers read legacy values.
      // It is still a bug in the type, though, so it leaves a trace instead of
      // none — console is the one recorder shared/ has in both environments
      // (same reason as the registry's shadow warnings).
      console.warn(
        `[slide-types] normalizeContent for "${type}" threw; keeping the ` +
          `slide's stored values.`,
        err,
      );
    }
  }
  // Last, and for every type — including the ones with no hook of their own.
  // The type's hook migrates shapes; this one settles values, so it gets the
  // final word on what is stored under a declared enum.
  foldUnofferedEnums(resolved, content);
  return content;
}

/**
 * The editing companions, resolved — the `inline-edit.js` counterpart of
 * `./authoring-companions.js`.
 *
 * ## Why this lookup is not in the inspector
 *
 * `getInspectorKeepKeys()` used to read one hand-written map that lived beside
 * it in `client/views/editor/editor-form/inspector-form.js`, so "which fields
 * does the inspector keep for this type" had exactly one possible answer:
 * core's. A slide type from `custom/slide-types/` — the fork seam that already
 * carries `inline`, `schematic` and `sampleContent` — had no way to narrow its
 * own settings pane, and got the conservative fallback whether or not it had an
 * opinion.
 *
 * So the lookup follows the aggregator-seam rule the other companions follow
 * (docs/reference/slide-type-directory.md): the definition as it exists at
 * runtime is asked first, the generated aggregator is core's answer to it, and
 * a miss falls back rather than throwing. One lookup, in this module, so no
 * consumer writes its own precedence rule.
 *
 * The wire half matters as much as the order: the editor does not hold the
 * registry, it holds the `GET /api/slide-types` response, so `inspectorKeeps`
 * travels on that route or the definition-first branch is dead on arrival —
 * exactly the trap `schematic` and `sampleContent` were in until #473.
 *
 * @see docs/reference/slide-type-directory.md — the seam rule, written out.
 */

import { SLIDE_TYPE_INSPECTOR_KEEPS } from './inline-edit.js';

/**
 * The inspector keep-list for a type: which field keys the settings pane keeps
 * rendering even though the inline layer covers the rest of the slide.
 *
 * A *narrowing*, so the absence of a list is meaningful and distinct from an
 * empty one: `null` means "nobody narrowed this type, keep every field the
 * inline layer does not cover", while `[]` means "the canvas covers all of it".
 * Callers must not collapse the two.
 *
 * @param {string} type - registry type name
 * @param {{inspectorKeeps?: unknown}|null} [def] - the slide-type definition as
 *   it exists at runtime (registry entry, or the `/api/slide-types` metadata)
 * @returns {string[]|null} the keep-list, or null when neither side declares one
 */
export function slideTypeInspectorKeeps(type, def = null) {
  const declared = def?.inspectorKeeps;
  if (
    Array.isArray(declared) &&
    declared.every((key) => typeof key === 'string')
  ) {
    return declared;
  }
  const core = SLIDE_TYPE_INSPECTOR_KEEPS[type];
  return Array.isArray(core) ? core : null;
}

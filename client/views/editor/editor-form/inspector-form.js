import { getInlineFormTextKeys } from '../inline-edit/descriptors.js';
import { SLIDE_TYPE_INSPECTOR_KEEPS } from '../../../../shared/slide-types/inline-edit.js';
import {
  slideTypeInspectorKeeps,
  slideTypeElementTab,
} from '../../../../shared/slide-types/inline-edit-companions.js';
import { renderImageTextCollectionExtra } from './slide-forms/image-text-images.js';
import { renderIconCardExtras } from './slide-forms/icon-card-links.js';
import { renderListDensityExtra } from './slide-forms/list-density.js';
import { renderImageElementCard } from './image-element-card.js';

/**
 * What the phase-3 inspector keeps per slide type (editor-UI track, fase 3).
 *
 * The map itself is no longer written here. Every type declares its keep-list
 * in `shared/slide-types/types/<name>/inline-edit.js`, next to the on-canvas
 * descriptor it is the counterpart of — a field is kept in the inspector
 * *because* the canvas does not cover it, so the two answers drift the moment
 * they live in different files. What is left here is the rule that decides what
 * belongs in a keep-list, and the resolution of a type's keys.
 *
 * The rule the keep-lists follow: the inspector renders ONLY Background,
 * Accessibility and these settings/design fields. Content fields live on the
 * slide itself (wysiwyg) and — all of them, by construction — in the "Edit all
 * text" bulk modal. A key may only be dropped from a keep-list when its
 * replacement surface has shipped (parity invariant).
 *
 * The per-type coverage table in docs/reference/editor-inspector.md is generated
 * FROM these declarations (scripts/lib/slide-type-doc-tables.js), so it is a
 * readout rather than a second list to keep in step — edit the declaration and
 * regenerate.
 *
 * Coverage-audit rule (editing-surfaces §"Status: per-type coverage audit",
 * re-audited 2026-07-21): CONTENT TEXT may rely on the canvas + bulk modal;
 * SETTINGS/CONFIG/METADATA may never be bulk-only — a field the user cannot
 * point at on the canvas (URLs, config texts, alt/bg images) must render in the
 * inspector. `tests/slide-type-docs.test.js` states that half as a property:
 * no enum/boolean/number field may be left with the bulk modal as its only home.
 *
 * Documented deviations from the audit table's shorthand (see the reference
 * doc): table colCount, team-cards cardCount and logo-wall logoCount are
 * derived mirrors managed by their editors/arrays and were never rendered as
 * form controls, so they are not resurrected. Keys handled by the shared
 * Background/Accessibility sections are not listed either.
 *
 * Re-exported for the companion matrix (tests/slide-type-companion-coverage.js),
 * which catches a keep-list left behind for a type that no longer exists.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const INSPECTOR_KEEPS = SLIDE_TYPE_INSPECTOR_KEEPS;

/**
 * Resolve the set of field keys the inspector may render for a slide type.
 *
 * The keep-list comes from slideTypeInspectorKeeps(): the definition's own
 * declaration first, core's aggregator second (the seam rule — see
 * shared/slide-types/inline-edit-companions.js). A fork type that ships an
 * `inspectorKeeps` array on its definition therefore narrows its own settings
 * pane, which the old core-map-only lookup made impossible.
 *
 * A type neither side narrows is not in the audit, so it falls back
 * conservatively: every schema field EXCEPT the ones with proven wysiwyg
 * coverage (getInlineFormTextKeys) stays in the inspector - dropping more
 * would risk orphaning a field the fork has no other surface for.
 *
 * @param {string} type
 * @param {Object} def - Slide type definition (fields[])
 * @returns {Set<string>} keys allowed in the inspector (excl. bg/a11y routing)
 */
export function getInspectorKeepKeys(type, def) {
  const keeps = slideTypeInspectorKeeps(type, def);
  if (keeps) return new Set(keeps);
  const inlineCovered = new Set(getInlineFormTextKeys(type, def));
  const all = (def?.fields || [])
    .map((f) => f.key)
    .filter((k) => !inlineCovered.has(k));
  return new Set(all);
}

/**
 * The per-type inspector widgets a flat keeps-list cannot express — the
 * inspector counterpart of slide-form-router.js's SLIDE_FORMS, held to the
 * same criterion: empty, or only exceptions with a written reason.
 *
 * One line per type; each renderer receives the full flattened context and
 * destructures what it needs. Absence is the default, not a degradation: a
 * type without a row — including every custom/fork type — renders through the
 * generic keeps loop. The reasons live in the module headers:
 *
 * - image-text-slide: the slim slide-tab image collection manager
 *   (add/reorder/remove, no per-image settings) — a difference between
 *   SURFACES, not between types, so a field declaration is structurally the
 *   wrong axis (slide-forms/image-text-images.js, the #528 exception).
 * - icon-card-grid-slide: per-card icon + link with the selected-card /
 *   all-cards split and the numbered-mirror sync — real one-type UI whose
 *   declarative form would put an icon picker, a link field and a
 *   write-through hook in the vocabulary for one declarant
 *   (slide-forms/icon-card-links.js).
 * - list-slide: the "Text size" step-down note — needs live layout
 *   resolution, which the JSON-safe field vocabulary cannot carry
 *   (slide-forms/list-density.js).
 *
 * This table used to be a ~170-line switch over eight types (route 4 PR D):
 * the shared "This image" card was already generic in content, and its
 * addressing — six case labels — was the only per-name part left, so it
 * became the elementTab-driven rule in renderInspectorExtrasByType below.
 */
const INSPECTOR_EXTRAS = new Map([
  ['image-text-slide', renderImageTextCollectionExtra],
  ['icon-card-grid-slide', renderIconCardExtras],
  ['list-slide', renderListDensityExtra],
]);

/**
 * Per-type inspector widgets, in two parts:
 *
 * 1. THE RULE — a selected image element gets the shared "This image" card
 *    (image-element-card.js) whenever the type offers an `image` element tab.
 *    The card is descriptor-driven and the offer is the `elementTab`
 *    declaration on the type (inline-edit-companions.js), so the declaration
 *    is the whole story: a fork type that declares an image element tab gets
 *    the card without touching a file outside its own directory.
 * 2. THE EXCEPTIONS — the INSPECTOR_EXTRAS table above.
 *
 * Runs BEFORE the generic keeps loop; anything rendered here marks its keys
 * used so the loop skips them.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderInspectorExtrasByType(ctx) {
  const {
    elementForm,
    selectedElement,
    slide,
    def,
    fieldRenderers,
    markDirty,
    rerenderEditor,
    rerenderPreview,
    scheduleUiRefresh,
  } = ctx;

  if (
    selectedElement?.kind === 'image' &&
    slideTypeElementTab(slide.type, def)?.image
  ) {
    renderImageElementCard({
      container: elementForm,
      slide,
      def,
      idx: selectedElement.idx,
      fieldRenderers,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      scheduleUiRefresh,
    });
  }

  INSPECTOR_EXTRAS.get(slide.type)?.(ctx);
}

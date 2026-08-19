import { renderFollowInviteForm } from './slide-forms/follow-invite.js';

/**
 * The types that get a curated side form instead of the generic
 * fields-in-definition-order rendering. One line per type; each renderer
 * receives the full flattened context and destructures what it needs.
 *
 * Absence is the default, not a degradation: a type that is not listed —
 * including every custom/fork type — renders all of its `fields[]` in
 * definition order via the generic branch below. Custom slide types with image
 * fields using `presetSource: 'backgrounds'` automatically get the background
 * image picker through the generic renderField logic. Collection fields
 * (`type: 'items'`) get the full generic collection editor
 * (collection-editor.js): add/remove, pointer-based reorder, and — when the
 * field declares `collapsible: true` — per-item collapse.
 *
 * This table shrinks on purpose (editor-behaviour-abstraction brief). Step 2
 * took out the four rows (title, content, list, kpi-metrics) whose forms only
 * said field order plus "put these two side by side" — order is what `fields[]`
 * already is, and the pairing is a `formLayout: 'pair'` declaration on the
 * field (shared/slide-types/form-layout.js) read by the generic branch. Step 3
 * took out the seven hand-built collection forms; those types run on the
 * generic collection editor. Step 4 took out chart and table: their "forms"
 * were one rich widget plus show/hide branches, now a declared `editor`
 * (shared/slide-types/field-editors.js — csv-grid, table-grid) and a declared
 * `visibleWhen` condition (shared/slide-types/field-visibility.js) resolved by
 * the generic field renderer.
 *
 * Step 5 took out image-slide and image-text-slide, the last two real forms.
 * Their split, in one line each: the ImageRef axes (fit, bleed, focus) are
 * properties of the image ELEMENT and were already declared on the inline
 * descriptor, so they render through the shared "This image" card and their
 * schema fields became `hidden` carried data; the fit control's derived
 * default label became `editor: 'image-fit'`; the show/hide chains (alt on
 * imageRole, the zoom fields) became `visibleWhen`; the `<details>` groups and
 * the two imperative surface flags (`hideLayoutField`, `flat`) were dropped —
 * `layout` was already absent from image-text's `inspectorKeeps`, and the
 * helper only needed a flag because it bypassed that gate.
 *
 * What remains, each a documented exception:
 * - follow-invite-slide: `fields: []` BY DESIGN (the translation layer only
 *   touches declared fields, and this slide must never flip language), so its
 *   enabled-toggle and custom-copy inputs cannot be schema-driven.
 */
const SLIDE_FORMS = new Map([['follow-invite-slide', renderFollowInviteForm]]);

/**
 * Routes to the appropriate slide form renderer based on slide type
 * @param {Object} ctx - Render context with all dependencies
 * @returns {boolean} True if a specific form was rendered, false for default behavior
 */
export function renderSlideFormByType(ctx) {
  const renderForm = SLIDE_FORMS.get(ctx.slide.type);

  if (renderForm) {
    // Hand every renderer the same flattened context: the ctx itself and the
    // field renderers unpacked beside it. Each renderer destructures the
    // subset it uses.
    renderForm({
      ...ctx,
      ...ctx.fieldRenderers,
    });
    return true;
  }

  // Default: every field in definition order, with a run of consecutive
  // `formLayout: 'pair'` fields on one row. The loop itself lives in
  // editor-form.js because the inspector's remaining-keeps pass renders through
  // exactly the same one — a type declares its form layout once and both
  // surfaces obey it.
  ctx.renderFieldRows(ctx.def?.fields || []);
  return true;
}

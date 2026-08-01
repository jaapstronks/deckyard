import { renderFollowInviteForm } from './slide-forms/follow-invite.js';
import { renderChartSlideForm } from './slide-forms/chart.js';
import { renderTableSlideForm } from './slide-forms/table.js';
import { renderImageSlideForm, renderImageTextSlideForm } from './slide-forms/image-slide.js';
import { renderContentColumnsForm } from './slide-forms/content-columns.js';

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
 * took out the seven hand-built collection forms (card-stack, icon-card-grid,
 * team-cards, logo-wall, text-blocks, content-columns, gallery); those types
 * run on the generic collection editor. content-columns keeps a thin entry
 * because its storage is the flat numbered `col{n}*` model — see the
 * DOCUMENTED EXCEPTION note in slide-forms/content-columns.js. A form belongs
 * here only when it does something a declaration cannot — a widget, a derived
 * control, a non-field toggle.
 */
const SLIDE_FORMS = new Map([
  ['follow-invite-slide', renderFollowInviteForm],
  ['chart-slide', renderChartSlideForm],
  ['table-slide', renderTableSlideForm],
  ['image-slide', renderImageSlideForm],
  ['image-text-slide', renderImageTextSlideForm],
  ['content-columns-slide', renderContentColumnsForm], // DEPRECATED type — numbered-model exception
]);

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

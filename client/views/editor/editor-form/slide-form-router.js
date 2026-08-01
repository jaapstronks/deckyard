import { renderFollowInviteForm } from './slide-forms/follow-invite.js';
import { renderChartSlideForm } from './slide-forms/chart.js';
import { renderTableSlideForm } from './slide-forms/table.js';
import { renderTitleSlideForm } from './slide-forms/title-slide.js';
import { renderContentSlideForm, renderListSlideForm } from './slide-forms/content-slide.js';
import { renderImageSlideForm, renderImageTextSlideForm } from './slide-forms/image-slide.js';
import { renderKpiMetricsSlideForm } from './slide-forms/kpi-metrics.js';
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
 * The seven hand-built collection forms (card-stack, icon-card-grid,
 * team-cards, logo-wall, text-blocks, content-columns, gallery) are gone
 * (editor-behaviour-abstraction step 3); those types run on the generic
 * collection editor. content-columns keeps a thin entry because its storage
 * is the flat numbered `col{n}*` model — see the DOCUMENTED EXCEPTION note in
 * slide-forms/content-columns.js.
 */
const SLIDE_FORMS = new Map([
  ['follow-invite-slide', renderFollowInviteForm],
  ['title-slide', renderTitleSlideForm],
  ['content-slide', renderContentSlideForm],
  ['list-slide', renderListSlideForm],
  ['chart-slide', renderChartSlideForm],
  ['table-slide', renderTableSlideForm],
  ['image-slide', renderImageSlideForm],
  ['image-text-slide', renderImageTextSlideForm],
  ['kpi-metrics-slide', renderKpiMetricsSlideForm],
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

  // Default: render all fields in definition order
  for (const f of ctx.def.fields || []) ctx.add(f.key);
  return true;
}

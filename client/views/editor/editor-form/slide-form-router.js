import { renderFollowInviteForm } from './slide-forms/follow-invite.js';
import { renderCardStackForm } from './slide-forms/card-stack.js';
import { renderIconCardGridForm } from './slide-forms/icon-card-grid.js';
import { renderChartSlideForm } from './slide-forms/chart.js';
import { renderTableSlideForm } from './slide-forms/table.js';
import { renderTeamCardsForm } from './slide-forms/team-cards.js';
import { renderLogoWallForm } from './slide-forms/logo-wall.js';
import { renderImageSlideForm, renderImageTextSlideForm } from './slide-forms/image-slide.js';
import { renderTextBlocksForm } from './slide-forms/text-blocks.js';
import { renderContentColumnsForm } from './slide-forms/content-columns.js';
import { renderGallerySlideForm } from './slide-forms/gallery-slide.js';
import {
  removeCardAtIndex,
  removeIconGridCardAtIndex,
  removeTeamCardAtIndex,
  removeLogoWallItemAtIndex,
} from './cards.js';

/**
 * The types that get a curated side form instead of the generic
 * fields-in-definition-order rendering. One line per type; each renderer
 * receives the full flattened context and destructures what it needs.
 *
 * Absence is the default, not a degradation: a type that is not listed —
 * including every custom/fork type — renders all of its `fields[]` in
 * definition order via the generic branch below. Custom slide types with image
 * fields using `presetSource: 'backgrounds'` automatically get the background
 * image picker through the generic renderField logic.
 *
 * Four rows left this table in step 2 of the editor-behaviour-abstraction
 * brief: title, content, list and kpi-metrics carried ~127 lines whose entire
 * content was field order plus "put these two side by side". Order is what
 * `fields[]` already is, and the pairing is now a `formLayout: 'pair'`
 * declaration on the field (shared/slide-types/form-layout.js) that the generic
 * branch reads. A form belongs here only when it does something a declaration
 * cannot — a widget, a derived control, a non-field toggle.
 */
const SLIDE_FORMS = new Map([
  ['follow-invite-slide', renderFollowInviteForm],
  ['card-stack-slide', renderCardStackForm], // DEPRECATED — kept for editing existing slides
  ['icon-card-grid-slide', renderIconCardGridForm],
  ['team-cards-slide', renderTeamCardsForm],
  ['logo-wall-slide', renderLogoWallForm],
  ['chart-slide', renderChartSlideForm],
  ['table-slide', renderTableSlideForm],
  ['image-slide', renderImageSlideForm],
  ['image-text-slide', renderImageTextSlideForm],
  ['text-blocks-slide', renderTextBlocksForm],
  ['content-columns-slide', renderContentColumnsForm], // DEPRECATED — kept for editing existing slides
  ['gallery-slide', renderGallerySlideForm],
]);

/**
 * Routes to the appropriate slide form renderer based on slide type
 * @param {Object} ctx - Render context with all dependencies
 * @returns {boolean} True if a specific form was rendered, false for default behavior
 */
export function renderSlideFormByType(ctx) {
  const renderForm = SLIDE_FORMS.get(ctx.slide.type);

  if (renderForm) {
    // Hand every renderer the same flattened context: the ctx itself, the
    // field renderers unpacked beside it, and the card-removal helpers. Each
    // renderer destructures the subset it uses.
    renderForm({
      ...ctx,
      ...ctx.fieldRenderers,
      removeCardAtIndex,
      removeIconGridCardAtIndex,
      removeTeamCardAtIndex,
      removeLogoWallItemAtIndex,
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

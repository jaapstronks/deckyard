import { renderFollowInviteForm } from './slide-forms/follow-invite.js';
import { renderCardStackForm } from './slide-forms/card-stack.js';
import { renderIconCardGridForm } from './slide-forms/icon-card-grid.js';
import { renderChartSlideForm } from './slide-forms/chart.js';
import { renderTableSlideForm } from './slide-forms/table.js';
import { renderTeamCardsForm } from './slide-forms/team-cards.js';
import { renderLogoWallForm } from './slide-forms/logo-wall.js';
import { renderTitleSlideForm } from './slide-forms/title-slide.js';
import { renderContentSlideForm, renderLijstjeSlideForm } from './slide-forms/content-slide.js';
import { renderImageSlideForm, renderImageTextSlideForm } from './slide-forms/image-slide.js';
import { renderKpiMetricsSlideForm } from './slide-forms/kpi-metrics.js';
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
 * Routes to the appropriate slide form renderer based on slide type
 * @param {Object} ctx - Render context with all dependencies
 * @returns {boolean} True if a specific form was rendered, false for default behavior
 */
export function renderSlideFormByType(ctx) {
  const {
    h,
    form,
    slide,
    def,
    add,
    used,
    fieldByKey,
    renderField,
    fieldRenderers,
    deckSlides,
    placeTextSection,
    markDirty,
    rerenderEditor,
    rerenderSlideList,
    rerenderPreview,
    scheduleUiRefresh,
  } = ctx;

  const { fieldGrid, fieldText, fieldTextarea, fieldEnum, fieldIconPicker, fieldImage, fieldTitleBgImage } =
    fieldRenderers;

  switch (slide.type) {
    case 'follow-invite-slide':
      renderFollowInviteForm({
        h,
        form,
        slide,
        fieldText,
        fieldTextarea,
        markDirty,
        rerenderSlideList,
        rerenderPreview,
        scheduleUiRefresh,
      });
      return true;

    case 'card-stack-slide': // DEPRECATED — kept for editing existing slides
      renderCardStackForm({
        h,
        form,
        slide,
        add,
        used,
        fieldGrid,
        fieldText,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
        removeCardAtIndex,
      });
      return true;

    case 'icon-card-grid-slide':
      renderIconCardGridForm({
        h,
        form,
        slide,
        add,
        used,
        fieldGrid,
        fieldText,
        fieldIconPicker,
        deckSlides,
        placeTextSection,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
        removeIconGridCardAtIndex,
      });
      return true;

    case 'team-cards-slide':
      renderTeamCardsForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        fieldText,
        fieldImage,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
        removeTeamCardAtIndex,
      });
      return true;

    case 'logo-wall-slide':
      renderLogoWallForm({
        h,
        form,
        slide,
        add,
        used,
        renderField,
        fieldGrid,
        fieldText,
        fieldImage,
        deckSlides,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
        removeLogoWallItemAtIndex,
      });
      return true;

    case 'title-slide':
      renderTitleSlideForm({
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
      });
      return true;

    // Note: Custom slide types (from custom/slide-types/) that have image fields
    // with presetSource: 'backgrounds' will automatically use the background
    // image picker via the generic renderField logic.

    case 'content-slide':
      renderContentSlideForm({
        form,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
      });
      return true;

    case 'lijstje-slide':
      renderLijstjeSlideForm({
        form,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
      });
      return true;

    case 'chart-slide':
      renderChartSlideForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    case 'table-slide':
      renderTableSlideForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    case 'image-slide':
      renderImageSlideForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldEnum,
        fieldGrid,
        markDirty,
        scheduleUiRefresh,
      });
      return true;

    case 'image-text-slide':
      renderImageTextSlideForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        fieldText,
        fieldEnum,
        fieldImage,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    case 'kpi-metrics-slide':
      renderKpiMetricsSlideForm({
        form,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        placeTextSection,
      });
      return true;

    case 'text-blocks-slide':
      renderTextBlocksForm({
        h,
        form,
        slide,
        add,
        used,
        fieldGrid,
        fieldText,
        fieldTextarea,
        fieldEnum,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    case 'content-columns-slide':
      renderContentColumnsForm({
        h,
        form,
        slide,
        add,
        used,
        fieldGrid,
        fieldText,
        fieldTextarea,
        fieldEnum,
        fieldImage,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    case 'gallery-slide':
      renderGallerySlideForm({
        h,
        form,
        slide,
        add,
        used,
        fieldByKey,
        renderField,
        fieldGrid,
        fieldText,
        fieldImage,
        markDirty,
        rerenderEditor,
        scheduleUiRefresh,
      });
      return true;

    default:
      // Default: render all fields in definition order
      for (const f of def.fields || []) add(f.key);
      return true;
  }
}
import { renderImagePositionPicker } from '../image-position-picker.js';
import { t } from '../../../../lib/ui-i18n.js';

/**
 * Render form fields for image-slide type
 */
export function renderImageSlideForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
}) {
  // Image slide: focus picker is much nicer UX than raw X/Y inputs.
  add('title');
  add('subheading');
  add('bottomSubheading');
  add('image');
  add('caption');
  add('imageRole');
  if (String(slide?.content?.imageRole || 'content') !== 'decorative') {
    add('alt');
  }

  // Layout and background stacked vertically (not side-by-side)
  // so users notice the layout option more easily after auto-fit
  add('layout');
  add('background');

  const fxField = fieldByKey.get('focusX');
  const fyField = fieldByKey.get('focusY');
  if (fxField || fyField) {
    used.add('focusX');
    used.add('focusY');
    const isCropping = String(slide?.content?.layout || 'full') !== 'centered';
    const el = renderImagePositionPicker({
      h,
      mode: isCropping ? 'cover' : 'contain',
      imageUrl: slide?.content?.image,
      containerSelector:
        '.preview-panel .thumb.is-clickable-preview .slide-image-centered .frame',
      focusX: slide?.content?.focusX,
      focusY: slide?.content?.focusY,
      onChange: ({ focusX, focusY } = {}) => {
        slide.content.focusX = focusX;
        slide.content.focusY = focusY;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    });
    if (el) form.append(el);
  }

  // Animation settings (zoom steps) in a collapsible section
  const zoomStepsField = fieldByKey.get('zoomSteps');
  const zoomLevelField = fieldByKey.get('zoomLevel');
  const zoomPositionsField = fieldByKey.get('zoomPositions');

  if (zoomStepsField || zoomLevelField || zoomPositionsField) {
    used.add('zoomSteps');
    used.add('zoomLevel');
    used.add('zoomPositions');

    const animDetails = h('details', { class: 'editor-advanced' });
    const animSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.animationSettings', 'Animation settings'),
    });
    const animBody = h('div', { class: 'editor-advanced-body' });
    animDetails.append(animSummary, animBody);

    // Zoom steps selector
    if (zoomStepsField) {
      const zoomStepsEl = renderField(zoomStepsField);
      if (zoomStepsEl) animBody.append(zoomStepsEl);
    }

    // Zoom level and custom positions (only show if zoom is enabled)
    const zoomStepsValue = slide?.content?.zoomSteps || '';
    if (zoomStepsValue) {
      // Zoom level
      if (zoomLevelField) {
        const zoomLevelEl = renderField(zoomLevelField);
        if (zoomLevelEl) animBody.append(zoomLevelEl);
      }

      // Custom positions (only for 'custom' mode)
      if (zoomStepsValue === 'custom' && zoomPositionsField) {
        const zoomPosEl = renderField(zoomPositionsField);
        if (zoomPosEl) animBody.append(zoomPosEl);
      }
    }

    form.append(animDetails);
  }
}

/**
 * Render form fields for image-text-slide type
 */
export function renderImageTextSlideForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
}) {
  // Title/body first, then image fields below
  add('title');
  add('body');
  add('density');
  add('background');

  add('image');
  add('caption');
  add('imageRole');
  if (String(slide?.content?.imageRole || 'content') !== 'decorative') {
    add('alt');
  }

  // Layout options in a collapsible section
  const sideField = fieldByKey.get('imageSide');
  const widthField = fieldByKey.get('imageWidth');
  const fitField = fieldByKey.get('imageFit');
  const imgBgField = fieldByKey.get('imageBackground');
  const fxField = fieldByKey.get('focusX');
  const fyField = fieldByKey.get('focusY');

  if (sideField || widthField || fitField || imgBgField || fxField || fyField) {
    used.add('imageSide');
    used.add('imageWidth');
    used.add('imageFit');
    used.add('imageBackground');
    used.add('focusX');
    used.add('focusY');

    const layoutDetails = h('details', { class: 'editor-advanced' });
    const layoutSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.layoutSettings', 'Layout options'),
    });
    const layoutBody = h('div', { class: 'editor-advanced-body' });
    layoutDetails.append(layoutSummary, layoutBody);

    // First row: side, width, fit
    if (sideField || widthField || fitField) {
      const sideEl = sideField ? renderField(sideField) : null;
      const widthEl = widthField ? renderField(widthField) : null;
      const fitEl = fitField ? renderField(fitField) : null;
      const row = fieldGrid([sideEl, widthEl, fitEl], 3);
      if (row) layoutBody.append(row);
    }

    // Image background toggle
    if (imgBgField) {
      const imgBgEl = renderField(imgBgField);
      if (imgBgEl) layoutBody.append(imgBgEl);
    }

    // Image position picker
    if (fxField || fyField) {
      const isCropping = String(slide?.content?.imageFit || 'cover') !== 'contain';
      const el = renderImagePositionPicker({
        h,
        mode: isCropping ? 'cover' : 'contain',
        imageUrl: slide?.content?.image,
        containerSelector:
          '.preview-panel .thumb.is-clickable-preview .slide-image-text.is-image-contain .frame',
        focusX: slide?.content?.focusX,
        focusY: slide?.content?.focusY,
        onChange: ({ focusX, focusY } = {}) => {
          slide.content.focusX = focusX;
          slide.content.focusY = focusY;
          markDirty?.();
          scheduleUiRefresh?.();
        },
      });
      if (el) layoutBody.append(el);
    }

    form.append(layoutDetails);
  }
}
import { renderImagePositionPicker } from '../image-position-picker.js';
import { t } from '../../../../lib/ui-i18n.js';
import { renderImageTextImagesSection } from './image-text-images.js';

/**
 * Focus (crop) picker for image-slide. Shared between the content form and
 * the phase-3 inspector (focus is a settings concern, "Inspector keeps").
 */
export function appendImageFocusPicker({
  h,
  form,
  slide,
  used,
  fieldByKey,
  markDirty,
  scheduleUiRefresh,
} = {}) {
  const fxField = fieldByKey.get('focusX');
  const fyField = fieldByKey.get('focusY');
  if (!fxField && !fyField) return;
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

/**
 * Zoom/animation settings for image-slide (collapsible section). Shared
 * between the content form and the phase-3 inspector.
 */
export function appendImageZoomSettings({
  h,
  form,
  slide,
  used,
  fieldByKey,
  renderField,
} = {}) {
  const zoomStepsField = fieldByKey.get('zoomSteps');
  const zoomLevelField = fieldByKey.get('zoomLevel');
  const zoomPositionsField = fieldByKey.get('zoomPositions');
  if (!zoomStepsField && !zoomLevelField && !zoomPositionsField) return;

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
    if (zoomLevelField) {
      const zoomLevelEl = renderField(zoomLevelField);
      if (zoomLevelEl) animBody.append(zoomLevelEl);
    }
    if (zoomStepsValue === 'custom' && zoomPositionsField) {
      const zoomPosEl = renderField(zoomPositionsField);
      if (zoomPosEl) animBody.append(zoomPosEl);
    }
  }

  form.append(animDetails);
}

/**
 * Layout options (side/width/background) for image-text-slide, in a
 * collapsible section. Shared between the content form and the phase-3
 * inspector. Fit and focus are per-image (ImageRef) and live in the images
 * manager.
 */
export function appendImageTextLayoutOptions({
  h,
  form,
  slide,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
  // Inspector passes true: the toolbar "Layout" chip is the canonical control
  // for the structural variant there, so the duplicate enum is dropped. The
  // bulk "Edit all text" modal has no chip, so it keeps the enum (parity).
  hideLayoutField = false,
} = {}) {
  const layoutField = fieldByKey.get('layout');
  const textColsField = fieldByKey.get('textColumns');
  const sideField = fieldByKey.get('imageSide');
  const widthField = fieldByKey.get('imageWidth');
  const imgBgField = fieldByKey.get('imageBackground');
  const fxField = fieldByKey.get('focusX');
  const fyField = fieldByKey.get('focusY');

  if (!layoutField && !sideField && !widthField && !imgBgField && !fxField && !fyField) return;

  used.add('layout');
  used.add('textColumns');
  used.add('imageSide');
  used.add('imageWidth');
  // Legacy slide-level base fit: retired as a control (fit is per-image since
  // datamodel step 2b), marked used so the generic form never resurrects it.
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

  // Layout variant (split vs corner). The toolbar's "Layout" chip is the
  // canonical control, so the inspector drops this duplicate enum
  // (hideLayoutField); the bulk modal keeps it (no chip there). `layout` stays
  // marked used above so nothing else re-renders it.
  if (layoutField && !hideLayoutField) {
    const layoutEl = renderField(layoutField);
    if (layoutEl) layoutBody.append(layoutEl);
  }

  // Text columns (1/2): doubles the popover toggle, same as the enums above.
  // Only meaningful in the row/duo layouts; the field's helpText says so and
  // the renderer ignores the value elsewhere.
  if (textColsField) {
    const textColsEl = renderField(textColsField);
    if (textColsEl) layoutBody.append(textColsEl);
  }

  // Side + width. Fit and focus are per-image (ImageRef) since datamodel
  // steps 2/2b: the images manager owns both, so this slide-level panel
  // carries neither.
  if (sideField || widthField) {
    const sideEl = sideField ? renderField(sideField) : null;
    const widthEl = widthField ? renderField(widthField) : null;
    const row = fieldGrid([sideEl, widthEl], 2);
    if (row) layoutBody.append(row);
  }

  // Image background toggle
  if (imgBgField) {
    const imgBgEl = renderField(imgBgField);
    if (imgBgEl) layoutBody.append(imgBgEl);
  }

  form.append(layoutDetails);
}

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

  appendImageFocusPicker({ h, form, slide, used, fieldByKey, markDirty, scheduleUiRefresh });
  appendImageZoomSettings({ h, form, slide, used, fieldByKey, renderField });
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
  fieldText,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
}) {
  // Title/body first, then image fields below
  add('title');
  add('body');
  add('density');
  add('background');

  // Multi-image manager (images[], phase 2); replaces the flat image + alt
  // fields and migrates legacy content on render.
  const imagesSection = renderImageTextImagesSection({
    h,
    slide,
    used,
    fieldGrid,
    fieldText,
    fieldEnum,
    fieldImage,
    markDirty,
    rerenderEditor,
    scheduleUiRefresh,
  });
  if (imagesSection) form.append(imagesSection);

  add('caption');
  add('imageRole');

  appendImageTextLayoutOptions({
    h, form, slide, used, fieldByKey, renderField, fieldGrid, markDirty, scheduleUiRefresh,
  });
}

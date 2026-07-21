import { renderImagePositionPicker } from '../image-position-picker.js';
import { t } from '../../../../lib/ui-i18n.js';
import { renderImageTextImagesSection } from './image-text-images.js';
import {
  ensureImageSlideImage,
  resolveImageSlideImage,
  IMAGE_SLIDE_IMAGE_DEFAULTS,
} from '../../../../../shared/slide-types/image-slide-image.js';

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
  const isCropping = resolveImageSlideImage(slide?.content).fit !== 'contain';
  const el = renderImagePositionPicker({
    h,
    mode: isCropping ? 'cover' : 'contain',
    imageUrl: slide?.content?.image,
    containerSelector:
      '.preview-panel .thumb.is-clickable-preview .slide-image.is-fit-contain .frame',
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
 * Fit + bleed controls for image-slide (the ImageRef axes that replaced the
 * conflated `layout` enum, datamodel step 3). Shared between the content form
 * and the phase-3 inspector. Fit gets the silent-default UX (the empty option
 * shows the derived type default and doubles as back-to-default by emptying
 * the field); bleed is a boolean toggle whose Off clears the field (false is
 * the type default, so it is never stamped into the data).
 */
export function appendImageSlideFitControls({
  h,
  form,
  slide,
  used,
  fieldEnum,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
} = {}) {
  const content = slide?.content;
  if (!content || typeof content !== 'object' || typeof fieldEnum !== 'function') return;
  used?.add('fit');
  used?.add('bleed');
  // Legacy conflated enum: folded by ensureImageSlideImage, never rendered.
  used?.add('layout');

  const typeFitLabel =
    IMAGE_SLIDE_IMAGE_DEFAULTS.fit === 'contain'
      ? t('editor.imageText.fitContain', 'Fit (no crop)')
      : t('editor.imageText.fitCover', 'Fill (crop)');
  const fitEl = fieldEnum(
    {
      key: 'fit',
      label: t('editor.imageText.imageFit', 'Image fit'),
      options: [
        {
          value: '',
          label: t('editor.imageText.fitDefaultType', 'Default · {fit}', {
            fit: typeFitLabel,
          }),
          title: t(
            'editor.imageText.fitDefaultTypeTitle',
            'Follow the slide type default'
          ),
        },
        { value: 'cover', label: t('editor.imageText.fitCover', 'Fill (crop)') },
        { value: 'contain', label: t('editor.imageText.fitContain', 'Fit (no crop)') },
      ],
    },
    content.fit === 'cover' || content.fit === 'contain' ? content.fit : '',
    (v) => {
      content.fit = v;
      markDirty?.();
      scheduleUiRefresh?.();
    }
  );
  const bleedEl = fieldEnum(
    {
      key: 'bleed',
      label: t('editor.imageSlide.bleed', 'Edge-to-edge'),
      options: [
        { value: 'off', label: t('common.off', 'Off') },
        { value: 'on', label: t('common.on', 'On') },
      ],
    },
    resolveImageSlideImage(content).bleed ? 'on' : 'off',
    (v) => {
      // Boolean in data; Off clears (default false stays looked-up, not stored).
      content.bleed = v === 'on' ? true : '';
      markDirty?.();
      scheduleUiRefresh?.();
    }
  );
  const row = fieldGrid?.([fitEl, bleedEl].filter(Boolean), 2);
  if (row) form.append(row);
  else {
    if (fitEl) form.append(fitEl);
    if (bleedEl) form.append(bleedEl);
  }
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
 * Layout options (side/width/background) for image-text-slide. Shared between
 * the content form and the phase-3 inspector. Fit and focus are per-image
 * (ImageRef) and live in the per-image surfaces.
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
  // Inspector passes true: after the tab split the Slide tab carries few
  // enough settings that hiding these behind a collapsed toggle costs more
  // than it saves — render them flat under a plain label. The bulk modal
  // keeps the collapsible (it lists every content field too).
  flat = false,
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

  let layoutDetails;
  let layoutBody;
  if (flat) {
    layoutBody = h('div', { class: 'stack' });
    layoutBody.append(
      h('div', { class: 'field-label', text: t('editor.slide.layoutSettings', 'Layout options') })
    );
    layoutDetails = layoutBody;
  } else {
    layoutDetails = h('details', { class: 'editor-advanced' });
    const layoutSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.layoutSettings', 'Layout options'),
    });
    layoutBody = h('div', { class: 'editor-advanced-body' });
    layoutDetails.append(layoutSummary, layoutBody);
  }

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
  fieldEnum,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
}) {
  // Rendering the form also canonicalizes the content: the legacy conflated
  // `layout` folds into the ImageRef axes `fit` + `bleed` (datamodel step 3).
  ensureImageSlideImage(slide?.content);
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

  // Fit + bleed (the split `layout`), then background, stacked so users
  // notice the fit option easily after auto-fit.
  appendImageSlideFitControls({ h, form, slide, used, fieldEnum, fieldGrid, markDirty, scheduleUiRefresh });
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

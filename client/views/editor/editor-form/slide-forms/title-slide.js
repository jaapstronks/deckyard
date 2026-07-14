/**
 * Render form fields for title-slide type (universal title slide)
 */
export function renderTitleSlideForm({
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  fieldTitleBgImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
}) {
  add('title');
  add('subheading');
  add('byline');
  add('attribution');

  // Background + logo corner are compact controls; keep them half-width.
  const bgField = fieldByKey.get('background');
  const logoCornerField = fieldByKey.get('logoCorner');
  if (bgField || logoCornerField) {
    used.add('background');
    used.add('logoCorner');
    const bgEl = bgField ? renderField(bgField) : null;
    const logoEl = logoCornerField ? renderField(logoCornerField) : null;
    const row = fieldGrid([bgEl, logoEl], 2);
    if (row) form.append(row);
  }

  // Custom ordered UI for background image selection (optional).
  const bgImageField = fieldByKey.get('bgImage');
  if (bgImageField) {
    used.add('bgImage');
    form.append(
      fieldTitleBgImage(slide, bgImageField, (url) => {
        slide.content[bgImageField.key] = url;
        markDirty?.();
        rerenderEditor();
        scheduleUiRefresh?.();
      })
    );
  }
  add('bgAlt');
}

// Note: Custom slide types (from custom/slide-types/) that have image fields
// with presetSource: 'backgrounds' will automatically use the background
// image picker via the generic renderField logic in render-field.js.
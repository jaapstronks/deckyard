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
}) {
  add('title');
  add('subheading');
  add('byline');
  add('attribution');

  // Background + logo corner are compact controls; keep them half-width.
  // The background *image* lives in the shared "Background" section
  // (slideBgImage); the title type no longer has its own bgImage picker (it
  // was a duplicate full-slide background — see title-slide-background.js).
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
}

// Note: Custom slide types (from custom/slide-types/) that have image fields
// with presetSource: 'backgrounds' will automatically use the background
// image picker via the generic renderField logic in render-field.js.
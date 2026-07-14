/**
 * Render form fields for content-slide type
 */
export function renderContentSlideForm({
  form,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
}) {
  // Content slides benefit from keeping layout/background compact side-by-side.
  // Density gets its own row: the three-option segmented control needs more
  // horizontal room than a third of the form width gives it.
  add('title');
  add('subheading');
  add('bottomSubheading');

  const layoutField = fieldByKey.get('layout');
  const bgField = fieldByKey.get('background');
  if (layoutField || bgField) {
    used.add('layout');
    used.add('background');
    const layoutEl = layoutField ? renderField(layoutField) : null;
    const bgEl = bgField ? renderField(bgField) : null;
    const row = fieldGrid([layoutEl, bgEl], 2);
    if (row) form.append(row);
  }

  add('density');

  add('body');
}

/**
 * Render form fields for lijstje-slide type (list slide)
 */
export function renderLijstjeSlideForm({
  form,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
}) {
  add('title');
  add('subheading');

  // Style (bullets/numbers) + Layout (auto/one/two columns) pair naturally as
  // two small enum selects; keep them side by side so the column choice is
  // discoverable instead of falling to the bottom of the form.
  const variantField = fieldByKey.get('variant');
  const layoutField = fieldByKey.get('layout');
  if (variantField || layoutField) {
    used.add('variant');
    used.add('layout');
    const vEl = variantField ? renderField(variantField) : null;
    const lEl = layoutField ? renderField(layoutField) : null;
    const row = fieldGrid([vEl, lEl], 2);
    if (row) form.append(row);
  }

  add('background');

  add('items');
}
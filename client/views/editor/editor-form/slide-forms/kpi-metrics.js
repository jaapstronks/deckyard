/**
 * Render form fields for kpi-metrics-slide type
 */
export function renderKpiMetricsSlideForm({
  form,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  placeTextSection,
}) {
  add('title');
  add('subheading');
  add('bottomSubheading');
  // Position the collapsed "Text" section above the metrics cards.
  placeTextSection?.();

  const accentField = fieldByKey.get('accent');
  const bgField = fieldByKey.get('background');
  const countUpField = fieldByKey.get('countUp');
  if (accentField || bgField || countUpField) {
    used.add('accent');
    used.add('background');
    used.add('countUp');
    const aEl = accentField ? renderField(accentField) : null;
    const bgEl = bgField ? renderField(bgField) : null;
    const cEl = countUpField ? renderField(countUpField) : null;
    const row1 = fieldGrid([aEl, bgEl], 2);
    const row2 = fieldGrid([cEl], 1);
    if (row1) form.append(row1);
    if (row2) form.append(row2);
  }

  add('metrics');
}
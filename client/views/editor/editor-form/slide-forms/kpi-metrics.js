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

  // Background colour moved to the unified Background section (editor-form.js).
  const accentField = fieldByKey.get('accent');
  const countUpField = fieldByKey.get('countUp');
  if (accentField || countUpField) {
    used.add('accent');
    used.add('countUp');
    const aEl = accentField ? renderField(accentField) : null;
    const cEl = countUpField ? renderField(countUpField) : null;
    const row = fieldGrid([aEl, cEl], 2);
    if (row) form.append(row);
  }

  add('metrics');
}
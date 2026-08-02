export function chartSummary(parsed) {
  if (!parsed?.ok) return '';
  if (parsed.kind === 'bar' || parsed.kind === 'pie') {
    const { labels, values } = parsed.dataset;
    const pairs = labels
      .map((l, i) => ({ l: String(l || '').trim(), v: values[i] }))
      .filter((p) => typeof p.v === 'number');
    pairs.sort((a, b) => b.v - a.v);
    const top = pairs[0];
    if (!top) return '';
    return `${parsed.kind} chart met ${pairs.length} punten. Hoogste: ${top.l} (${top.v}).`;
  }
  if (parsed.kind === 'line') {
    const all = [];
    for (const v of parsed.dataset.y1 || []) if (v != null) all.push(v);
    for (const v of parsed.dataset.y2 || []) if (v != null) all.push(v);
    if (!all.length) return '';
    const min = Math.min(...all);
    const max = Math.max(...all);
    return `Line chart met ${parsed.dataset.x.length} punten. Min: ${min}. Max: ${max}.`;
  }
  return '';
}

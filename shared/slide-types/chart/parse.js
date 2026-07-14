function normalizeNumber(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/\u00a0/g, ' '); // nbsp
  s = s.replace(/\s+/g, ''); // remove spaces (incl. thousands separators)

  // 1.234,56 -> 1234.56
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // 1,234.56 -> 1234.56
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) {
    s = s.replace(/,/g, '');
  }
  // 12,5 -> 12.5 (decimal comma)
  else if (/^-?\d+,\d+$/.test(s) && !s.includes('.')) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectDelimiter(text) {
  const t = String(text || '');
  if (t.includes('\t')) return '\t';
  const commas = (t.match(/,/g) || []).length;
  const semis = (t.match(/;/g) || []).length;
  if (semis > commas) return ';';
  return ',';
}

function parseDelimited(text, delimiter) {
  // Basic RFC4180-ish parser (handles quotes and escaped quotes).
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const s = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);

  // Trim and drop empty rows
  const cleaned = rows
    .map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []
    )
    .filter((r) => r.some((c) => String(c || '').trim().length > 0));
  return cleaned;
}

function isHeaderRowForBarOrPie(rows) {
  if (rows.length < 2) return false;
  const r0 = rows[0] || [];
  const maybe = normalizeNumber(r0[1]);
  return maybe == null; // if 2nd column isn't numeric, assume header
}

function isHeaderRowForLine(rows) {
  if (rows.length < 2) return false;
  const r0 = rows[0] || [];
  const n1 = normalizeNumber(r0[1]);
  const n2 = normalizeNumber(r0[2]);
  return n1 == null && n2 == null;
}

export function parseChartData({ chartType, data }) {
  const raw = String(data || '').trim();
  if (!raw)
    return { ok: false, errors: ['Data is leeg. Plak CSV/TSV data.'] };

  const delimiter = detectDelimiter(raw);
  const rows = parseDelimited(raw, delimiter);
  if (rows.length < 2) {
    return {
      ok: false,
      errors: ['Niet genoeg rijen. Voeg minstens 2 datarijen toe.'],
    };
  }

  if (chartType === 'bar' || chartType === 'pie') {
    const hasHeader = isHeaderRowForBarOrPie(rows);
    const body = hasHeader ? rows.slice(1) : rows;
    const labels = [];
    const values = [];
    for (const r of body) {
      const label = String(r?.[0] ?? '').trim();
      const val = normalizeNumber(r?.[1]);
      if (!label && val == null) continue;
      labels.push(label || '');
      values.push(val);
    }

    const numeric = values.filter((v) => typeof v === 'number');
    if (labels.length < 2) {
      return {
        ok: false,
        errors: ['Niet genoeg datarijen. Voeg minstens 2 datapunten toe.'],
      };
    }
    if (!numeric.length) {
      return { ok: false, errors: ['Geen numerieke waarden gevonden.'] };
    }
    if (chartType === 'pie' && numeric.some((v) => v < 0)) {
      return {
        ok: false,
        errors: ['Pie chart: negatieve waarden zijn niet toegestaan.'],
      };
    }
    return { ok: true, kind: chartType, dataset: { labels, values } };
  }

  // line (1–2 series)
  const hasHeader = isHeaderRowForLine(rows);
  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;

  const x = [];
  const y1 = [];
  const y2 = [];
  let anyY2 = false;

  for (const r of body) {
    const xLabel = String(r?.[0] ?? '').trim();
    const v1 = normalizeNumber(r?.[1]);
    const v2 = normalizeNumber(r?.[2]);
    if (!xLabel && v1 == null && v2 == null) continue;
    x.push(xLabel || '');
    y1.push(v1);
    y2.push(v2);
    if (v2 != null) anyY2 = true;
  }

  if (x.length < 2) {
    return {
      ok: false,
      errors: ['Niet genoeg datapunten. Voeg minstens 2 punten toe.'],
    };
  }
  const y1Count = y1.filter((v) => v != null).length;
  const y2Count = y2.filter((v) => v != null).length;
  if (y1Count < 2 && y2Count < 2) {
    return {
      ok: false,
      errors: ['Line chart vereist minstens 2 numerieke punten.'],
    };
  }

  const series1Label = header?.[1] ? String(header[1]).trim() : '';
  const series2Label = header?.[2] ? String(header[2]).trim() : '';

  const dataset = anyY2
    ? { x, y1, y2, series1Label, series2Label }
    : { x, y1, series1Label };
  return { ok: true, kind: 'line', dataset };
}

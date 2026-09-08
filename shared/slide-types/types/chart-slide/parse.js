export function normalizeNumber(raw) {
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

export function detectDelimiter(text) {
  const t = String(text || '');
  if (t.includes('\t')) return '\t';
  const commas = (t.match(/,/g) || []).length;
  const semis = (t.match(/;/g) || []).length;
  if (semis > commas) return ';';
  return ',';
}

export function parseDelimited(text, delimiter) {
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
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
    .filter((r) => r.some((c) => String(c || '').trim().length > 0));
  return cleaned;
}

/**
 * The column names a chart's data carries when its first row supplies none —
 * the same synthesised names the grid editor writes into an empty header. Used
 * only by the schema migration that gave every stored chart a header row; the
 * parser itself never synthesises, because after v15 the first row *is* the
 * header.
 * @param {string} chartType
 * @returns {string[]}
 */
export function defaultHeaderFor(chartType) {
  return String(chartType) === 'line'
    ? ['X', 'Series 1', 'Series 2']
    : ['Label', 'Value'];
}

/**
 * Serialize a matrix (array of string rows) back to a CSV string the parser
 * eats: comma-delimited, cells containing a comma / quote / newline are quoted
 * with doubled inner quotes (RFC 4180). Trailing empty rows/cells are kept as
 * the caller provides them; callers should trim before serializing if desired.
 * @param {Array<Array<string|number|null>>} rows
 * @returns {string}
 */
export function serializeCsv(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .map((cell) => {
          const s = String(cell ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

/**
 * Parse a CSV/TSV string into a lossless matrix (array of trimmed string rows)
 * for grid editing. Unlike {@link parseChartData}, this does no numeric coercion
 * or header detection - it just tokenizes with the auto-detected delimiter so a
 * grid can render every cell as-typed and round-trip via {@link serializeCsv}.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvToGrid(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  return parseDelimited(raw, detectDelimiter(raw));
}

export function parseChartData({ chartType, data }) {
  const raw = String(data || '').trim();
  if (!raw) return { ok: false, errors: ['Data is leeg. Plak CSV/TSV data.'] };

  const delimiter = detectDelimiter(raw);
  const rows = parseDelimited(raw, delimiter);
  // The first row is the header - always, for every chart type (D83). No
  // heuristic decides it, so a numeric column name ("Quarter\t2023\t2024") is
  // a column name and not a data point, and a deck stored without a header got
  // one from the v14 -> v15 migration rather than from a guess made here.
  if (rows.length < 3) {
    return {
      ok: false,
      errors: [
        'Niet genoeg rijen. Voeg een kolomnamen-rij plus minstens 2 datarijen toe.',
      ],
    };
  }
  const body = rows.slice(1);

  if (chartType === 'bar' || chartType === 'pie') {
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
  const header = rows[0];

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

  const series1Label = header[1] ? String(header[1]).trim() : '';
  const series2Label = header[2] ? String(header[2]).trim() : '';

  const dataset = anyY2
    ? { x, y1, y2, series1Label, series2Label }
    : { x, y1, series1Label };
  return { ok: true, kind: 'line', dataset };
}

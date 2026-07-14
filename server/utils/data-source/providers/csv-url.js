/**
 * CSV-URL data source provider.
 *
 * Fetches CSV from a URL (including Google Sheets public CSV exports)
 * and maps cell references to slide content fields.
 *
 * Source key format: cell references like `A1`, `B2`, `C10`, or
 * `row[N].colName` for named columns (first row as header).
 */

import { createDataSourceProvider } from '../provider-base.js';
import { apiFetch } from '../../api-fetch.js';

function isPrivateUrl(urlString) {
  const hostname = new URL(urlString).hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(hostname)) return true;
  // IPv4 private ranges
  const parts = hostname.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  return false;
}

const BLOCKED_HEADERS = new Set(['host', 'authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

/**
 * Parse CSV text into a 2D array of strings.
 * Handles quoted fields with commas and newlines.
 */
function parseCsv(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(current.trim());
      current = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(current.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      current = '';
      if (ch === '\r') i++;
    } else {
      current += ch;
    }
  }

  // Last row
  row.push(current.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  return rows;
}

/**
 * Parse an Excel-style cell reference like "B3" into { col: 1, row: 2 } (0-indexed).
 */
function parseCellRef(ref) {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const letters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10) - 1;

  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  col -= 1;

  return { col, row: rowNum };
}

/**
 * Fetch CSV from URL.
 */
async function fetchCsvData(config) {
  const { url, headers: customHeaders } = config;
  if (!url) throw new Error('url is required for csv-url provider');

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid CSV URL');
  }

  // Only allow http(s)
  if (!parsed.protocol.startsWith('http')) {
    throw new Error('CSV URL must use HTTP or HTTPS');
  }

  if (isPrivateUrl(url)) {
    throw new Error('URL must not point to internal/private addresses');
  }

  const fetchHeaders = { Accept: 'text/csv, text/plain, */*' };
  if (customHeaders && typeof customHeaders === 'object') {
    for (const [key, value] of Object.entries(customHeaders)) {
      if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
        fetchHeaders[key] = value;
      }
    }
  }

  const resp = await apiFetch(url, 'CSV', { headers: fetchHeaders });
  const text = await resp.text();

  return parseCsv(text);
}

/**
 * Map CSV data to binding source keys.
 *
 * Supports two source key formats:
 * 1. Cell reference: `A1`, `B3`, `C10` (Excel-style, 1-indexed rows)
 * 2. Named column: `row[N].colName` (uses first row as headers)
 */
function parseCsvResponse(grid, bindings) {
  const result = {};
  if (!grid.length) return result;

  // Build header map from first row
  const headers = grid[0] || [];
  const headerIndex = {};
  headers.forEach((h, i) => {
    headerIndex[h.trim()] = i;
  });

  for (const binding of bindings) {
    const source = binding.source;

    // Cell reference: A1, B3, etc.
    const cellRef = parseCellRef(source);
    if (cellRef && cellRef.row >= 0 && cellRef.col >= 0) {
      const row = grid[cellRef.row];
      result[source] = row ? (row[cellRef.col] ?? '') : '';
      continue;
    }

    // Named column: row[N].colName
    const rowMatch = source.match(/^row\[(\d+)\]\.(.+)$/);
    if (rowMatch) {
      const rowIndex = parseInt(rowMatch[1], 10) + 1; // +1 to skip header row
      const colName = rowMatch[2];
      const colIdx = headerIndex[colName];
      if (colIdx !== undefined && grid[rowIndex]) {
        result[source] = grid[rowIndex][colIdx] ?? '';
      } else {
        result[source] = '';
      }
    }
  }

  return result;
}

export const csvUrlProvider = createDataSourceProvider({
  name: 'csv-url',
  fetchData: fetchCsvData,
  parseResponse: parseCsvResponse,
});

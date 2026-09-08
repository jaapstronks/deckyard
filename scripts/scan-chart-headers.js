#!/usr/bin/env node

/**
 * List every stored chart whose first row the retired header heuristic read as
 * data — the last copy of the header heuristic, kept so an admin can find the
 * charts whose first row the old parser plotted; the new parser names columns
 * with it (D83). Each hit is a judgment call: a year header that was misread
 * (delete nothing, the chart is now right) or genuinely headerless data (add a
 * header row in the grid). Never a migration: D86.
 *
 * ## Why this is a listing and not a fold
 *
 * Before D83 the parser guessed: row 0 was *data* when column 2 (bar/pie) or
 * columns 2 and 3 (line) parsed as a number. Both kinds of chart trip that
 * guess, and nothing in the stored data tells them apart — `Quarter,2023,2024`
 * is a header the old parser misread and plotted, `a,1` is a first data point
 * that the new parser now reads as column names. A migration would have to pick
 * one reading for both; in the dev population the misread-header kind is the
 * majority, so a synthesised header would freeze the very bug D83 fixed. Hence:
 * report, and let the admin decide per deck.
 *
 * Read-only. It writes nothing, anywhere, and exits 0 whatever it finds — it is
 * a listing, not a gate. It exits 1 only when it cannot read the store it was
 * pointed at (no database, a `--dir` that does not exist), because a scan that
 * saw nothing must not read as "nothing to see".
 *
 * Usage:
 *   node scripts/scan-chart-headers.js              # Postgres, via .env
 *   node scripts/scan-chart-headers.js --dir <path> # deck JSON at rest
 *
 * Surfaces (Postgres): presentations.slides / .i18n,
 * presentation_versions.presentation_data, presentation_comments.slide_snapshot,
 * slide_library.content / .i18n.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { createMigrationDb } from '../server/db/migrate.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const CHART_TYPE = 'chart-slide';

/* ------------------------------------------------------------------ *
 * The retired parser, verbatim (pre-D83 chart-slide/parse.js)
 * ------------------------------------------------------------------ */

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
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
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

/* ------------------------------------------------------------------ *
 * The scan
 * ------------------------------------------------------------------ */

/**
 * Whether the retired heuristic read this chart's first row as data.
 *
 * Fewer than two rows is not a hit: the old parser errored on that and so does
 * the new one, so there is no reading to compare.
 *
 * @param {unknown} chartType
 * @param {string} data
 * @returns {boolean}
 */
function firstRowWasPlotted(chartType, data) {
  const raw = String(data ?? '');
  if (!raw.trim()) return false;
  const rows = parseDelimited(raw, detectDelimiter(raw));
  if (rows.length < 2) return false;
  return chartType === 'line'
    ? !isHeaderRowForLine(rows)
    : !isHeaderRowForBarOrPie(rows);
}

/**
 * Inspect one slide *content* object.
 * @param {any} content
 * @param {unknown} [chartTypeFallback] - Used when the object carries none.
 * @returns {{ chart: boolean, hit: boolean, chartType: unknown, data: string }}
 */
function inspectContent(content, chartTypeFallback) {
  const empty = { chart: false, hit: false, chartType: undefined, data: '' };
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return empty;
  }
  if (typeof content.data !== 'string') return empty;
  const chartType =
    content.chartType === undefined ? chartTypeFallback : content.chartType;
  return {
    chart: true,
    hit: firstRowWasPlotted(chartType, content.data),
    chartType,
    data: content.data,
  };
}

/**
 * Walk any parsed JSON and report the chart slides in it, plus the ones whose
 * first row the retired heuristic plotted.
 *
 * Pure: it reads, counts and returns; nothing is rewritten. One key-aware walk
 * is correct for every shape a slide is stored in — deck slide arrays,
 * per-language i18n versions, version snapshots and comment snapshots all nest
 * them differently.
 *
 * @param {any} node - Any parsed JSON value.
 * @returns {{ charts: number, hits: Array<{ slideId: (string|null), chartType: unknown, data: string }> }}
 */
export function scanChartHeaders(node) {
  const hits = [];
  let charts = 0;

  /** @param {any} value */
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (value.type === CHART_TYPE) {
      const seen = inspectContent(value.content);
      if (seen.chart) {
        charts += 1;
        if (seen.hit) {
          hits.push({
            slideId: typeof value.id === 'string' ? value.id : null,
            chartType: seen.chartType,
            data: seen.data,
          });
        }
      }
      return;
    }

    for (const entry of Object.values(value)) walk(entry);
  };

  walk(node);
  return { charts, hits };
}

/**
 * The same scan for a slide-library row, which stores the type in a scalar
 * column and the slide content at the top level of `content` — so the
 * slide-shaped walk cannot see it. A per-language `i18n.versions[*].content`
 * holds the same content; when it carries no `chartType` of its own the row's
 * dominant content supplies it, because the translation of a chart is the same
 * chart.
 *
 * @param {{ content?: any, i18n?: any }} row
 * @returns {{ charts: number, hits: Array<{ lang: (string|null), chartType: unknown, data: string }> }}
 */
export function scanLibraryRow(row) {
  const hits = [];
  let charts = 0;

  const top = inspectContent(row?.content);
  if (top.chart) {
    charts += 1;
    if (top.hit) {
      hits.push({ lang: null, chartType: top.chartType, data: top.data });
    }
  }

  const chartType =
    row?.content && typeof row.content === 'object'
      ? row.content.chartType
      : undefined;
  const versions = row?.i18n?.versions;
  if (versions && typeof versions === 'object' && !Array.isArray(versions)) {
    for (const [lang, version] of Object.entries(versions)) {
      const seen = inspectContent(version?.content, chartType);
      if (!seen.chart) continue;
      charts += 1;
      if (seen.hit) {
        hits.push({ lang, chartType: seen.chartType, data: seen.data });
      }
    }
  }

  return { charts, hits };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

/** The first 60 characters of the data, on one line. */
function preview(data) {
  const flat = String(data ?? '')
    .replace(/\t/g, '\\t')
    .replace(/\r?\n/g, '\\n');
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/**
 * One report line per hit.
 * @param {{ surface: string, id: string, title?: string|null, chartType: unknown, data: string }} hit
 * @returns {string}
 */
function formatHit({ surface, id, title, chartType, data }) {
  const named = title ? `  "${title}"` : '';
  return (
    `  ${surface.padEnd(38)} ${String(id)}${named}` +
    `  [${String(chartType ?? '?')}]  ${preview(data)}`
  );
}

/* ------------------------------------------------------------------ *
 * Postgres
 * ------------------------------------------------------------------ */

/** Slide-shaped jsonb columns, with the row fields that name the hit. */
const PG_TARGETS = [
  { table: 'presentations', columns: ['slides', 'i18n'], title: 'title' },
  {
    table: 'presentation_versions',
    columns: ['presentation_data'],
    title: 'title',
  },
  { table: 'presentation_comments', columns: ['slide_snapshot'], title: null },
];

/**
 * Scan the Postgres surfaces, printing a line per hit.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<{ charts: number, hits: number }>}
 */
async function scanPostgres(db) {
  let charts = 0;
  let hits = 0;

  for (const { table, columns, title } of PG_TARGETS) {
    for (const column of columns) {
      const titleSelect = title ? sql`, ${sql.ref(title)} AS title` : sql``;
      const { rows } = await sql`
        SELECT id, ${sql.ref(column)} AS value${titleSelect}
        FROM ${sql.ref(table)}
        WHERE ${sql.ref(column)} IS NOT NULL
          AND ${sql.ref(column)}::text LIKE ${'%' + CHART_TYPE + '%'}
      `.execute(db);

      for (const row of rows) {
        const found = scanChartHeaders(row.value);
        charts += found.charts;
        hits += found.hits.length;
        for (const hit of found.hits) {
          console.log(
            formatHit({
              surface: `${table}.${column}`,
              id: row.id,
              title: row.title ?? null,
              chartType: hit.chartType,
              data: hit.data,
            }),
          );
        }
      }
    }
  }

  const libraryRows = await db
    .selectFrom('slide_library')
    .select(['id', 'name', 'content', 'i18n'])
    .where('slide_type', '=', CHART_TYPE)
    .execute();

  for (const row of libraryRows) {
    const found = scanLibraryRow(row);
    charts += found.charts;
    hits += found.hits.length;
    for (const hit of found.hits) {
      console.log(
        formatHit({
          surface: `slide_library.${hit.lang ? `i18n[${hit.lang}]` : 'content'}`,
          id: row.id,
          title: row.name ?? null,
          chartType: hit.chartType,
          data: hit.data,
        }),
      );
    }
  }

  return { charts, hits };
}

/* ------------------------------------------------------------------ *
 * Deck JSON at rest
 * ------------------------------------------------------------------ */

/**
 * Scan a directory tree of deck JSON, printing a line per hit.
 * @param {string} root
 * @returns {Promise<{ charts: number, hits: number }>}
 */
export async function scanDirectory(root) {
  let charts = 0;
  let hits = 0;

  /** @param {string} dir */
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === root) throw err; // the store itself is unreadable: say so
      return; // an unreadable subtree is skipped
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        await scanFile(full);
      }
    }
  };

  /** @param {string} filePath */
  const scanFile = async (filePath) => {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      return; // not JSON / unreadable — skip
    }
    const found = scanChartHeaders(parsed);
    charts += found.charts;
    hits += found.hits.length;
    const rel = path.relative(root, filePath) || path.basename(filePath);
    for (const hit of found.hits) {
      console.log(
        formatHit({
          surface: rel,
          id: parsed?.id || path.basename(filePath, '.json'),
          title: typeof parsed?.title === 'string' ? parsed.title : null,
          chartType: hit.chartType,
          data: hit.data,
        }),
      );
    }
  };

  await walk(root);
  return { charts, hits };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{ dir: (string|null) }}
 */
function parseArgs(argv) {
  const dirIdx = argv.indexOf('--dir');
  if (dirIdx === -1) return { dir: null };
  const given = argv[dirIdx + 1];
  if (!given || given.startsWith('--')) {
    throw new Error('--dir needs a path');
  }
  return { dir: path.resolve(given) };
}

async function main() {
  const { dir } = parseArgs(process.argv.slice(2));

  console.log(
    'Charts whose first row the retired heuristic plotted as data ' +
      '(read-only listing, D86):\n',
  );

  let result;
  if (dir) {
    result = await scanDirectory(dir);
  } else {
    await loadDotEnv(REPO_ROOT);
    const db = await createMigrationDb();
    try {
      result = await scanPostgres(db);
    } finally {
      await db.destroy();
    }
  }

  if (!result.hits) console.log('  (none)');
  console.log(
    `\n${result.charts} chart slides, ${result.hits} with a numeric first row.`,
  );
  if (result.hits) {
    console.log(
      '\nEach hit is a judgment call: a year header the old parser misread\n' +
        '(nothing to do — the chart is right now) or genuinely headerless data\n' +
        '(add a header row in the grid editor).',
    );
  }
}

// Only run as a CLI; importing the module (tests) must not touch any store.
if (isCli(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1); // could not read the store; hits themselves never exit 1
  });
}

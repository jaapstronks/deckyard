/**
 * Notion data source provider.
 *
 * Two source types:
 * 1. notion-database — queries a Notion database, maps rows to slide fields
 * 2. notion-block — fetches a specific block/page, maps content to slide fields
 *
 * Leverages existing server/utils/notion/ infrastructure.
 */

import { createDataSourceProvider } from '../provider-base.js';
import { notionFetchJson, fetchAllBlockChildren, notionEnabled } from '../../notion/client.js';
import { richTextToPlain, pageTitleFromProperties } from '../../notion/parser.js';

/**
 * Query a Notion database and return rows as objects keyed by property name.
 */
async function queryDatabase(config) {
  if (!notionEnabled()) {
    const err = new Error('Notion is not configured');
    err.statusCode = 501;
    throw err;
  }

  const { databaseId, filter, sorts } = config;
  if (!databaseId) {
    throw new Error('databaseId is required for notion-database provider');
  }

  const body = { page_size: 100 };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const resp = await notionFetchJson(
    `/databases/${encodeURIComponent(databaseId)}/query`,
    { method: 'POST', body }
  );

  const results = Array.isArray(resp?.results) ? resp.results : [];

  return results.map((page) => {
    const row = { _id: page.id, _title: pageTitleFromProperties(page.properties) };

    for (const [propName, prop] of Object.entries(page.properties || {})) {
      row[propName] = extractPropertyValue(prop);
    }

    return row;
  });
}

/**
 * Extract a scalar value from a Notion property object.
 */
function extractPropertyValue(prop) {
  if (!prop || typeof prop !== 'object') return '';
  const type = prop.type;

  switch (type) {
    case 'title':
      return richTextToPlain(prop.title);
    case 'rich_text':
      return richTextToPlain(prop.rich_text);
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return (prop.multi_select || []).map((s) => s.name).join(', ');
    case 'date':
      return prop.date?.start || '';
    case 'checkbox':
      return prop.checkbox ? 'true' : 'false';
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    case 'phone_number':
      return prop.phone_number || '';
    case 'formula':
      return extractFormulaValue(prop.formula);
    case 'rollup':
      return extractRollupValue(prop.rollup);
    case 'status':
      return prop.status?.name || '';
    default:
      return '';
  }
}

function extractFormulaValue(formula) {
  if (!formula) return '';
  switch (formula.type) {
    case 'string':
      return formula.string || '';
    case 'number':
      return formula.number != null ? String(formula.number) : '';
    case 'boolean':
      return formula.boolean ? 'true' : 'false';
    case 'date':
      return formula.date?.start || '';
    default:
      return '';
  }
}

function extractRollupValue(rollup) {
  if (!rollup) return '';
  switch (rollup.type) {
    case 'number':
      return rollup.number != null ? String(rollup.number) : '';
    case 'date':
      return rollup.date?.start || '';
    case 'array':
      return (rollup.array || []).map((item) => extractPropertyValue(item)).join(', ');
    default:
      return '';
  }
}

/**
 * Fetch a Notion block or page for content extraction.
 */
async function fetchBlock(config) {
  if (!notionEnabled()) {
    const err = new Error('Notion is not configured');
    err.statusCode = 501;
    throw err;
  }

  const { blockId, pageId } = config;
  const id = blockId || pageId;
  if (!id) {
    throw new Error('blockId or pageId is required for notion-block provider');
  }

  const blocks = await fetchAllBlockChildren(id, { limit: 50 });
  const lines = [];

  for (const block of blocks) {
    const type = String(block?.type || '');
    const data = block[type];
    const text = richTextToPlain(data?.rich_text || data?.text || []);
    if (text) {
      lines.push({ type, text, blockId: block.id });
    }
  }

  return { blocks: lines };
}

/**
 * Map database query results to binding source keys.
 *
 * Source key format for databases: `row[N].PropertyName`
 * Example bindings:
 *   { target: 'metrics[0].value', source: 'row[0].Revenue' }
 *   { target: 'metrics[0].label', source: 'row[0].Metric' }
 */
function parseDatabaseResponse(rows, bindings) {
  const result = {};

  for (const binding of bindings) {
    const source = binding.source;
    const rowMatch = source.match(/^row\[(\d+)\]\.(.+)$/);

    if (rowMatch) {
      const rowIndex = parseInt(rowMatch[1], 10);
      const propName = rowMatch[2];
      const row = rows[rowIndex];
      if (row) {
        result[source] = row[propName] ?? '';
      }
    }
  }

  return result;
}

/**
 * Map block content to binding source keys.
 *
 * Source key format: `block[N]` for the Nth text block,
 * or `block[N].text` / `block[N].type`.
 */
function parseBlockResponse(data, bindings) {
  const result = {};
  const blocks = data?.blocks || [];

  for (const binding of bindings) {
    const source = binding.source;

    const blockMatch = source.match(/^block\[(\d+)\](?:\.(\w+))?$/);
    if (blockMatch) {
      const idx = parseInt(blockMatch[1], 10);
      const field = blockMatch[2] || 'text';
      const block = blocks[idx];
      if (block) {
        result[source] = block[field] ?? '';
      }
    }
  }

  return result;
}

export const notionDatabaseProvider = createDataSourceProvider({
  name: 'notion-database',
  fetchData: queryDatabase,
  parseResponse: parseDatabaseResponse,
});

export const notionBlockProvider = createDataSourceProvider({
  name: 'notion-block',
  fetchData: fetchBlock,
  parseResponse: parseBlockResponse,
});

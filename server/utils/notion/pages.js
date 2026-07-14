/**
 * Notion Pages
 * Functions for fetching and extracting content from Notion pages.
 */

import { notionFetchJson, fetchAllBlockChildren } from './client.js';
import { richTextToPlain, pageTitleFromProperties, blockTextLine, extractImageFromBlock, extractPageId } from './parser.js';

export async function searchRecentPages({ pageSize = 50 } = {}) {
  return await searchPages({
    query: '',
    pageSize,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });
}

export async function searchPages({
  query = '',
  pageSize = 50,
  sort = { direction: 'descending', timestamp: 'last_edited_time' },
} = {}) {
  const body = {
    query: String(query || ''),
    filter: { property: 'object', value: 'page' },
    sort:
      sort && typeof sort === 'object'
        ? sort
        : { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: Math.max(1, Math.min(100, Number(pageSize) || 50)),
  };
  const out = await notionFetchJson('/search', { method: 'POST', body });
  const results = Array.isArray(out?.results) ? out.results : [];
  return results
    .filter((r) => r && typeof r === 'object' && r.object === 'page')
    .map((p) => ({
      id: String(p.id || ''),
      url: String(p.url || ''),
      lastEditedTime: String(p.last_edited_time || ''),
      createdBy: {
        id: String(p?.created_by?.id || ''),
        name: String(p?.created_by?.name || ''),
      },
      title:
        String(p?.properties?.title?.title?.[0]?.plain_text || '').trim() ||
        pageTitleFromProperties(p.properties) ||
        String(p?.id || '').slice(0, 8),
    }))
    .filter((p) => p.id);
}

/**
 * Extract table data from a table block.
 * Returns { headers: string[], rows: string[][] }
 */
async function extractTableFromBlock(block) {
  if (block?.type !== 'table') return null;

  const tableData = block.table;
  if (!tableData) return null;

  const hasColumnHeader = tableData.has_column_header;
  const hasRowHeader = tableData.has_row_header;

  // Fetch table rows (they are child blocks)
  let rows = [];
  try {
    const children = await fetchAllBlockChildren(block.id, { limit: 200 });
    for (const child of children) {
      if (child?.type !== 'table_row') continue;
      const cells = child.table_row?.cells || [];
      const rowData = cells.map((cell) => richTextToPlain(cell));
      rows.push(rowData);
    }
  } catch (e) {
    console.error('Failed to fetch table rows:', e);
    return null;
  }

  if (rows.length === 0) return null;

  // If has column header, first row is headers
  const headers = hasColumnHeader ? rows[0] : [];
  const dataRows = hasColumnHeader ? rows.slice(1) : rows;

  return {
    headers,
    rows: dataRows,
    hasColumnHeader,
    hasRowHeader,
    blockId: block.id,
  };
}

/**
 * Extract rich content from a Notion page.
 * Returns structured data similar to PPTX parser output.
 */
export async function extractRichContentFromPage(pageId, { depth = 3, limit = 600 } = {}) {
  const id = String(pageId || '').trim();
  if (!id) {
    const err = new Error('Page ID is required');
    err.statusCode = 400;
    throw err;
  }

  // Fetch page metadata
  const page = await notionFetchJson(`/pages/${id}`, { method: 'GET' });
  const title = pageTitleFromProperties(page?.properties) || 'Untitled';
  const lastEdited = page?.last_edited_time || null;

  // Fetch all blocks
  const blocks = await fetchAllBlockChildren(id, { limit });

  const sections = [];
  let currentSection = {
    heading: null,
    textContent: '',
    images: [],
    tables: [],
  };

  async function processBlock(block, indent = 0) {
    const type = String(block?.type || '');

    // New section on major heading
    if (type === 'heading_1' || type === 'heading_2') {
      // Save current section if it has content
      if (currentSection.textContent.trim() || currentSection.images.length || currentSection.tables.length) {
        sections.push(currentSection);
      }
      const headingText = richTextToPlain(block[type]?.rich_text);
      currentSection = {
        heading: headingText || null,
        textContent: '',
        images: [],
        tables: [],
      };
      return;
    }

    // Extract image
    if (type === 'image') {
      const img = extractImageFromBlock(block);
      if (img) {
        currentSection.images.push(img);
        if (img.caption) {
          currentSection.textContent += `[Image: ${img.caption}]\n`;
        }
      }
      return;
    }

    // Extract table
    if (type === 'table') {
      const table = await extractTableFromBlock(block);
      if (table) {
        currentSection.tables.push(table);
        // Add table as text representation too
        let tableText = '\n[Table]\n';
        if (table.headers.length) {
          tableText += `| ${table.headers.join(' | ')} |\n`;
        }
        for (const row of table.rows) {
          tableText += `| ${row.join(' | ')} |\n`;
        }
        currentSection.textContent += tableText;
      }
      return;
    }

    // Regular text block
    const line = blockTextLine(block, indent);
    if (line) {
      currentSection.textContent += line;
    }

    // Process children
    if (block.has_children && depth > 0) {
      try {
        const children = await fetchAllBlockChildren(block.id, { limit: 100 });
        for (const child of children) {
          await processBlock(child, indent + 1);
        }
      } catch {
        // Ignore child fetch errors
      }
    }
  }

  // Process all blocks
  for (const block of blocks) {
    await processBlock(block, 0);
  }

  // Don't forget the last section
  if (currentSection.textContent.trim() || currentSection.images.length || currentSection.tables.length) {
    sections.push(currentSection);
  }

  // Collect all images for easy access
  const allImages = sections.flatMap((s) => s.images);

  return {
    title,
    pageId: id,
    sections,
    allImages,
    metadata: {
      lastEdited,
    },
  };
}

/**
 * Format rich Notion content for AI processing.
 * Creates a text representation suitable for the two-phase AI pipeline.
 */
export function formatNotionContentForAi(richContent) {
  const lines = [];

  lines.push(`NOTION PAGE: ${richContent.title}`);
  lines.push('');
  lines.push('=== CONTENT ===');
  lines.push('');

  for (const section of richContent.sections) {
    if (section.heading) {
      lines.push(`## ${section.heading}`);
      lines.push('');
    }

    if (section.textContent.trim()) {
      lines.push(section.textContent.trim());
      lines.push('');
    }

    // Note images for AI context
    if (section.images.length > 0) {
      for (const img of section.images) {
        if (img.caption) {
          lines.push(`[IMAGE: ${img.caption}]`);
        } else {
          lines.push('[IMAGE]');
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

async function blocksToPlainTextPreview(blocks, {
  limit = 120,
  maxChildFetches = 4,
  childLimit = 40,
} = {}) {
  const lines = [];
  const stack = Array.isArray(blocks) ? blocks.slice(0, limit) : [];
  let childFetches = 0;

  for (const b of stack) {
    if (!b || typeof b !== 'object') continue;
    lines.push(blockTextLine(b, 0));
    if (!b.has_children) continue;
    if (childFetches >= maxChildFetches) continue;
    const id = String(b.id || '').trim();
    if (!id) continue;
    childFetches++;
    let children = [];
    try {
      children = await fetchAllBlockChildren(id, { limit: childLimit });
    } catch {
      children = [];
    }
    for (const c of children) {
      if (!c || typeof c !== 'object') continue;
      lines.push(blockTextLine(c, 1));
    }
  }

  return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
}

async function blocksToPlainText(blocks, { depth = 2, limit = 400 } = {}) {
  const lines = [];
  const stack = Array.isArray(blocks) ? blocks.slice(0, limit) : [];

  async function walk(blockList, indent, remainingDepth) {
    for (const b of blockList) {
      if (!b || typeof b !== 'object') continue;
      lines.push(blockTextLine(b, indent));
      if (remainingDepth <= 0) continue;
      if (!b.has_children) continue;
      const id = String(b.id || '').trim();
      if (!id) continue;
      const children = await fetchAllBlockChildren(id, { limit: 200 });
      await walk(children, indent + 1, remainingDepth - 1);
    }
  }

  await walk(stack, 0, Math.max(0, depth));
  return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export async function getPlainTextFromPage(pageId, opts = {}) {
  const id = String(pageId || '').trim();
  if (!id) return '';
  const blocks = await fetchAllBlockChildren(id, { limit: 400 });
  return await blocksToPlainText(blocks, opts);
}

// Fast-ish "is there real content?" helper for subject picking.
export async function getPlainTextPreviewFromPage(
  pageId,
  { limit = 120 } = {}
) {
  const id = String(pageId || '').trim();
  if (!id) return '';
  const blocks = await fetchAllBlockChildren(id, {
    limit: Math.max(1, Math.min(200, Number(limit) || 120)),
  });
  return await blocksToPlainTextPreview(blocks, {
    limit: blocks.length,
    maxChildFetches: 4,
    childLimit: 40,
  });
}

/**
 * Fetch a Notion page by URL or ID.
 * Returns { title, content, pageId } or throws an error.
 */
export async function fetchNotionPage(urlOrId) {
  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    const err = new Error('Invalid Notion URL or page ID');
    err.statusCode = 400;
    throw err;
  }

  // Fetch page metadata for title
  const page = await notionFetchJson(`/pages/${pageId}`, { method: 'GET' });
  const title = pageTitleFromProperties(page?.properties) || 'Untitled';

  // Fetch content
  const content = await getPlainTextFromPage(pageId, { depth: 3, limit: 600 });

  return { title, content, pageId };
}
/**
 * Per-type content fixers.
 *
 * Type-specific repairs and smart defaults applied to AI-generated slide
 * content: table schema coercion, list layout auto-switch, text-blocks
 * defaults, icon-card-grid optimization hints, and body builders used when a
 * slide is downgraded to a content-slide.
 */

import { logValidation } from './logging.js';

/**
 * Fix table-slide content if AI returned wrong schema
 * Converts TSV string or other formats to proper rows array
 */
export function fixTableSlideContent(content) {
  if (!content) return content;

  // If rows already exists and is valid, just ensure proper structure
  if (Array.isArray(content.rows) && content.rows.length > 0) {
    // Validate row structure
    const firstRow = content.rows[0];
    if (firstRow && typeof firstRow === 'object' && 'c1' in firstRow) {
      return content; // Already valid
    }
    // Try to convert if rows are arrays instead of objects
    if (Array.isArray(firstRow)) {
      logValidation('convert-table-rows', {
        reason: 'rows are arrays instead of {c1, c2...} objects',
        rowCount: content.rows.length,
      });
      const fixedRows = content.rows.map(row => {
        if (!Array.isArray(row)) return row;
        const obj = {};
        row.forEach((cell, idx) => {
          obj[`c${idx + 1}`] = String(cell);
        });
        return obj;
      });
      return { ...content, rows: fixedRows, colCount: String(firstRow.length) };
    }
  }

  // Check if AI returned a 'table' field as TSV string instead of 'rows' array
  if (typeof content.table === 'string' && content.table.includes('\t')) {
    logValidation('convert-table-tsv', {
      reason: 'AI returned table as TSV string instead of rows array',
      preview: content.table.slice(0, 100),
    });

    const lines = content.table.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const rows = [];
      let colCount = 0;

      for (const line of lines) {
        const cells = line.split('\t');
        colCount = Math.max(colCount, cells.length);
        const row = {};
        cells.forEach((cell, idx) => {
          row[`c${idx + 1}`] = cell.trim();
        });
        rows.push(row);
      }

      // Remove the erroneous 'table' field and add proper 'rows'
      const { table: _, ...rest } = content;
      return {
        ...rest,
        rows,
        colCount: String(colCount),
        headerRow: content.headerRow || 'on',
      };
    }
  }

  // Check for 'data' field (sometimes AI confuses with chart-slide)
  if (typeof content.data === 'string' && content.data.includes('\t') && !content.chartType) {
    logValidation('convert-table-from-data', {
      reason: 'AI returned table data in chart-slide format',
      preview: content.data.slice(0, 100),
    });

    const lines = content.data.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const rows = [];
      let colCount = 0;

      for (const line of lines) {
        const cells = line.split('\t');
        colCount = Math.max(colCount, cells.length);
        const row = {};
        cells.forEach((cell, idx) => {
          row[`c${idx + 1}`] = cell.trim();
        });
        rows.push(row);
      }

      const { data: _, ...rest } = content;
      return {
        ...rest,
        rows,
        colCount: String(colCount),
        headerRow: content.headerRow || 'on',
      };
    }
  }

  return content;
}

/**
 * Fix list-slide layout based on item count
 * Auto-switch to two-column when 5+ items to prevent overflow
 */
export function fixLijstjeSlideLayout(content) {
  if (!content) return content;

  const items = content.items;
  if (!Array.isArray(items)) return content;

  // If 5 or more items and not already two-column, switch to two-column
  if (items.length >= 5 && content.layout !== 'two-column') {
    logValidation('auto-layout-switch', {
      slideType: 'list-slide',
      itemCount: items.length,
      from: content.layout || 'one-column',
      to: 'two-column',
      reason: '5+ items require two-column layout to fit',
    });
    return { ...content, layout: 'two-column' };
  }

  return content;
}

/**
 * Apply smart defaults to text-blocks-slide
 * If 2 rows with no explicit colors, alternate yellow/black and add arrow
 */
export function fixTextBlocksSlideDefaults(content) {
  if (!content) return content;

  const rows = content.rows;
  if (!Array.isArray(rows) || rows.length < 2) return content;

  // Check if colors are explicitly set (not just defaults)
  const hasExplicitColors = rows.some(r => r.color && r.color !== 'yellow');

  if (!hasExplicitColors && rows.length === 2) {
    // Apply alternating colors; only set arrow if not already specified
    const fixedRows = rows.map((row, idx) => ({
      ...row,
      color: idx % 2 === 0 ? 'yellow' : 'black',
      arrow: row.arrow && row.arrow !== 'none' ? row.arrow : (idx === 0 ? 'down' : 'none'),
    }));

    logValidation('auto-text-blocks-defaults', {
      slideType: 'text-blocks-slide',
      rowCount: rows.length,
      reason: 'Applied alternating colors (yellow/black) and arrow for visual hierarchy',
    });

    return { ...content, rows: fixedRows };
  }

  return content;
}

/**
 * Check icon-card-grid for optimal grid sizing
 * Returns metadata about optimal layout
 */
export function getIconCardGridOptimization(content) {
  if (!content) return null;

  const items = content.items;
  if (!Array.isArray(items)) return null;

  // 4 items is optimal for a 2×2 grid
  if (items.length === 4) {
    return 'Optimal 2×2 grid layout for 4 items';
  }

  // 6 items is good for 2×3 or 3×2
  if (items.length === 6) {
    return 'Good for 2×3 or 3×2 grid layout';
  }

  return null;
}

/**
 * Build markdown body from lijstje items
 */
export function buildBodyFromItems(items, content) {
  if (!items || items.length === 0) {
    return content.subheading || 'No content available.';
  }

  const lines = [];
  if (content.subheading) {
    lines.push(content.subheading);
    lines.push('');
  }

  for (const item of items) {
    if (item.title && item.text) {
      lines.push(`**${item.title}**: ${item.text}`);
    } else if (item.title) {
      lines.push(`- ${item.title}`);
    } else if (item.text) {
      lines.push(`- ${item.text}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build markdown body from timeline items
 */
export function buildBodyFromTimelineItems(items) {
  if (!items || items.length === 0) {
    return 'No timeline items.';
  }

  const lines = [];
  for (const item of items) {
    const parts = [];
    if (item.time) parts.push(`**${item.time}**:`);
    if (item.title) parts.push(item.title);
    if (item.text) parts.push(`- ${item.text}`);
    lines.push(parts.join(' '));
  }

  return lines.join('\n\n');
}

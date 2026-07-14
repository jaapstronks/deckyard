/**
 * Slide Validation and Fixing
 *
 * Ensures AI-generated slides meet the minimum requirements for each slide type.
 * Fixes common issues like too few items and text exceeding max lengths.
 *
 * Includes Zod schema validation for defense-in-depth type checking.
 * Logs unknown fields that AI generates but the slide type doesn't support.
 */

import { validateSlideContent } from './schemas/index.js';
import { SLIDE_TYPES } from '../../../shared/slide-types/registry.js';
import { logValidationEvent } from './validation-logging.js';

// In-memory log accumulator for quick access (recent entries only)
const validationLog = [];
const MAX_IN_MEMORY_LOGS = 500;

/**
 * Log a validation event (persisted to disk and kept in memory)
 */
function logValidation(event, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };

  // Keep in memory for quick access (limited)
  validationLog.push(entry);
  if (validationLog.length > MAX_IN_MEMORY_LOGS) {
    validationLog.shift();
  }

  // Persist to disk via validation-logging module
  logValidationEvent(event, details);
}

/**
 * Get recent validation logs from memory (for debugging)
 */
export function getRecentValidationLogs(limit = 50) {
  return validationLog.slice(-limit);
}

/**
 * Clear in-memory validation logs
 */
export function clearValidationLogs() {
  validationLog.length = 0;
}

// Slide types with item minimums
const SLIDE_ITEM_REQUIREMENTS = {
  'list-slide': { field: 'items', min: 2, max: 8 },
  'lijstje-slide': { field: 'items', min: 2, max: 8 }, // Back-compat alias
  'timeline-slide': { field: 'items', min: 2, max: 10 },
  'kpi-metrics-slide': { field: 'metrics', min: 1, max: 4 },
};

// Global accessibility fields that are added to all slide types
const GLOBAL_A11Y_FIELDS = ['a11yTitle', 'a11ySummary'];

// Cache for extracted field keys per slide type
const fieldKeysCache = new Map();

/**
 * Extract all valid field keys from a slide type definition
 * Includes fields from the slide type's fields array plus global a11y fields
 *
 * @param {string} slideType - The slide type name (e.g., 'content-slide')
 * @returns {Set<string>} Set of valid field keys
 */
function getValidFieldKeys(slideType) {
  if (fieldKeysCache.has(slideType)) {
    return fieldKeysCache.get(slideType);
  }

  const typeDef = SLIDE_TYPES[slideType];
  const keys = new Set(GLOBAL_A11Y_FIELDS);

  if (typeDef && Array.isArray(typeDef.fields)) {
    for (const field of typeDef.fields) {
      if (field && typeof field.key === 'string') {
        keys.add(field.key);
      }
    }
  }

  fieldKeysCache.set(slideType, keys);
  return keys;
}

/**
 * Check for unknown fields in slide content that the slide type doesn't support.
 * Logs warnings for debugging and prompt improvement.
 *
 * @param {string} slideType - The slide type name
 * @param {Object} content - The slide content object
 * @param {Object} context - Additional context for logging
 */
function checkForUnknownFields(slideType, content, context = {}) {
  if (!content || typeof content !== 'object') return;
  if (!SLIDE_TYPES[slideType]) {
    // Unknown slide type - can't validate fields
    return;
  }

  const validKeys = getValidFieldKeys(slideType);
  const contentKeys = Object.keys(content);
  const unknownKeys = contentKeys.filter((key) => !validKeys.has(key));

  if (unknownKeys.length > 0) {
    // Check which unknown fields have meaningful content (not empty/null)
    const unknownWithContent = unknownKeys.filter((key) => {
      const value = content[key];
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && !value.trim()) return false;
      return true;
    });

    if (unknownWithContent.length > 0) {
      logValidation('unknown-fields', {
        slideType,
        unknownFields: unknownWithContent,
        // Include sample values for debugging (truncated)
        sampleValues: Object.fromEntries(
          unknownWithContent.map((key) => {
            const val = content[key];
            const str = typeof val === 'string' ? val : JSON.stringify(val);
            return [key, str.length > 100 ? str.slice(0, 100) + '...' : str];
          })
        ),
        validFields: Array.from(validKeys).slice(0, 10), // Show some valid options
        ...context,
      });
    }
  }
}

// Max lengths for common fields (to avoid validation errors)
const MAX_LENGTHS = {
  title: 120,
  subheading: 200,
  body: 2000,
  // list-slide items
  'items.title': 80,
  'items.text': 120,
  // card-stack-slide
  cardLabel: 40,
  cardBody: 800,
  // text-blocks-slide
  blockTitle: 80,
  blockBody: 200,
  // timeline items
  'items.time': 60,
  // quote
  quote: 280,
  authorName: 80,
  authorTitle: 120,
  // misc
  tagline: 120,
  caption: 200,
};

/**
 * Truncate a string to max length, adding ellipsis if needed
 */
function truncate(str, maxLen, fieldName = 'unknown') {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  const truncated = str.slice(0, maxLen - 3) + '...';
  logValidation('truncate-field', {
    field: fieldName,
    originalLength: str.length,
    maxLength: maxLen,
    preview: str.slice(0, 50) + (str.length > 50 ? '...' : ''),
  });
  return truncated;
}

/**
 * Truncate all text fields in content to their max lengths
 */
function truncateContentFields(type, content) {
  if (!content || typeof content !== 'object') return content;

  const fixed = { ...content };

  // Common fields
  if (fixed.title) fixed.title = truncate(fixed.title, MAX_LENGTHS.title, 'title');
  if (fixed.subheading) fixed.subheading = truncate(fixed.subheading, MAX_LENGTHS.subheading, 'subheading');
  if (fixed.body) fixed.body = truncate(fixed.body, MAX_LENGTHS.body, 'body');
  if (fixed.tagline) fixed.tagline = truncate(fixed.tagline, MAX_LENGTHS.tagline, 'tagline');
  if (fixed.caption) fixed.caption = truncate(fixed.caption, MAX_LENGTHS.caption, 'caption');
  if (fixed.quote) fixed.quote = truncate(fixed.quote, MAX_LENGTHS.quote, 'quote');
  if (fixed.authorName) fixed.authorName = truncate(fixed.authorName, MAX_LENGTHS.authorName, 'authorName');
  if (fixed.authorTitle) fixed.authorTitle = truncate(fixed.authorTitle, MAX_LENGTHS.authorTitle, 'authorTitle');

  // Array items (lijstje, timeline, metrics)
  if (Array.isArray(fixed.items)) {
    fixed.items = fixed.items.map((item, idx) => {
      if (!item || typeof item !== 'object') return item;
      return {
        ...item,
        title: item.title ? truncate(item.title, MAX_LENGTHS['items.title'], `items[${idx}].title`) : item.title,
        text: item.text ? truncate(item.text, MAX_LENGTHS['items.text'], `items[${idx}].text`) : item.text,
        time: item.time ? truncate(item.time, MAX_LENGTHS['items.time'], `items[${idx}].time`) : item.time,
      };
    });
  }

  if (Array.isArray(fixed.metrics)) {
    fixed.metrics = fixed.metrics.map((m, idx) => {
      if (!m || typeof m !== 'object') return m;
      return {
        ...m,
        label: m.label ? truncate(m.label, 60, `metrics[${idx}].label`) : m.label,
        value: m.value ? truncate(String(m.value), 30, `metrics[${idx}].value`) : m.value,
        unit: m.unit ? truncate(m.unit, 12, `metrics[${idx}].unit`) : m.unit,
        delta: m.delta ? truncate(m.delta, 24, `metrics[${idx}].delta`) : m.delta,
        note: m.note ? truncate(m.note, 80, `metrics[${idx}].note`) : m.note,
      };
    });
  }

  // Table rows (table-slide)
  if (Array.isArray(fixed.rows)) {
    fixed.rows = fixed.rows.map((row, rowIdx) => {
      if (!row || typeof row !== 'object') return row;
      const fixedRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string') {
          // Table cells should be reasonably short (max 200 chars)
          fixedRow[key] = truncate(value, 200, `rows[${rowIdx}].${key}`);
        } else {
          fixedRow[key] = value;
        }
      }
      return fixedRow;
    });
  }

  // Card fields (card-stack, icon-card-grid, team-cards)
  for (let i = 1; i <= 6; i++) {
    const labelKey = `card${i}Label`;
    const bodyKey = `card${i}Body`;
    const titleKey = `card${i}Title`;
    const nameKey = `card${i}Name`;
    const bylineKey = `card${i}Byline`;

    if (fixed[labelKey]) fixed[labelKey] = truncate(fixed[labelKey], MAX_LENGTHS.cardLabel, labelKey);
    if (fixed[bodyKey]) fixed[bodyKey] = truncate(fixed[bodyKey], MAX_LENGTHS.cardBody, bodyKey);
    if (fixed[titleKey]) fixed[titleKey] = truncate(fixed[titleKey], MAX_LENGTHS.title, titleKey);
    if (fixed[nameKey]) fixed[nameKey] = truncate(fixed[nameKey], 80, nameKey);
    if (fixed[bylineKey]) fixed[bylineKey] = truncate(fixed[bylineKey], 120, bylineKey);
  }

  // Text-blocks row fields
  for (let row = 1; row <= 3; row++) {
    for (let block = 1; block <= 6; block++) {
      const titleKey = `row${row}Block${block}Title`;
      const bodyKey = `row${row}Block${block}Body`;
      if (fixed[titleKey]) fixed[titleKey] = truncate(fixed[titleKey], MAX_LENGTHS.blockTitle, titleKey);
      if (fixed[bodyKey]) fixed[bodyKey] = truncate(fixed[bodyKey], MAX_LENGTHS.blockBody, bodyKey);
    }
    const rowTitleKey = `row${row}Title`;
    if (fixed[rowTitleKey]) fixed[rowTitleKey] = truncate(fixed[rowTitleKey], MAX_LENGTHS.title, rowTitleKey);
  }

  return fixed;
}

/**
 * Fix table-slide content if AI returned wrong schema
 * Converts TSV string or other formats to proper rows array
 */
function fixTableSlideContent(content) {
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
function fixLijstjeSlideLayout(content) {
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
function fixTextBlocksSlideDefaults(content) {
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
function getIconCardGridOptimization(content) {
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
 * Validate and fix a refined slide to meet minimum requirements
 *
 * @param {Object} slide - The refined slide
 * @returns {Object} Fixed slide
 */
export function validateAndFixSlide(slide) {
  const type = slide?.type;
  let content = slide?.content || {};

  // Special handling for table-slide schema issues
  if (type === 'table-slide') {
    content = fixTableSlideContent(content);
  }

  // Auto-fix list-slide layout based on item count
  if (type === 'list-slide' || type === 'lijstje-slide') {
    content = fixLijstjeSlideLayout(content);
  }

  // Apply smart defaults to text-blocks-slide (alternating colors, arrows)
  if (type === 'text-blocks-slide') {
    content = fixTextBlocksSlideDefaults(content);
  }

  // First, truncate all text fields to their max lengths
  const truncatedContent = truncateContentFields(type, content);
  const fixedSlide = { ...slide, content: truncatedContent };

  // Add icon-card-grid optimization note to reasoning
  if (type === 'icon-card-grid-slide') {
    const optimization = getIconCardGridOptimization(truncatedContent);
    if (optimization) {
      fixedSlide.reasoning = (fixedSlide.reasoning || '').trim();
      if (fixedSlide.reasoning) {
        fixedSlide.reasoning += ` — ${optimization}`;
      } else {
        fixedSlide.reasoning = optimization;
      }
    }
  }

  // Zod schema validation (defense-in-depth, logs issues for debugging)
  const zodResult = validateSlideContent(type, truncatedContent);
  if (!zodResult.valid && zodResult.issues.length > 0) {
    logValidation('zod-validation-issues', {
      slideType: type,
      originalIndex: slide.originalIndex,
      issues: zodResult.issues,
    });
  }

  // Check for unknown fields that the AI generated but the slide type doesn't support
  // This helps identify content loss and improve prompts
  checkForUnknownFields(type, truncatedContent, {
    originalIndex: slide.originalIndex,
    title: truncatedContent.title,
  });

  const req = SLIDE_ITEM_REQUIREMENTS[type];
  if (!req) return fixedSlide;

  let arr = truncatedContent[req.field];

  // If field doesn't exist or isn't an array, it will fail validation anyway
  if (!Array.isArray(arr)) {
    logValidation('warn-missing-array', {
      slideType: type,
      field: req.field,
      originalIndex: slide.originalIndex,
      received: typeof truncatedContent[req.field],
    });
    return fixedSlide;
  }

  // Check if we have too many items - truncate to max
  if (req.max && arr.length > req.max) {
    const originalCount = arr.length;
    logValidation('truncate-items', {
      slideType: type,
      field: req.field,
      from: originalCount,
      to: req.max,
      originalIndex: slide.originalIndex,
    });
    arr = arr.slice(0, req.max);
    fixedSlide.content = {
      ...truncatedContent,
      [req.field]: arr,
    };
    fixedSlide.reasoning = (fixedSlide.reasoning || '') + ` [Truncated from ${originalCount} to ${req.max} items]`;
  }

  // Check if we have enough items
  if (arr.length < req.min) {
    logValidation('warn-insufficient-items', {
      slideType: type,
      field: req.field,
      itemCount: arr.length,
      minRequired: req.min,
      originalIndex: slide.originalIndex,
    });

    // Option 1: Convert to content-slide if there's only 1 item or 0 items
    if (arr.length <= 1 && (type === 'list-slide' || type === 'lijstje-slide')) {
      logValidation('convert-slide-type', {
        from: type,
        to: 'content-slide',
        reason: 'insufficient items (<=1)',
        originalIndex: slide.originalIndex,
        title: truncatedContent.title,
      });
      return {
        ...fixedSlide,
        type: 'content-slide',
        content: {
          title: truncatedContent.title || 'Content',
          body: buildBodyFromItems(arr, truncatedContent),
          layout: 'one-column',
          background: truncatedContent.background || 'lime',
        },
        reasoning: (fixedSlide.reasoning || '') + ' [Converted from list-slide due to insufficient items]',
      };
    }

    // Option 2: For timeline slides with < 2 items, use content-slide
    if (arr.length < 2 && type === 'timeline-slide') {
      logValidation('convert-slide-type', {
        from: type,
        to: 'content-slide',
        reason: 'insufficient items (<2)',
        originalIndex: slide.originalIndex,
        title: truncatedContent.title,
      });
      return {
        ...fixedSlide,
        type: 'content-slide',
        content: {
          title: truncatedContent.title || 'Timeline',
          body: buildBodyFromTimelineItems(arr),
          layout: 'one-column',
          background: truncatedContent.background || 'lime',
        },
        reasoning: (fixedSlide.reasoning || '') + ' [Converted from timeline-slide due to insufficient items]',
      };
    }

    // Option 3: Duplicate items to meet minimum (last resort)
    if (arr.length > 0 && arr.length < req.min) {
      logValidation('pad-items', {
        slideType: type,
        from: arr.length,
        to: req.min,
        originalIndex: slide.originalIndex,
      });
      const paddedArr = [...arr];
      while (paddedArr.length < req.min) {
        // Clone the last item with a modified title
        const lastItem = { ...paddedArr[paddedArr.length - 1] };
        if (lastItem.title) {
          lastItem.title = `${lastItem.title} (${paddedArr.length + 1})`;
        }
        paddedArr.push(lastItem);
      }
      return {
        ...fixedSlide,
        content: {
          ...truncatedContent,
          [req.field]: paddedArr,
        },
        reasoning: (fixedSlide.reasoning || '') + ' [Items padded to meet minimum]',
      };
    }
  }

  return fixedSlide;
}

/**
 * Build markdown body from lijstje items
 */
function buildBodyFromItems(items, content) {
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
function buildBodyFromTimelineItems(items) {
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

/**
 * Add content-aware warnings to a slide
 * These are non-blocking suggestions shown to users in the editor
 *
 * @param {Object} slide - The slide to check
 * @param {Object} prevSlide - The previous slide (for repetition check)
 * @returns {Array<string>} Array of warning messages
 */
function getContentWarnings(slide, prevSlide = null) {
  const warnings = [];
  const type = slide?.type;
  const content = slide?.content;

  if (!type || !content) return warnings;

  // Density checks
  if (type === 'list-slide' && content.items?.length > 6) {
    warnings.push('This list has many items — consider splitting into two slides or using two-column layout.');
  }
  if (type === 'icon-card-grid-slide' && content.items?.length > 5) {
    warnings.push('Dense card grid — consider reducing to 4 cards for better readability.');
  }
  if (type === 'content-slide' && content.body && content.body.length > 1200) {
    warnings.push('Long content slide — consider splitting into two slides or using a more specialized type.');
  }
  if (type === 'timeline-slide' && content.items?.length > 6) {
    warnings.push('Timeline has many items — consider splitting into multiple slides for clarity.');
  }
  if (type === 'text-blocks-slide' && content.rows?.length >= 3) {
    const totalBlocks = (content.rows || []).reduce((sum, r) => sum + (r.blocks?.length || 0), 0);
    if (totalBlocks > 8) {
      warnings.push('Dense text-blocks layout — consider reducing blocks or splitting into two slides.');
    }
  }

  // Readability: title approaching max length
  if (content.title && content.title.length > 100) {
    warnings.push('Long title — consider shortening for better readability on screen.');
  }

  // Readability: list items with long text
  if ((type === 'list-slide' || type === 'lijstje-slide') && content.items?.length) {
    const longItems = content.items.filter(item => item?.text && item.text.length > 100);
    if (longItems.length >= 2) {
      warnings.push('Several list items have long descriptions — consider trimming for slide readability.');
    }
  }

  // Readability: icon-card-grid items with long body text
  if (type === 'icon-card-grid-slide' && content.items?.length) {
    const longCards = content.items.filter(item => item?.body && item.body.length > 200);
    if (longCards.length >= 2) {
      warnings.push('Multiple cards have long body text — cards work best with concise descriptions (under 200 chars).');
    }
  }

  // Readability: KPI metrics with overlong labels or notes
  if (type === 'kpi-metrics-slide' && content.metrics?.length) {
    const longLabels = content.metrics.filter(m => m?.label && m.label.length > 40);
    if (longLabels.length >= 1) {
      warnings.push('KPI label is quite long — shorter labels have more visual impact.');
    }
  }

  // Readability: subheading approaching max length
  if (content.subheading && content.subheading.length > 180) {
    warnings.push('Long subheading — consider shortening or moving detail into slide body.');
  }

  // Repetition check
  if (prevSlide && prevSlide.type === type) {
    // Only warn for content-heavy types that might feel repetitive
    const repetitiveTypes = new Set([
      'list-slide', 'lijstje-slide', 'icon-card-grid-slide', 'text-blocks-slide', 'content-slide',
    ]);
    if (repetitiveTypes.has(type)) {
      warnings.push(`Same slide type as previous slide (${type}) — consider varying the layout for visual interest.`);
    }
  }

  return warnings;
}

/**
 * Validate and fix all refined slides
 *
 * @param {Array} refinedSlides - Array of refined slides from Phase 2
 * @returns {Array} Fixed slides
 */
export function validateAndFixRefinedSlides(refinedSlides) {
  if (!Array.isArray(refinedSlides)) return [];

  const fixedSlides = [];
  for (let i = 0; i < refinedSlides.length; i++) {
    const slide = refinedSlides[i];
    const prevSlide = i > 0 ? fixedSlides[i - 1] : null;
    const fixedSlide = validateAndFixSlide(slide);

    // Add content-aware warnings
    const warnings = getContentWarnings(fixedSlide, prevSlide);
    if (warnings.length > 0) {
      fixedSlide._aiWarnings = warnings;
    }

    fixedSlides.push(fixedSlide);
  }

  // Deck-level balance check: warn if too many content-slides
  const contentSlideTypes = new Set(['content-slide']);
  const specializedTypes = new Set([
    'list-slide', 'lijstje-slide', 'icon-card-grid-slide', 'text-blocks-slide',
    'timeline-slide', 'kpi-metrics-slide', 'team-cards-slide', 'process-slide',
    'comparison-slide', 'matrix-slide',
  ]);
  const contentSlides = fixedSlides.filter(s => contentSlideTypes.has(s.type));
  const totalContentish = fixedSlides.filter(s =>
    contentSlideTypes.has(s.type) || specializedTypes.has(s.type)
  );

  if (totalContentish.length >= 4 && contentSlides.length / totalContentish.length > 0.6) {
    // Add warning to first content-slide
    const firstContent = fixedSlides.find(s => s.type === 'content-slide');
    if (firstContent) {
      firstContent._aiWarnings = firstContent._aiWarnings || [];
      firstContent._aiWarnings.push(
        `${contentSlides.length} of ${totalContentish.length} content slides use the generic content-slide type — consider converting some to specialized types (list, icon-cards, text-blocks) for visual variety.`
      );
    }
  }

  return fixedSlides;
}

/**
 * Strict validation error thrown by validateRefinedSlidesStrict.
 * Carries structured detail so MCP callers can pinpoint the first failure
 * without parsing prose error messages.
 */
export class RawSlideValidationError extends Error {
  constructor({ slideIndex, slideType, field, expected, got, message }) {
    super(message);
    this.name = 'RawSlideValidationError';
    this.slideIndex = slideIndex;
    this.slideType = slideType;
    this.field = field;
    this.expected = expected;
    this.got = got;
    this.details = { slideIndex, slideType, field, expected, got, message };
  }
}

// Max length table used both by truncation (fix mode) and strict validation.
// Mirrors MAX_LENGTHS / item-level limits defined elsewhere in this file.
const STRICT_TEXT_LIMITS = {
  title: MAX_LENGTHS.title,
  subheading: MAX_LENGTHS.subheading,
  body: MAX_LENGTHS.body,
  tagline: MAX_LENGTHS.tagline,
  caption: MAX_LENGTHS.caption,
  quote: MAX_LENGTHS.quote,
  authorName: MAX_LENGTHS.authorName,
  authorTitle: MAX_LENGTHS.authorTitle,
};

const STRICT_ITEM_LIMITS = {
  title: MAX_LENGTHS['items.title'],
  text: MAX_LENGTHS['items.text'],
  time: MAX_LENGTHS['items.time'],
};

/**
 * Validate a single raw slide and throw RawSlideValidationError on first issue.
 *
 * Checks:
 * - slide.type exists in SLIDE_TYPES
 * - content matches Zod schema (when available for that type)
 * - item-bearing types meet min/max count requirements
 * - common text fields are within their max length
 *
 * @param {Object} slide - { type, content, notes? }
 * @param {number} index - Slide index in the raw input array (for error reporting)
 */
function validateSlideStrict(slide, index) {
  const type = slide?.type;
  const content = slide?.content;

  if (!type || typeof type !== 'string') {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: null,
      field: 'type',
      expected: 'non-empty string',
      got: type,
      message: `Slide ${index}: missing or invalid "type"`,
    });
  }

  if (!SLIDE_TYPES[type]) {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: 'type',
      expected: 'known slide type (see get_slide_types)',
      got: type,
      message: `Slide ${index}: unknown slide type "${type}"`,
    });
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: 'content',
      expected: 'object',
      got: Array.isArray(content) ? 'array' : typeof content,
      message: `Slide ${index}: "content" must be an object`,
    });
  }

  // Item count (min/max)
  const req = SLIDE_ITEM_REQUIREMENTS[type];
  if (req) {
    const arr = content[req.field];
    if (!Array.isArray(arr)) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `array with ${req.min}–${req.max} items`,
        got: arr === undefined ? 'undefined' : typeof arr,
        message: `Slide ${index} (${type}): "${req.field}" must be an array`,
      });
    }
    if (arr.length < req.min) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `minItems ${req.min}`,
        got: arr.length,
        message: `Slide ${index} (${type}): "${req.field}" requires at least ${req.min} items (got ${arr.length})`,
      });
    }
    if (req.max && arr.length > req.max) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `maxItems ${req.max}`,
        got: arr.length,
        message: `Slide ${index} (${type}): "${req.field}" allows at most ${req.max} items (got ${arr.length})`,
      });
    }
  }

  // Common text-field length caps
  for (const [field, max] of Object.entries(STRICT_TEXT_LIMITS)) {
    const v = content[field];
    if (typeof v === 'string' && v.length > max) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field,
        expected: `maxLength ${max}`,
        got: v.length,
        message: `Slide ${index} (${type}): "${field}" exceeds max length (${v.length} > ${max})`,
      });
    }
  }

  // Array-item text caps (items[].title / text / time)
  if (Array.isArray(content.items)) {
    content.items.forEach((item, itemIdx) => {
      if (!item || typeof item !== 'object') return;
      for (const [field, max] of Object.entries(STRICT_ITEM_LIMITS)) {
        const v = item[field];
        if (typeof v === 'string' && v.length > max) {
          throw new RawSlideValidationError({
            slideIndex: index,
            slideType: type,
            field: `items[${itemIdx}].${field}`,
            expected: `maxLength ${max}`,
            got: v.length,
            message: `Slide ${index} (${type}): items[${itemIdx}].${field} exceeds max length (${v.length} > ${max})`,
          });
        }
      }
    });
  }

  // Zod schema (defense in depth). Only enforced when a schema is registered
  // for this type; unknown-to-Zod types fall back to the checks above.
  const zod = validateSlideContent(type, content);
  if (!zod.valid && zod.issues.length > 0) {
    const first = zod.issues[0];
    const [pathPart, ...rest] = first.split(':');
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: pathPart.trim(),
      expected: 'schema match',
      got: rest.join(':').trim(),
      message: `Slide ${index} (${type}): ${first}`,
    });
  }
}

/**
 * Strictly validate raw slides. Throws RawSlideValidationError on the first
 * failure with structured detail. Does not mutate inputs.
 *
 * @param {Array<{type: string, content: object}>} slides
 */
export function validateRefinedSlidesStrict(slides) {
  if (!Array.isArray(slides)) {
    throw new RawSlideValidationError({
      slideIndex: -1,
      slideType: null,
      field: 'slides',
      expected: 'array',
      got: typeof slides,
      message: '"slides" must be an array',
    });
  }
  if (slides.length === 0) {
    throw new RawSlideValidationError({
      slideIndex: -1,
      slideType: null,
      field: 'slides',
      expected: 'array with at least 1 slide',
      got: 0,
      message: '"slides" must contain at least 1 slide',
    });
  }
  for (let i = 0; i < slides.length; i++) {
    validateSlideStrict(slides[i], i);
  }
}

/**
 * Diff input slides vs validated/fixed output slides and produce a list of
 * applied fixes the caller can inspect. Detects truncations, array-length
 * changes (pad/truncate), layout switches, and slide-type conversions.
 *
 * @param {Array} input - Slides as the caller submitted them
 * @param {Array} fixed - Slides after validateAndFixRefinedSlides
 * @returns {Array<{slideIndex: number, field: string, change: string}>}
 */
export function diffAppliedFixes(input, fixed) {
  const fixes = [];
  if (!Array.isArray(input) || !Array.isArray(fixed)) return fixes;

  for (let i = 0; i < fixed.length; i++) {
    const a = input[i];
    const b = fixed[i];
    if (!a || !b) continue;

    if (a.type !== b.type) {
      fixes.push({
        slideIndex: i,
        field: 'type',
        change: `converted from ${a.type} to ${b.type}`,
      });
    }

    const aContent = a.content || {};
    const bContent = b.content || {};

    // Compare known scalar text fields for truncation
    for (const field of Object.keys(STRICT_TEXT_LIMITS)) {
      const av = aContent[field];
      const bv = bContent[field];
      if (typeof av === 'string' && typeof bv === 'string' && av.length !== bv.length) {
        fixes.push({
          slideIndex: i,
          field,
          change: `truncated from ${av.length} to ${bv.length} chars`,
        });
      }
    }

    // Compare array-bearing fields for length changes
    for (const field of ['items', 'metrics', 'rows']) {
      const av = aContent[field];
      const bv = bContent[field];
      if (Array.isArray(av) && Array.isArray(bv) && av.length !== bv.length) {
        const delta = bv.length - av.length;
        fixes.push({
          slideIndex: i,
          field,
          change: delta > 0
            ? `padded from ${av.length} to ${bv.length} entries`
            : `truncated from ${av.length} to ${bv.length} entries`,
        });
      }
    }

    // Layout auto-switch (list-slide 5+ → two-column)
    if (aContent.layout !== bContent.layout && bContent.layout) {
      fixes.push({
        slideIndex: i,
        field: 'layout',
        change: `switched to "${bContent.layout}"`,
      });
    }
  }

  return fixes;
}

/**
 * Pre-check if a slide type is appropriate given the content
 * Used to guide Phase 2 decisions
 *
 * @param {string} type - Proposed slide type
 * @param {Object} content - Proposed content
 * @returns {boolean} True if valid
 */
export function isSlideTypeValid(type, content) {
  const req = SLIDE_ITEM_REQUIREMENTS[type];
  if (!req) return true;

  const arr = content?.[req.field];
  if (!Array.isArray(arr)) return false;

  return arr.length >= req.min;
}

/**
 * Get unknown fields from slide content (fields that won't be rendered)
 * Useful for debugging and prompt improvement
 *
 * @param {string} slideType - The slide type name
 * @param {Object} content - The slide content object
 * @returns {Array<string>} Array of unknown field names
 */
export function getUnknownFields(slideType, content) {
  if (!content || typeof content !== 'object') return [];
  if (!SLIDE_TYPES[slideType]) return [];

  const validKeys = getValidFieldKeys(slideType);
  return Object.keys(content).filter((key) => {
    if (validKeys.has(key)) return false;
    const value = content[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return true;
  });
}

// Slide types that don't count toward "content" slide budget
const NON_CONTENT_SLIDE_TYPES = new Set([
  'title-slide',
  'chapter-title-slide',
  'payoff-slide',
  'follow-invite-slide',
]);

/**
 * Validate slide count against target and log warnings
 *
 * @param {Array} slides - Array of slides (refined or final deck slides)
 * @param {number} targetSlides - Target number of content slides
 * @returns {{ contentSlides: number, totalSlides: number, overBudget: boolean, percentage: number }}
 */
export function validateSlideCount(slides, targetSlides) {
  if (!Array.isArray(slides) || !targetSlides || targetSlides <= 0) {
    return { contentSlides: 0, totalSlides: 0, overBudget: false, percentage: 0 };
  }

  const contentSlides = slides.filter(s => {
    const type = s?.type || '';
    return !NON_CONTENT_SLIDE_TYPES.has(type);
  }).length;

  const totalSlides = slides.length;
  const overBudget = contentSlides > targetSlides * 1.5;
  const percentage = Math.round((contentSlides / targetSlides) * 100);

  if (overBudget) {
    logValidation('warn-over-budget', {
      contentSlides,
      targetSlides,
      percentage,
      threshold: '150%',
      totalSlides,
      message: `Generated ${contentSlides} content slides, target was ${targetSlides} (${percentage}% of target)`,
    });
  } else {
    // Info-level log for monitoring
    console.log(`[ValidateSlide] Slide budget: ${contentSlides}/${targetSlides} content slides (${percentage}%)`);
  }

  return { contentSlides, totalSlides, overBudget, percentage };
}
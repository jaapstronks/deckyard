/**
 * Text truncation.
 *
 * Bounds AI-generated text fields to their max lengths, cutting at a word
 * boundary where possible so slides don't show a half-word.
 */

import { MAX_LENGTHS } from './constants.js';
import { logValidation } from './logging.js';

/**
 * Truncate a string to max length, adding ellipsis if needed
 */
export function truncate(str, maxLen, fieldName = 'unknown') {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  // Cut at a word boundary. A hard slice leaves a visible half-word on the
  // slide ("we apologize for the p"), which a presenter has to fix by hand.
  // Fall back to the hard cut when there is no sensible break point near the
  // limit, so a single very long token still gets bounded.
  const hardCut = str.slice(0, maxLen - 3);
  const lastBreak = hardCut.search(/\s\S*$/);
  const body = lastBreak > maxLen * 0.6 ? hardCut.slice(0, lastBreak) : hardCut;
  const truncated = `${body.replace(/[\s,;:.–—-]+$/, '')}...`;
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
export function truncateContentFields(type, content) {
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

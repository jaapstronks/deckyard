/**
 * Slide Content Structure Validation
 *
 * Validates that slide content has the expected structure for its type.
 * Used by the refinement phase to detect malformed AI output.
 */

/**
 * Validate that slide content has the expected structure for its type.
 * @param {string} type - The slide type
 * @param {object} content - The slide content object
 * @param {number} [originalIndex] - Original slide index for debugging
 * @returns {string[]} Array of validation issue messages (empty if valid)
 */
export function validateSlideContentStructure(type, content, originalIndex) {
  const issues = [];

  switch (type) {
    case 'list-slide':
    case 'lijstje-slide': // Back-compat alias
      if (!Array.isArray(content.items)) {
        issues.push('Missing items array');
      } else if (content.items.length < 2) {
        issues.push(`items array has ${content.items.length} items, need at least 2`);
      } else {
        content.items.forEach((item, i) => {
          if (!item?.title) issues.push(`items[${i}] missing title`);
          if (!item?.text) issues.push(`items[${i}] missing text`);
        });
      }
      break;


    case 'icon-card-grid-slide':
      if (!content.cardCount) {
        issues.push('Missing cardCount');
      } else {
        const count = parseInt(content.cardCount, 10);
        for (let i = 1; i <= count; i++) {
          if (!content[`card${i}Title`]) issues.push(`Missing card${i}Title`);
          if (!content[`card${i}Body`]) issues.push(`Missing card${i}Body`);
        }
      }
      break;

    case 'card-stack-slide':
      if (!content.cardCount) {
        issues.push('Missing cardCount');
      } else {
        const count = parseInt(content.cardCount, 10);
        for (let i = 1; i <= count; i++) {
          if (!content[`card${i}Label`]) issues.push(`Missing card${i}Label`);
          if (!content[`card${i}Body`]) issues.push(`Missing card${i}Body`);
        }
      }
      break;

    case 'text-blocks-slide':
      if (!content.row1Count) {
        issues.push('Missing row1Count');
      } else {
        const row1Count = parseInt(content.row1Count, 10);
        for (let i = 1; i <= row1Count; i++) {
          if (!content[`row1Block${i}Title`]) issues.push(`Missing row1Block${i}Title`);
        }
      }
      if (content.row2Enabled === 'yes' && !content.row2Count) {
        issues.push('row2Enabled but missing row2Count');
      }
      break;

    case 'kpi-metrics-slide':
      if (!Array.isArray(content.metrics)) {
        issues.push('Missing metrics array');
      } else if (content.metrics.length < 1) {
        issues.push('metrics array is empty');
      } else {
        content.metrics.forEach((m, i) => {
          if (!m?.value) issues.push(`metrics[${i}] missing value`);
          if (!m?.label) issues.push(`metrics[${i}] missing label`);
        });
      }
      break;

    case 'quote-slide':
      if (!content.quote) issues.push('Missing quote');
      if (!content.authorName) issues.push('Missing authorName');
      // Check for fields that shouldn't be there
      if (content.image) issues.push('Unexpected image field (quote-slide has no image)');
      if (content.body) issues.push('Unexpected body field (quote-slide has no body)');
      if (content.items) issues.push('Unexpected items field (quote-slide has no items)');
      break;

    case 'team-cards-slide':
      if (Array.isArray(content.members) && content.members.length > 0) {
        // New format: validate members[]
        for (let i = 0; i < content.members.length; i++) {
          if (!content.members[i]?.name) issues.push(`Missing members[${i}].name`);
        }
      } else if (content.cardCount) {
        // Legacy format
        const count = parseInt(content.cardCount, 10);
        for (let i = 1; i <= count; i++) {
          if (!content[`card${i}Name`]) issues.push(`Missing card${i}Name`);
        }
      } else {
        issues.push('Missing members[] or cardCount');
      }
      break;

    case 'comparison-slide':
      if (!content.leftTitle) issues.push('Missing leftTitle');
      if (!content.leftBody) issues.push('Missing leftBody');
      if (!content.rightTitle) issues.push('Missing rightTitle');
      if (!content.rightBody) issues.push('Missing rightBody');
      break;

    case 'matrix-slide':
      if (!Array.isArray(content.cells)) {
        issues.push('Missing cells array');
      } else if (content.cells.length !== 4) {
        issues.push(`cells array has ${content.cells.length} items, need exactly 4`);
      } else {
        content.cells.forEach((cell, i) => {
          if (!cell?.title) issues.push(`cells[${i}] missing title`);
          if (!cell?.body) issues.push(`cells[${i}] missing body`);
        });
      }
      break;

    case 'pyramid-slide':
      if (!Array.isArray(content.levels)) {
        issues.push('Missing levels array');
      } else if (content.levels.length < 3 || content.levels.length > 6) {
        issues.push(`levels array has ${content.levels.length} items, need 3-6`);
      } else {
        content.levels.forEach((level, i) => {
          if (!level?.label) issues.push(`levels[${i}] missing label`);
        });
      }
      break;

    case 'funnel-slide':
      if (!Array.isArray(content.stages)) {
        issues.push('Missing stages array');
      } else if (content.stages.length < 3 || content.stages.length > 6) {
        issues.push(`stages array has ${content.stages.length} items, need 3-6`);
      } else {
        content.stages.forEach((stage, i) => {
          if (!stage?.label) issues.push(`stages[${i}] missing label`);
        });
      }
      break;

    case 'cycle-slide':
      if (!Array.isArray(content.stages)) {
        issues.push('Missing stages array');
      } else if (content.stages.length < 3 || content.stages.length > 6) {
        issues.push(`stages array has ${content.stages.length} items, need 3-6`);
      } else {
        content.stages.forEach((stage, i) => {
          if (!stage?.label) issues.push(`stages[${i}] missing label`);
        });
      }
      break;

    case 'process-slide':
      if (!Array.isArray(content.steps)) {
        issues.push('Missing steps array');
      } else if (content.steps.length < 3 || content.steps.length > 7) {
        issues.push(`steps array has ${content.steps.length} items, need 3-7`);
      } else {
        content.steps.forEach((step, i) => {
          if (!step?.title) issues.push(`steps[${i}] missing title`);
        });
      }
      break;

    case 'timeline-slide':
      if (!Array.isArray(content.items)) {
        issues.push('Missing items array');
      } else if (content.items.length < 2 || content.items.length > 10) {
        issues.push(`items array has ${content.items.length} items, need 2-10`);
      } else {
        content.items.forEach((item, i) => {
          // Accept either 'date' (preferred) or 'time' (back-compat with old agenda-timeline)
          if (!item?.date && !item?.time) issues.push(`items[${i}] missing date`);
          if (!item?.title) issues.push(`items[${i}] missing title`);
        });
      }
      break;

    case 'content-columns-slide':
      if (!content.columnCount) {
        issues.push('Missing columnCount');
      } else {
        const count = parseInt(content.columnCount, 10);
        if (isNaN(count) || count < 1 || count > 7) {
          issues.push(`Invalid columnCount: ${content.columnCount}`);
        }
      }
      break;
  }

  return issues;
}
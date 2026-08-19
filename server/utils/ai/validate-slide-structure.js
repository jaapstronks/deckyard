/**
 * Slide Content Structure Validation
 *
 * Validates that slide content has the expected structure for its type.
 * Used by the refinement phase to detect malformed AI output.
 *
 * Coverage rule (the `structure-validation` companion in
 * tests/helpers/slide-type-companions.js): a type owes a validator here only
 * when its content carries a **repeated-item collection** whose cardinality or
 * per-item required fields cannot be expressed as independent scalar fields —
 * i.e. its declared `structure` is `collection` or `fixed-collection`, and it is
 * not agent-opt-out. `singleton`, `dataset`, `tabular` and `chrome` types are
 * validated field-by-field by the derived agent schema and the refined-slide Zod
 * schemas (`schemas/refined-slide.js`); adding a structural case for them would
 * only restate what those layers already check. Both directions are gated by
 * tests/slide-type-companion-coverage.test.js, and the map — rather than a
 * switch — is what lets the reverse direction see which types are covered.
 */

/**
 * Per-type structural validators. Each takes the slide content and returns an
 * array of issue messages (empty when the structure is sound). Keyed by type
 * name so `STRUCTURE_VALIDATED_TYPES` is derivable and cannot drift from the
 * dispatch.
 *
 * @type {Record<string, (content: object) => string[]>}
 */
export const STRUCTURE_VALIDATORS = {
  'list-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.items)) {
      issues.push('Missing items array');
    } else if (content.items.length < 2) {
      issues.push(
        `items array has ${content.items.length} items, need at least 2`,
      );
    } else {
      content.items.forEach((item, i) => {
        if (!item?.title) issues.push(`items[${i}] missing title`);
        if (!item?.text) issues.push(`items[${i}] missing text`);
      });
    }
    return issues;
  },

  'icon-card-grid-slide': (content) => {
    const issues = [];
    if (!content.cardCount) {
      issues.push('Missing cardCount');
    } else {
      const count = parseInt(content.cardCount, 10);
      for (let i = 1; i <= count; i++) {
        if (!content[`card${i}Title`]) issues.push(`Missing card${i}Title`);
        if (!content[`card${i}Body`]) issues.push(`Missing card${i}Body`);
      }
    }
    return issues;
  },

  'text-blocks-slide': (content) => {
    const issues = [];
    // Array-canonical rows[] is the source of truth (and the only shape that
    // carries a 4th row — the numbered mirror below is frozen at 3). Validate
    // it directly when present, mirroring icon-card-grid's items[] branch.
    if (Array.isArray(content.rows) && content.rows.length > 0) {
      content.rows.forEach((row, i) => {
        if (!Array.isArray(row?.blocks) || row.blocks.length < 1) {
          issues.push(`rows[${i}] has no blocks`);
        }
      });
    } else if (!content.row1Count) {
      issues.push('Missing row1Count');
    } else {
      const row1Count = parseInt(content.row1Count, 10);
      for (let i = 1; i <= row1Count; i++) {
        if (!content[`row1Block${i}Title`])
          issues.push(`Missing row1Block${i}Title`);
      }
      if (content.row2Enabled === 'yes' && !content.row2Count) {
        issues.push('row2Enabled but missing row2Count');
      }
    }
    return issues;
  },

  'kpi-metrics-slide': (content) => {
    const issues = [];
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
    return issues;
  },

  'team-cards-slide': (content) => {
    const issues = [];
    if (Array.isArray(content.members) && content.members.length > 0) {
      // New format: validate members[]
      for (let i = 0; i < content.members.length; i++) {
        if (!content.members[i]?.name)
          issues.push(`Missing members[${i}].name`);
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
    return issues;
  },

  'logo-wall-slide': (content) => {
    const issues = [];
    // Canonical logos[] or the legacy numbered logo{N} fields; a logo needs at
    // least a name or an image to render as anything.
    if (Array.isArray(content.logos) && content.logos.length > 0) {
      content.logos.forEach((logo, i) => {
        if (!logo?.name && !logo?.image)
          issues.push(`logos[${i}] missing name or image`);
      });
    } else if (content.logoCount) {
      const count = parseInt(content.logoCount, 10);
      for (let i = 1; i <= count; i++) {
        if (!content[`logo${i}Name`] && !content[`logo${i}Image`]) {
          issues.push(`Missing logo${i}Name or logo${i}Image`);
        }
      }
    } else {
      issues.push('Missing logos[] or logoCount');
    }
    return issues;
  },

  'gallery-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.images)) {
      issues.push('Missing images array');
    } else if (content.images.length < 2 || content.images.length > 6) {
      issues.push(`images array has ${content.images.length} items, need 2-6`);
    } else {
      content.images.forEach((img, i) => {
        if (!img?.src) issues.push(`images[${i}] missing src`);
      });
    }
    return issues;
  },

  'matrix-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.cells)) {
      issues.push('Missing cells array');
    } else if (content.cells.length !== 4) {
      issues.push(
        `cells array has ${content.cells.length} items, need exactly 4`,
      );
    } else {
      content.cells.forEach((cell, i) => {
        if (!cell?.title) issues.push(`cells[${i}] missing title`);
        if (!cell?.body) issues.push(`cells[${i}] missing body`);
      });
    }
    return issues;
  },

  'pyramid-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.levels)) {
      issues.push('Missing levels array');
    } else if (content.levels.length < 3 || content.levels.length > 6) {
      issues.push(`levels array has ${content.levels.length} items, need 3-6`);
    } else {
      content.levels.forEach((level, i) => {
        if (!level?.label) issues.push(`levels[${i}] missing label`);
      });
    }
    return issues;
  },

  'funnel-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.stages)) {
      issues.push('Missing stages array');
    } else if (content.stages.length < 3 || content.stages.length > 6) {
      issues.push(`stages array has ${content.stages.length} items, need 3-6`);
    } else {
      content.stages.forEach((stage, i) => {
        if (!stage?.label) issues.push(`stages[${i}] missing label`);
      });
    }
    return issues;
  },

  'cycle-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.stages)) {
      issues.push('Missing stages array');
    } else if (content.stages.length < 3 || content.stages.length > 6) {
      issues.push(`stages array has ${content.stages.length} items, need 3-6`);
    } else {
      content.stages.forEach((stage, i) => {
        if (!stage?.label) issues.push(`stages[${i}] missing label`);
      });
    }
    return issues;
  },

  'process-slide': (content) => {
    const issues = [];
    if (!Array.isArray(content.steps)) {
      issues.push('Missing steps array');
    } else if (content.steps.length < 3 || content.steps.length > 7) {
      issues.push(`steps array has ${content.steps.length} items, need 3-7`);
    } else {
      content.steps.forEach((step, i) => {
        if (!step?.title) issues.push(`steps[${i}] missing title`);
      });
    }
    return issues;
  },

  'timeline-slide': (content) => {
    const issues = [];
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
    return issues;
  },

  'poll-slide': (content) => {
    const issues = [];
    if (!content.question) issues.push('Missing question');
    const options = Array.isArray(content.options)
      ? content.options.filter(Boolean)
      : [
          content.option1,
          content.option2,
          content.option3,
          content.option4,
        ].filter(Boolean);
    if (options.length < 2) {
      issues.push(`poll has ${options.length} options, need at least 2`);
    }
    return issues;
  },

  'likert-slide': (content) => {
    const issues = [];
    if (!content.question) issues.push('Missing question');
    const options = Array.isArray(content.options)
      ? content.options.filter(Boolean)
      : Array.from({ length: 10 }, (_v, i) => content[`option${i + 1}`]).filter(
          Boolean,
        );
    if (options.length < 2) {
      issues.push(`likert has ${options.length} options, need at least 2`);
    }
    return issues;
  },
};

/**
 * Validate that slide content has the expected structure for its type.
 * @param {string} type - The slide type
 * @param {object} content - The slide content object
 * @param {number} [originalIndex] - Original slide index for debugging
 * @returns {string[]} Array of validation issue messages (empty if valid)
 */
export function validateSlideContentStructure(type, content, originalIndex) {
  const validator = STRUCTURE_VALIDATORS[type];
  if (!validator) return [];
  return validator(content || {});
}

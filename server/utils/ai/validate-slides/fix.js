/**
 * Fix pipeline.
 *
 * Non-throwing validation that repairs AI-generated slides in place: truncates
 * overlong text, applies per-type fixes, enforces item min/max (padding,
 * truncating, or downgrading to content-slide), attaches non-blocking content
 * warnings, and diffs input vs output into a list of applied fixes.
 */

import { validateSlideContent } from '../schemas/index.js';
import { SLIDE_ITEM_REQUIREMENTS, STRICT_TEXT_LIMITS } from './constants.js';
import { logValidation } from './logging.js';
import { checkForUnknownFields } from './fields.js';
import { truncateContentFields } from './truncate.js';
import {
  fixTableSlideContent,
  fixLijstjeSlideLayout,
  fixTextBlocksSlideDefaults,
  getIconCardGridOptimization,
  buildBodyFromItems,
  buildBodyFromTimelineItems,
} from './fixers.js';

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

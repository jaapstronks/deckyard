/**
 * AI Slide Type Prompt Builders
 *
 * Functions for building AI prompts from slide type definitions.
 */

import { SLIDE_TYPE_CATALOG } from './definitions.js';
import { getSlideTypeExamples } from './examples.js';
import { buildGlobalOptionsPromptSection } from './global-options.js';

/**
 * Get slide types that should be fully resolved in Phase 1 (outline phase)
 * @returns {string[]} Array of slide type names
 */
export function getPhase1SlideTypes() {
  return Object.entries(SLIDE_TYPE_CATALOG)
    .filter(([, def]) => def.resolveInPhase1)
    .map(([type]) => type);
}

/**
 * Get slide types for Phase 2 (content refinement phase)
 * @param {Array} [disabledSlideTypes] - Org-level disabled types to exclude
 * @returns {string[]} Array of slide type names
 */
export function getPhase2SlideTypes(disabledSlideTypes = []) {
  const disabled = new Set(Array.isArray(disabledSlideTypes) ? disabledSlideTypes : []);
  return Object.entries(SLIDE_TYPE_CATALOG)
    .filter(([type, def]) => !def.resolveInPhase1 && !disabled.has(type))
    .map(([type]) => type);
}

/**
 * Build a prompt section describing a specific slide type
 * @param {string} type - Slide type name
 * @returns {string} Formatted description for AI prompt
 */
export function buildSlideTypeDescription(type) {
  const def = SLIDE_TYPE_CATALOG[type];
  if (!def) return '';

  const lines = [];
  lines.push(`--- ${type} ---`);
  lines.push(def.description.trim());
  lines.push('');

  if (def.bestFor?.length) {
    lines.push('BEST FOR:');
    def.bestFor.forEach((item) => lines.push(`  - ${item}`));
    lines.push('');
  }

  // Add explicit JSON examples - show ALL variations for complex types
  const examples = getSlideTypeExamples(type);
  if (examples && examples.length > 0) {
    if (examples.length === 1) {
      lines.push('EXACT CONTENT SCHEMA:');
      lines.push('```json');
      lines.push(JSON.stringify(examples[0], null, 2));
      lines.push('```');
    } else {
      lines.push(`CONTENT SCHEMA VARIATIONS (${examples.length} patterns):`);
      examples.forEach((ex, idx) => {
        const variationName = ex._variation || `Variation ${idx + 1}`;
        // Remove the _variation field from the actual example
        const cleanExample = { ...ex };
        delete cleanExample._variation;
        lines.push('');
        lines.push(`--- ${variationName} ---`);
        lines.push('```json');
        lines.push(JSON.stringify(cleanExample, null, 2));
        lines.push('```');
      });
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build the full catalog prompt for Phase 2 slide refinement
 * @param {Object} [options]
 * @param {Array} [options.disabledSlideTypes] - Org-level disabled types to exclude
 * @returns {string} Complete AI prompt with all slide type descriptions
 */
export function buildPhase2CatalogPrompt({ disabledSlideTypes = [], customSlideTypes = [] } = {}) {
  const phase2Types = getPhase2SlideTypes(disabledSlideTypes);
  const sections = phase2Types.map((type) => buildSlideTypeDescription(type));

  // Build custom type descriptions
  const disabled = new Set(Array.isArray(disabledSlideTypes) ? disabledSlideTypes : []);
  const customSections = [];
  if (Array.isArray(customSlideTypes) && customSlideTypes.length > 0) {
    for (const ct of customSlideTypes) {
      const typeKey = `custom-${ct.slug}`;
      if (disabled.has(typeKey)) continue;
      const label = ct.label || ct.slug || 'Custom type';
      const lines = [];
      lines.push(`--- ${typeKey} ---`);
      lines.push(`Custom slide type: "${label}".`);
      if (ct.baseType) lines.push(`Based on: ${ct.baseType}.`);
      lines.push('');
      const fields = Array.isArray(ct.fields) ? ct.fields : [];
      if (fields.length) {
        lines.push('CONTENT SCHEMA:');
        lines.push('```json');
        const example = ct.defaults && typeof ct.defaults === 'object' ? ct.defaults : {};
        lines.push(JSON.stringify(example, null, 2));
        lines.push('```');
      }
      lines.push('');
      customSections.push(lines.join('\n'));
    }
  }

  return `SLIDE TYPE CATALOG
==================

CRITICAL: Use the EXACT content schema shown for each slide type.
Do NOT mix schemas between types (e.g., quote-slide has NO image field).

${buildGlobalOptionsPromptSection()}

===============================================================================
STRUCTURAL SLIDES (for opening/chapter/quote/closing intents)
===============================================================================

--- title-slide ---
For intent:"opening" ONLY. The first slide of the deck.
EXACT CONTENT SCHEMA:
\`\`\`json
{
  "title": "Presentation Title",
  "subheading": "Speaker Name or Date",
  "background": "lime"
}
\`\`\`

--- chapter-title-slide ---
For intent:"chapter" ONLY. Section dividers.
EXACT CONTENT SCHEMA:
\`\`\`json
{
  "title": "Chapter Title",
  "subheading": "Optional subheading"
}
\`\`\`

--- quote-slide ---
For intent:"quote" ONLY. A single powerful quote.
EXACT CONTENT SCHEMA (NO image field, NO bullets):
\`\`\`json
{
  "quote": "The actual quote text, 1-3 sentences max.",
  "authorName": "Person Name",
  "authorTitle": "Their Role or Title"
}
\`\`\`

--- payoff-slide ---
For intent:"closing" ONLY. Final slide.
EXACT CONTENT SCHEMA:
\`\`\`json
{
  "tagline": "Optional closing message"
}
\`\`\`

===============================================================================
CONTENT SLIDES (for intent:"content")
===============================================================================

IMPORTANT: Choose the slide type whose structure the content genuinely has.
A specialized slide type is better than content-slide WHEN IT TRULY FITS — but
when the content is a plain enumeration, or you are unsure, prefer the plainest
type that conveys it: list-slide for title+text items, content-slide for
bullets. Do NOT reach for a structured type (text-blocks, matrix, funnel,
pyramid, cycle, process) unless the content genuinely has that relationship. In
particular, text-blocks-slide asserts causality/sequence via its arrows, so use
it only when the rows really relate (cause→effect, input→output); for plain or
parallel points, use list-slide or content-slide.

${sections.join('\n')}${customSections.length ? `

===============================================================================
CUSTOM SLIDE TYPES (organization-specific)
===============================================================================

${customSections.join('\n')}` : ''}`;
}
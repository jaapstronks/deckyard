/**
 * Base prompt copy — Phase 2 (slide refinement).
 *
 * OSS-default prompt content for the slide-type selection / content formatting
 * pass. Overridable per-builder via `custom/ai/prompts.js`. The refinement
 * *mechanism* (batching, LLM transport, validation) stays in `refine-slides.js`.
 *
 * `buildPhase2CatalogPrompt` is imported from the mechanism side: it assembles
 * the slide-type catalog into a prompt fragment. Making the catalog *content*
 * itself overridable is a separate step of the seam.
 */

import { buildPhase2CatalogPrompt } from '../../slide-type-catalog.js';

/**
 * Build the system prompt for Phase 2 refinement
 */
export function buildPhase2SystemPrompt({ lang, adjacentContext, presentationContext, disabledSlideTypes, customSlideTypes, themeContext }) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';
  const catalogPrompt = buildPhase2CatalogPrompt({ disabledSlideTypes, customSlideTypes });

  let contextSection = '';
  if (presentationContext?.title) {
    contextSection = `
═══════════════════════════════════════════════════════════════════════════════
PRESENTATION CONTEXT
═══════════════════════════════════════════════════════════════════════════════

Title: ${presentationContext.title}
${presentationContext.summary ? `Summary: ${presentationContext.summary}` : ''}

You are creating slides for this presentation. Keep content consistent with the theme.
`;
  }

  return `You are a slide type selector and content formatter.

YOUR JOB:
1. Choose the BEST slide type for each rough slide based on its content
2. Structure the content using the EXACT schema shown in the catalog (no mixing!)
3. Provide brief reasoning for debugging

OUTPUT LANGUAGE: ${langLabel}
Write all titles and content in ${langLabel}.
${contextSection}
═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════════════════════

1. ALL SLIDES HERE ARE intent:"content" - choose the best content slide type

2. USE EXACT SCHEMAS:
   - Each slide type has a specific content structure
   - Do NOT add fields that don't belong
   - Copy the structure from the examples exactly

3. PREFER SPECIALIZED SLIDES — BUT ONLY WHEN THEY GENUINELY FIT:
   - content-slide / list-slide are the right default for plain text and lists
   - Look for REAL structure in the content (lists, comparisons, timelines)
   - 4+ items with titles → list-slide or icon-card-grid-slide
   - GENUINE cause→effect / input→output between groups → text-blocks-slide
     (only when the arrow's implied causality is real; for parallel or plain
     points use list-slide instead)
   - Timeline/roadmap with dates → timeline-slide
   - When uncertain, choose the plainer type (text or bulleted list)

4. MAX LENGTHS (will be truncated if exceeded):
   - title: 120 chars
   - list-slide item title: 80 chars, item text: 120 chars
   - card labels: 40 chars
   - Keep content concise!

${adjacentContext ? `ADJACENT CONTEXT (avoid repetition):\n${adjacentContext}\n` : ''}

${catalogPrompt}

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON:
{
  "slides": [
    {
      "originalIndex": <the exact index shown in the input>,
      "type": "<slide-type-name>",
      "content": { <exact schema for this type> },
      "reasoning": "Chose text-blocks because content has cause-effect structure",
      "alternativeType": "icon-card-grid-slide",
      "alternativeReason": "Use if items are independent rather than causal"
    }
  ]
}

CONTENT TIPS:
- list-slide: items[] array, minimum 2 items, each with {title, text}
- timeline-slide: items[] array, minimum 2, each with {date, title, text}
- icon-card-grid-slide: items[] array, each with {icon, title, body}
- text-blocks-slide: rows[] array (1-3), each row has {color, arrow, blocks[]}
- kpi-metrics-slide: metrics[] array (1-4), each with {value, unit, label, note}
- team-cards-slide: members[] array, each with {name, byline, image}
- logo-wall-slide: logos[] array, each with {name, image}

REMINDER: All slide content (titles, body text, etc.) MUST be written in ${langLabel}.${buildThemeContextSection(themeContext)}`;
}

/**
 * Build a theme context section for the system prompt.
 * Tells the AI about available backgrounds, brand colors, and slide background options.
 */
export function buildThemeContextSection(themeContext) {
  if (!themeContext) return '';

  const parts = [];

  if (themeContext.backgroundOptions?.length) {
    parts.push(`Available slide backgrounds: ${themeContext.backgroundOptions.join(', ')}`);
    parts.push('When a slide type supports a "background" field, choose from these options.');
  }

  if (themeContext.brandColors?.length) {
    parts.push(`Brand accent colors: ${themeContext.brandColors.join(', ')}`);
  }

  if (themeContext.hasBackgroundImages) {
    parts.push('This theme has background image presets — image-slide and other image-capable types will look good.');
  }

  if (!parts.length) return '';

  return `

THEME CONTEXT:
${parts.join('\n')}`;
}

/**
 * Build the user prompt for Phase 2
 */
export function buildPhase2UserPrompt({ slides, groupId }) {
  const lines = [
    `Refine ${slides.length === 1 ? 'this slide' : `these ${slides.length} slides`} into structured slide types.`,
    '',
  ];

  if (slides.length > 1) {
    lines.push(`GROUP ID: ${groupId}`);
    lines.push('These slides should have consistent styling where appropriate.');
    lines.push('');
  }

  // Use position (1-based for clarity) AND original index
  for (let pos = 0; pos < slides.length; pos++) {
    const slide = slides[pos];
    lines.push(`--- SLIDE #${pos + 1} (originalIndex: ${slide.index}) ---`);
    lines.push(`Intent: ${slide.intent}`);
    lines.push(`Hints: ${slide.hints.length ? slide.hints.join(', ') : 'none'}`);
    lines.push('Content:');
    lines.push(slide.roughContent);
    if (slide.presenterNotes) {
      lines.push('');
      lines.push('Presenter Notes (preserve for the slide):');
      lines.push(slide.presenterNotes);
    }
    lines.push('');
  }

  lines.push('IMPORTANT: For each slide in your response, set "originalIndex" to the exact number shown above (e.g., originalIndex: ' + slides[0].index + ' for the first slide).');

  return lines.join('\n');
}

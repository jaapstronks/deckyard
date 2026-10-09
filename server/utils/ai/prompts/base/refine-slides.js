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

import { SLIDE_TYPES } from '../../../../../shared/slide-types/registry.js';
import { allowedEnumValues } from '../../../../../shared/slide-types/field-types.js';
import { buildPhase2CatalogPrompt } from '../../slide-type-catalog.js';

/**
 * Build the system prompt for Phase 2 refinement
 */
export function buildPhase2SystemPrompt({
  lang,
  adjacentContext,
  presentationContext,
  disabledSlideTypes,
  customSlideTypes,
  themeContext,
}) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';
  const catalogPrompt = buildPhase2CatalogPrompt({
    disabledSlideTypes,
    customSlideTypes,
  });

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
3. Write presenter notes from the source context
4. Explain your type choice to the presenter in one sentence

OUTPUT LANGUAGE: ${langLabel}
Write all titles and content in ${langLabel}.
${contextSection}
═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════════════════════

1. Follow each input slide intent; structural intents keep their structural type.

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

4. MAX LENGTHS:
   - Follow the declared field limits below, including nested items.
   - Overlong text is rejected and must be rewritten, never truncated.
   - Write complete sentences; shorten the wording without losing its meaning.
${buildLengthContract(disabledSlideTypes, customSlideTypes)}

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
      "presenterNotes": "2-4 sentences for the presenter",
      "reasoning": "The source describes how rising costs led to the new policy, so the arrow layout shows that cause and effect",
      "alternativeType": "icon-card-grid-slide",
      "alternativeReason": "Use if items are independent rather than causal"
    }
  ]
}

PRESENTER NOTES AND REASONING:
- Each slide comes with the part of the source it draws on. The slide shows the WHAT; the notes give the WHY and HOW: background the slide leaves out, an example or figure to mention, a transition. Use only what the source context says.
- "reasoning" is shown to the presenter in ${langLabel}: name what in the source made this type fit (sequence, comparison, figures, ...). No jargon about schemas or fields.

CONTENT TIPS:
- list-slide: items[] array, minimum 2 items, each with {title, text}
- timeline-slide: items[] array, minimum 2, each with {date, title, text}
- icon-card-grid-slide: items[] array, each with {icon, title, body}
- text-blocks-slide: rows[] array (1-3), each row has {color, arrow, blocks[]}
- kpi-metrics-slide: metrics[] array (1-4), each with {value, unit, label, note}
- team-cards-slide: members[] array, each with {name, byline, body, image}; body is an optional short bio in markdown
- logo-wall-slide: logos[] array, each with {name, image}

REMINDER: All slide content (titles, body text, etc.) MUST be written in ${langLabel}.${buildThemeContextSection(themeContext, disabledSlideTypes, customSlideTypes)}`;
}

/**
 * Build a theme context section for the system prompt.
 * Tells the AI which backgrounds each slide type offers, the brand colors, and
 * whether the theme has background images.
 *
 * The background offer is per type: the union the editor's picker shows
 * (`allowedEnumValues`, D88), never one fixed list for every type (B244).
 *
 * Internal helper of `buildPhase2SystemPrompt` — intentionally NOT part of the
 * fork override set (not re-exported from `base/index.js`). It's called as a
 * module-local sibling above, so a registry override would never fire; forks
 * override `buildPhase2SystemPrompt` to change this section.
 */
export function buildThemeContextSection(
  themeContext,
  disabledSlideTypes = [],
  customSlideTypes = [],
) {
  if (!themeContext) return '';

  const parts = [];

  const offers = buildBackgroundOffers(
    themeContext,
    disabledSlideTypes,
    customSlideTypes,
  );
  if (offers) {
    parts.push(
      'Slide backgrounds: set "background" only to a value its slide type offers:',
    );
    parts.push(offers);
  }

  if (themeContext.brandColors?.length) {
    parts.push(`Brand accent colors: ${themeContext.brandColors.join(', ')}`);
  }

  if (themeContext.hasBackgroundImages) {
    parts.push(
      'This theme has background image presets — image-slide and other image-capable types will look good.',
    );
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
    lines.push(
      'These slides should have consistent styling where appropriate.',
    );
    lines.push('');
  }

  // Use position (1-based for clarity) AND original index
  for (let pos = 0; pos < slides.length; pos++) {
    const slide = slides[pos];
    lines.push(`--- SLIDE #${pos + 1} (originalIndex: ${slide.index}) ---`);
    lines.push(`Intent: ${slide.intent}`);
    lines.push(
      `Hints: ${slide.hints.length ? slide.hints.join(', ') : 'none'}`,
    );
    lines.push('Content:');
    lines.push(slide.roughContent);
    const source = slide.sourceContext;
    if (source) {
      lines.push('');
      lines.push(`Source context (section "${source.heading}"):`);
      for (const point of source.keyPoints || []) lines.push(`- ${point}`);
      if (source.excerpt) lines.push(`Excerpt: "${source.excerpt}"`);
    }
    if (slide.presenterNotes) {
      lines.push('');
      lines.push('Presenter Notes (preserve for the slide):');
      lines.push(slide.presenterNotes);
    }
    lines.push('');
  }

  lines.push(
    'IMPORTANT: For each slide in your response, set "originalIndex" to the exact number shown above (e.g., originalIndex: ' +
      slides[0].index +
      ' for the first slide).',
  );

  return lines.join('\n');
}

/** Publish the actual field caps instead of a second handwritten length table. */
function buildLengthContract(disabled = [], custom = []) {
  const lines = [];
  function walk(fields, prefix, caps) {
    for (const field of fields || []) {
      const path = `${prefix}${field.key}`;
      if (Number.isFinite(field.maxLength))
        caps.push(`${path}: ${field.maxLength}`);
      if (field.itemFields) walk(field.itemFields, `${path}[].`, caps);
    }
  }
  for (const [type, def] of offeredTypeDefs(disabled, custom)) {
    const caps = [];
    walk(def.fields, '', caps);
    if (caps.length) lines.push(`   - ${type}: ${caps.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * The backgrounds each type offers under the theme, one line per distinct
 * offer: `- lime, mist: content-slide, list-slide`. Grouping keeps the prompt
 * short; 29 types share a handful of offers.
 */
function buildBackgroundOffers(themeContext, disabled = [], custom = []) {
  const theme = { slideBackgrounds: themeContext.slideBackgrounds || [] };
  const byOffer = new Map();
  for (const [type, def] of offeredTypeDefs(disabled, custom)) {
    const field = (def.fields || []).find(
      (f) => f.key === 'background' && f.type === 'enum',
    );
    if (!field) continue;
    const values = allowedEnumValues(field, theme);
    if (!values.length) continue;
    const key = values.join(', ');
    if (!byOffer.has(key)) byOffer.set(key, []);
    byOffer.get(key).push(type);
  }
  return [...byOffer]
    .map(([offer, types]) => `- ${offer}: ${types.join(', ')}`)
    .join('\n');
}

/** Core and custom type definitions the org has not disabled, as `[name, def]`. */
function offeredTypeDefs(disabled = [], custom = []) {
  return [
    ...Object.entries(SLIDE_TYPES),
    ...custom.map((ct) => [`custom-${ct.slug}`, ct]),
  ].filter(([type]) => !disabled.includes(type));
}

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { extractJsonObject } from './json.js';
import { cryptoUuid } from '../../../shared/slide-types/helpers.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from '../../../shared/slide-types/registry.js';

const SUPPORTED_CONVERSIONS = {
  'content-slide': ['list-slide', 'icon-card-grid-slide', 'text-blocks-slide', 'kpi-metrics-slide'],
  'list-slide': ['icon-card-grid-slide', 'content-slide', 'text-blocks-slide'],
  'icon-card-grid-slide': ['list-slide', 'content-slide', 'text-blocks-slide'],
  'text-blocks-slide': ['icon-card-grid-slide', 'list-slide'],
  'kpi-metrics-slide': ['content-slide', 'list-slide'],
};

function getConversionPrompt(fromType, toType, lang) {
  const isNl = lang === 'nl';
  const langRule = isNl ? 'Output in Dutch' : 'Output in English';

  // ─── Target format descriptions (reusable) ───

  const LIST_FORMAT = `The list slide has these fields:
- title (string, max 120 chars): The slide title
- subheading (string, optional, max 160 chars): Optional subheading
- variant (string): Either "bullets" or "numbers"
- items (array of 2-8 objects): Each item has:
  - title (string, max 80 chars): The item headline
  - text (string, max 120 chars, single line): Brief explanation
- background (string): Either "lime" or "mist"`;

  const ICON_CARDS_FORMAT = `The icon cards slide has these fields:
- title (string, max 120 chars): The slide title
- subheading (string, optional, max 200 chars): Optional subheading
- items (array of 1-6 objects): Each item has:
  - icon (string): Lucide icon name
  - title (string, max 80 chars): Card title
  - body (markdown, max 700 chars): Card content

Common Lucide icon names:
lightbulb, target, users, settings, trending-up, shield-check, heart, star, rocket,
chart-line, handshake, globe, book-open, flag, circle-check, search, calendar, mail,
brain, cpu, arrow-right, sparkles, leaf, graduation-cap, message-circle`;

  const TEXT_BLOCKS_FORMAT = `The text blocks slide has these fields:
- title (string, max 120 chars): The slide title
- subheading (string, optional, max 200 chars): Optional subheading
- rows (array of 1-3 row objects): Each row has:
  - title (string, optional): Row heading (usually empty for first row)
  - color (string): "yellow" (accent) or "black" (dark)
  - arrow (string): "none", "down", or "up" — shows flow to NEXT row
  - blocks (array of 1-6 block objects): Each block has:
    - title (string, max 80 chars): Block title
    - body (markdown, max 500 chars): Block content

Tips: Alternate colors between rows. Use arrows for cause-effect relationships.`;

  const CONTENT_FORMAT = `The content slide has these fields:
- title (string, max 120 chars): The slide title
- body (markdown): Rich text content
- background (string): Either "lime" or "mist"`;

  const KPI_FORMAT = `The KPI metrics slide has these fields:
- title (string, max 120 chars): The slide title
- background (string): "lime" or "mist"
- metrics (array of 1-4 objects): Each metric has:
  - value (string, max 30 chars): The number itself
  - unit (string, optional, max 12 chars): Suffix like %, M, K
  - label (string, max 60 chars): What the number represents
  - note (string, optional, max 100 chars): Context — starts with +N/-N for auto green/red coloring`;

  // ─── Conversion: content-slide → * ───

  if (fromType === 'content-slide' && toType === 'list-slide') {
    return {
      system: `You are a presentation content converter. Convert a content slide to a structured list slide.
${LIST_FORMAT}

Rules:
- Extract key points from the body content and structure them as items
- Each item should have a clear title and brief single-line explanation
- Keep the original slide title if appropriate, or create a better one
- Choose "numbers" variant if the content implies sequence/steps, otherwise use "bullets"
- Preserve the background color if specified
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => `Convert this content slide to a list slide:

Title: ${slide.content?.title || ''}
Body:
${slide.content?.body || ''}
Background: ${slide.content?.background || 'lime'}

Return JSON with: { title, subheading, variant, items: [{title, text}, ...], background }`,
    };
  }

  if (fromType === 'content-slide' && toType === 'icon-card-grid-slide') {
    return {
      system: `You are a presentation content converter. Convert a content slide to an icon cards slide.
${ICON_CARDS_FORMAT}

Rules:
- Group the body content into 2-6 logical sections/themes
- Choose appropriate icons that represent each section's theme
- Each card should have a clear title and body content
- Keep the original slide title if appropriate
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => `Convert this content slide to an icon cards slide:

Title: ${slide.content?.title || ''}
Body:
${slide.content?.body || ''}

Return JSON with: { title, subheading, items: [{ icon, title, body }, ...] }`,
    };
  }

  if (fromType === 'content-slide' && toType === 'text-blocks-slide') {
    return {
      system: `You are a presentation content converter. Convert a content slide to a text blocks slide.
${TEXT_BLOCKS_FORMAT}

Rules:
- Analyze the content for logical groupings or cause-effect relationships
- If there's a clear "input → output" or "problem → solution" pattern, use 2 rows with arrow: "down"
- Otherwise, use 1 row with 3-6 blocks for parallel concepts
- Keep the original slide title if appropriate
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => `Convert this content slide to a text blocks slide:

Title: ${slide.content?.title || ''}
Body:
${slide.content?.body || ''}

Return JSON with: { title, subheading, rows: [{ title, color, arrow, blocks: [{ title, body }, ...] }] }`,
    };
  }

  if (fromType === 'content-slide' && toType === 'kpi-metrics-slide') {
    return {
      system: `You are a presentation content converter. Convert a content slide to a KPI metrics slide.
${KPI_FORMAT}

Rules:
- Extract numeric values from the content (statistics, targets, percentages, counts)
- Each metric needs a clear value, label, and optional unit
- If there are change indicators (up/down, increase/decrease), include them in the note field with +/- prefix
- 1-4 metrics maximum — pick the most impactful numbers
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => `Convert this content slide to a KPI metrics slide. Extract the most important numbers:

Title: ${slide.content?.title || ''}
Body:
${slide.content?.body || ''}

Return JSON with: { title, background: "mist", metrics: [{ value, unit, label, note }, ...] }`,
    };
  }

  // ─── Conversion: list-slide → * ───

  if (fromType === 'list-slide' && toType === 'icon-card-grid-slide') {
    return {
      system: `You are a presentation content converter. Convert a list slide to an icon cards slide.
${ICON_CARDS_FORMAT}

Rules:
- Each list item becomes a card (up to 6)
- Choose an appropriate icon for each item based on its content
- The item title becomes the card title, the item text becomes the card body
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `- ${it.title}: ${it.text}`).join('\n');
        return `Convert this list slide to an icon cards slide:

Title: ${slide.content?.title || ''}
Items:
${items}

Return JSON with: { title, subheading, items: [{ icon, title, body }, ...] }`;
      },
    };
  }

  if (fromType === 'list-slide' && toType === 'content-slide') {
    return {
      system: `You are a presentation content converter. Convert a list slide to a content slide.
${CONTENT_FORMAT}

Rules:
- Combine the list items into flowing markdown body text
- Use bullet points, headers, or paragraphs as appropriate
- Keep the original title
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `- ${it.title}: ${it.text}`).join('\n');
        return `Convert this list slide to a content slide:

Title: ${slide.content?.title || ''}
Items:
${items}

Return JSON with: { title, body, background: "${slide.content?.background || 'lime'}" }`;
      },
    };
  }

  if (fromType === 'list-slide' && toType === 'text-blocks-slide') {
    return {
      system: `You are a presentation content converter. Convert a list slide to a text blocks slide.
${TEXT_BLOCKS_FORMAT}

Rules:
- Each list item becomes a block in a single row (up to 6)
- If there are more than 6 items, group related items into 2 rows
- The item title becomes the block title, the item text becomes the block body
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `- ${it.title}: ${it.text}`).join('\n');
        return `Convert this list slide to a text blocks slide:

Title: ${slide.content?.title || ''}
Items:
${items}

Return JSON with: { title, subheading, rows: [{ title, color, arrow, blocks: [{ title, body }, ...] }] }`;
      },
    };
  }

  // ─── Conversion: icon-card-grid-slide → * ───

  if (fromType === 'icon-card-grid-slide' && toType === 'list-slide') {
    return {
      system: `You are a presentation content converter. Convert an icon cards slide to a list slide.
${LIST_FORMAT}

Rules:
- Each card becomes a list item
- The card title becomes the item title, the card body becomes a brief single-line text
- Choose "bullets" variant unless the content implies a sequence
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `- [${it.icon}] ${it.title}: ${it.body}`).join('\n');
        const legacy = !slide.content?.items;
        let cardText = items;
        if (legacy) {
          const count = Number(slide.content?.cardCount || 4);
          const cards = [];
          for (let i = 1; i <= count; i++) {
            cards.push(`- ${slide.content?.[`card${i}Title`] || ''}: ${slide.content?.[`card${i}Body`] || ''}`);
          }
          cardText = cards.join('\n');
        }
        return `Convert this icon cards slide to a list slide:

Title: ${slide.content?.title || ''}
Cards:
${cardText}

Return JSON with: { title, subheading, variant, items: [{title, text}, ...], background: "lime" }`;
      },
    };
  }

  if (fromType === 'icon-card-grid-slide' && toType === 'content-slide') {
    return {
      system: `You are a presentation content converter. Convert an icon cards slide to a content slide.
${CONTENT_FORMAT}

Rules:
- Combine all card content into flowing markdown body text
- Use headers (##) for each card title, with the body text below
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `## ${it.title}\n${it.body}`).join('\n\n');
        return `Convert this icon cards slide to a content slide:

Title: ${slide.content?.title || ''}
Cards:
${items}

Return JSON with: { title, body, background: "lime" }`;
      },
    };
  }

  if (fromType === 'icon-card-grid-slide' && toType === 'text-blocks-slide') {
    return {
      system: `You are a presentation content converter. Convert an icon cards slide to a text blocks slide.
${TEXT_BLOCKS_FORMAT}

Rules:
- Each card becomes a block (up to 6 per row)
- If there are 4-6 cards, use a single row
- Card titles become block titles, card bodies become block bodies
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const items = (slide.content?.items || []).map((it) => `- ${it.title}: ${it.body}`).join('\n');
        return `Convert this icon cards slide to a text blocks slide:

Title: ${slide.content?.title || ''}
Cards:
${items}

Return JSON with: { title, subheading, rows: [{ title, color, arrow, blocks: [{ title, body }, ...] }] }`;
      },
    };
  }

  // ─── Conversion: text-blocks-slide → * ───

  if (fromType === 'text-blocks-slide' && toType === 'icon-card-grid-slide') {
    return {
      system: `You are a presentation content converter. Convert a text blocks slide to an icon cards slide.
${ICON_CARDS_FORMAT}

Rules:
- Flatten all blocks from all rows into cards (up to 6)
- Choose appropriate icons for each block based on its content
- Block titles become card titles, block bodies become card bodies
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const rows = slide.content?.rows || [];
        let blockText = '';
        if (rows.length > 0) {
          rows.forEach((r, i) => {
            if (r.title) blockText += `\nRow "${r.title}":\n`;
            (r.blocks || []).forEach((b) => { blockText += `- ${b.title}: ${b.body}\n`; });
          });
        } else {
          // Legacy format
          for (let rn = 1; rn <= 3; rn++) {
            if (rn > 1 && slide.content?.[`row${rn}Enabled`] !== 'yes') continue;
            const count = Number(slide.content?.[`row${rn}Count`] || 3);
            for (let i = 1; i <= count; i++) {
              blockText += `- ${slide.content?.[`row${rn}Block${i}Title`] || ''}: ${slide.content?.[`row${rn}Block${i}Body`] || ''}\n`;
            }
          }
        }
        return `Convert this text blocks slide to an icon cards slide:

Title: ${slide.content?.title || ''}
Blocks:
${blockText}

Return JSON with: { title, subheading, items: [{ icon, title, body }, ...] }`;
      },
    };
  }

  if (fromType === 'text-blocks-slide' && toType === 'list-slide') {
    return {
      system: `You are a presentation content converter. Convert a text blocks slide to a list slide.
${LIST_FORMAT}

Rules:
- Flatten all blocks from all rows into list items
- Block titles become item titles, block bodies become brief text
- Choose "bullets" unless content implies sequence
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const rows = slide.content?.rows || [];
        let blockText = '';
        if (rows.length > 0) {
          rows.forEach((r) => {
            (r.blocks || []).forEach((b) => { blockText += `- ${b.title}: ${b.body}\n`; });
          });
        }
        return `Convert this text blocks slide to a list slide:

Title: ${slide.content?.title || ''}
Blocks:
${blockText}

Return JSON with: { title, subheading, variant, items: [{title, text}, ...], background: "lime" }`;
      },
    };
  }

  // ─── Conversion: kpi-metrics-slide → * ───

  if (fromType === 'kpi-metrics-slide' && toType === 'content-slide') {
    return {
      system: `You are a presentation content converter. Convert a KPI metrics slide to a content slide.
${CONTENT_FORMAT}

Rules:
- Present the metrics as readable text (e.g. "We reached 1.2M in reach, up 12% vs last year")
- Make it feel like a narrative, not a data dump
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const metrics = (slide.content?.metrics || []).map((m) => {
          return `${m.value}${m.unit || ''} ${m.label}${m.note ? ` (${m.note})` : ''}`;
        }).join('\n');
        return `Convert this KPI metrics slide to a content slide:

Title: ${slide.content?.title || ''}
Metrics:
${metrics}

Return JSON with: { title, body, background: "mist" }`;
      },
    };
  }

  if (fromType === 'kpi-metrics-slide' && toType === 'list-slide') {
    return {
      system: `You are a presentation content converter. Convert a KPI metrics slide to a list slide.
${LIST_FORMAT}

Rules:
- Each metric becomes a list item
- Item title: the metric value + unit (e.g. "1.2M Reach")
- Item text: the note/context
- Use "bullets" variant
- ${langRule}
- Return ONLY valid JSON, no markdown or explanation`,
      user: (slide) => {
        const metrics = (slide.content?.metrics || []).map((m) => {
          return `- ${m.value}${m.unit || ''} ${m.label}: ${m.note || ''}`;
        }).join('\n');
        return `Convert this KPI metrics slide to a list slide:

Title: ${slide.content?.title || ''}
Metrics:
${metrics}

Return JSON with: { title, subheading, variant: "bullets", items: [{title, text}, ...], background: "mist" }`;
      },
    };
  }

  return null;
}

export async function convertSlideWithAi(slide, toType, { vendor = null, lang = 'nl' } = {}) {
  const fromType = slide?.type;
  if (!fromType) {
    const err = new Error('Slide must have a type');
    err.statusCode = 400;
    throw err;
  }

  const allowed = SUPPORTED_CONVERSIONS[fromType] || [];
  if (!allowed.includes(toType)) {
    const err = new Error(`AI conversion from "${fromType}" to "${toType}" is not supported`);
    err.statusCode = 400;
    throw err;
  }

  const prompt = getConversionPrompt(fromType, toType, lang);
  if (!prompt) {
    const err = new Error(`No conversion prompt available for ${fromType} -> ${toType}`);
    err.statusCode = 400;
    throw err;
  }

  const llmConfig = getLlmConfig({ vendor });
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user(slide) },
  ];

  const raw = await requestChatCompletionContent({
    vendor: llmConfig.vendor,
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    maxTokens: 4096,
    messages,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed) {
    const err = new Error('Failed to parse AI response as JSON');
    err.statusCode = 500;
    throw err;
  }

  // Build the converted slide
  const converted = {
    id: slide.id || cryptoUuid(),
    type: toType,
    content: parsed,
    notes: slide.notes || '',
  };

  // Preserve global per-slide fields (accessibility, background image, logo,
  // text colour) that aren't tied to a specific slide type.
  for (const key of GLOBAL_SLIDE_FIELD_KEYS) {
    const val = slide.content?.[key];
    if (val !== undefined && val !== null && val !== '') {
      converted.content[key] = val;
    }
  }

  return converted;
}

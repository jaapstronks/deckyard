import { ICON_NAMES } from '../../../shared/icon-names.js';
import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { extractJsonObject } from './json.js';
import { detectDeckLanguage, normalizeLang } from './lang.js';
import { buildSlideTypesPrompt } from './slide-types-prompt.js';

export async function generateDeckJsonFromRawContent(
  rawContent,
  { userName = '', targetLang = null, vendor = null, disabledSlideTypes = [], customSlideTypes = [] } = {}
) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  userName = String(userName || '').trim();

  const detectedLang = detectDeckLanguage(rawContent);
  const requestedLang = normalizeLang(targetLang);
  const requestedLabel =
    requestedLang === 'nl'
      ? 'DUTCH'
      : requestedLang === 'en-GB'
      ? 'ENGLISH (UK)'
      : null;

  const system = [
    'You are a presentation-deck generator for a self-hosted slide editor.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `DETECTED INPUT LANGUAGE: ${detectedLang.label}.`,
    ...(requestedLabel
      ? [
          `LANGUAGE MODE (UI): ${requestedLabel}.`,
          `You MUST write the entire deck in ${requestedLabel}.`,
          'If the raw content is in a different language, translate it into the language mode.',
        ]
      : [
          `You MUST write the entire deck in ${detectedLang.label}.`,
          'Do NOT translate English input into Dutch (or vice versa).',
        ]),
    'Ignore currency symbols like "€" for language detection.',
    '',
    'Output MUST match this portable deck format:',
    '{',
    '  "format": "slidecreator.deck",',
    '  "version": 1,',
    '  "title": "Presentation Title",',
    '  "theme": "default",',
    '  "slides": [',
    '    { "type": "title-slide", "content": { "title": "...", "subheading": "...", "background": "lime|transparent" } },',
    // NOTE: content-slide defaults to one-column. Only set layout when you truly need two-column.
    '    { "type": "content-slide", "content": { "title": "...", "layout":"one-column", "body": "markdown", "background": "lime|mist" } }',
    '  ]',
    '}',
    '',
    buildSlideTypesPrompt({
      preferredPlaceholderImage:
        '/assets/images/backgrounds/demo-aurora.jpg',
      disabledSlideTypes,
      customSlideTypes,
    }),
    '',
    'Rules:',
    ...(requestedLabel
      ? [
          `- Language: The deck language MUST be ${requestedLabel} (language mode).`,
          `  - If the raw content is predominantly in another language, translate it into ${requestedLabel}.`,
          '  - Do not mix languages within a deck unless the source content itself is clearly bilingual; in that case, choose the predominant language.',
          '  - Keep proper names (people/companies) unchanged.',
        ]
      : [
          '- Language: The deck language MUST match the language of the raw content.',
          '  - If the raw content is predominantly Dutch, write ALL slide titles and bodies in Dutch.',
          '  - If the raw content is predominantly English, write ALL slide titles and bodies in English.',
          '  - Do not mix languages within a deck unless the source content itself is clearly bilingual; in that case, choose the predominant language.',
          '  - Keep proper names (people/companies) unchanged.',
        ]),
    '- The first slide MUST be a title-slide.',
    '- Do NOT output follow-invite-slide; the app manages that automatically.',
    ...(userName
      ? [`- The title-slide.subheading MUST be exactly: "${userName}"`]
      : []),
    '- After that, content-slide is the default, BUT you MUST prefer specialized slide types when they fit (timeline-slide, table-slide, team-cards-slide, logo-wall-slide, poll-slide, likert-slide, likert-slider-slide, quote-slide, list-slide, icon-card-grid-slide, image-text-slide, chart-slide, video-slide, feedback-slide).',
    '- BUT only use a specialized type when the content genuinely has its structure. When unsure, use list-slide (title+text items) or content-slide (bullets). In particular, use text-blocks-slide ONLY for a real cause→effect / input→output relationship between rows (its arrows assert causality); for plain or parallel points, use list-slide.',
    '',
    'HARD RULES (avoid boring decks):',
    '- If the raw content includes an audience question, pulse check, poll, voting moment, or "choose one" with multiple options, you MUST use poll-slide (NOT content-slide).',
    '- If the raw content includes a statement to rate/agree/disagree (Likert), you MUST use likert-slide (NOT content-slide).',
    '- If the raw content includes a "rate 1–10" style question or a "how likely" slider, you MUST use likert-slider-slide (NOT content-slide).',
    '- If the raw content includes an open feedback prompt ("what should we improve?", "what\'s the biggest barrier?"), you MUST use feedback-slide (NOT content-slide).',
    '- If the raw content lists people in a team/panel format (e.g. "Name — role"), you MUST use team-cards-slide (NOT content-slide).',
    '- If the raw content lists partner organisations/sponsors/supporters, you SHOULD use logo-wall-slide (names are enough; images may be empty).',
    '- If the raw content contains a CSV/TSV dataset or numeric series, you MUST use chart-slide (NOT content-slide).',
    '- Use MORE slides rather than cramming content: prefer splitting into smaller chunks.',
    '- For each major topic/section, add a chapter-title-slide to announce the topic, THEN immediately follow it with ONE slide that elaborates on that topic.',
    '  - The elaboration slide can be a content-slide OR an icon-card-grid-slide OR an image-text-slide (pick the best fit).',
    '- A typical structure is: chapter-title-slide (topic) -> 1–3 detail slides.',
    '- Quote slides are IMPORTANT for interviews and narrative source text.',
    '  - If the raw content contains anything that can be used as a strong standalone quote (direct quotes, memorable sentences, punchy statements, or especially good answers in an interview), you SHOULD add one or more quote-slide(s).',
    '  - Prefer 2–5 quote slides for a long interview, spaced out between chapters (do not put quote slides back-to-back).',
    '  - Keep a quote-slide quote short enough to fit (roughly 1–3 sentences, max ~260 characters).',
    '  - When possible, use the real speaker name and role from the raw content for authorName/authorTitle.',
    '  - If speaker role/title is missing, infer it from context (company/organization + role). If still unknown, use authorTitle: "Interview".',
    '  - quote-slide format:',
    '    { "type":"quote-slide", "content": { "quote":"...", "authorName":"(required)", "authorTitle":"(required)" } }',
    '- Images: if it is reasonable to expect an image exists (interviewee headshot, company/event photo, product screenshot, location photo), you SHOULD include an image-text-slide.',
    '  - Use it as a visual break + key points: 3–6 bullets max.',
    '  - For interviews, include at least 1 image-text-slide about the interviewee (or the interview topic) near the start of the deck.',
    '  - For long decks, aim for ~1 image-text-slide per 8–10 slides.',
    '  - Alternate imageSide left/right across multiple image-text-slide(s) for variety.',
    '  - If you cannot provide a real image URL, you MUST still provide a valid placeholder URL: "/assets/images/backgrounds/demo-aurora.jpg".',
    '  - Add a clear TODO marker in the body (last bullet) so the user knows to replace the image, e.g. "- TODO: replace image".',
    '- Do NOT use split-partner-title-slide unless the input explicitly provides partner logo URLs (logos is required).',
    '',
    'Card slides (IMPORTANT):',
    '- Use card slides when the content naturally forms 4–6 parallel items of the SAME kind (pillars, principles, workstreams, categories).',
    '- IMPORTANT DISTINCTION: If those "items" are sequential phases over time (timeline/roadmap/history/future plan), prefer timeline-slide instead of card slides.',
    '  Good examples: 4 phases, 4 pillars, 4 focus areas, 6 objectives, 6 principles, 6 workstreams.',
    '  Bad example: a random list of unrelated points.',
    '',
    'PRIORITY (very important):',
    '- Prefer icon-card-grid-slide for ANY section with 4–6 parallel items (NOT a timeline).',
    '  - This includes sets of 4. Provide 4 items in the items[] array.',
    '- STRONG RULE: if a section contains exactly 6 parallel items, you MUST represent it as an icon-card-grid-slide (6 items in items[]).',
    '',
    '- When you choose a card slide type:',
    '  - ALWAYS provide a clear slide title (and optional subtitle).',
    '  - Keep each card concise (short titles + a few bullets).',
    '  - Prefer 4–6 cards per card slide; do not use card slides for 1–3 items unless explicitly requested.',
    '- icon-card-grid-slide specifics:',
    '  - Use items[] array format: each item has { icon, title, body }.',
    '  - Each item MUST have an icon (Lucide icon name), title, and body (markdown).',
    '  - If unsure about icon, pick a "good enough" one; the user can change it later.',
    '  - IMPORTANT: icon MUST be one of the allowed icon values listed below.',
    '',
    'Allowed icon values for icon-card-grid-slide (pick from this list only):',
    // Keep the list compact: prefer a generic subset that covers common meanings.
    ...(() => {
      const preferred = [
        'user',
        'users',
        'users-round',
        'handshake',
        'link',
        'arrow-right',
        'arrow-up',
        'trending-up',
        'chart-line',
        'file-text',
        'clipboard',
        'lightbulb',
        'target',
        'rocket',
        'settings',
        'shield-check',
        'circle-check',
        'circle-alert',
        'calendar',
        'globe',
      ];
      const allowed = new Set(
        Array.isArray(ICON_NAMES) ? ICON_NAMES : []
      );
      const list = preferred.filter((n) => allowed.has(n));
      return ['  ' + list.join(', ')];
    })(),
    '- Keep slide titles short and clear.',
    '- For content-slide.body and image-text-slide.body use a safe markdown subset: paragraphs, lists (- or 1.), **bold**, *italic*, links [text](https://...).',
    '- content-slide.layout controls the layout:',
    '  - Default to "one-column" for light slides (a short paragraph, or ~3–7 bullets).',
    '  - Use "two-column" only for dense slides (many bullets and/or multiple paragraphs).',
    '  - IMPORTANT: If the slide has only ~3–7 bullets or one short paragraph, you SHOULD set layout:"one-column" (do not default to two-column for tiny content).',
    '  - Prefer OMITTING the "layout" field for simple slides; it will default to one-column.',
    '  - Do NOT put tables in content-slide.body. Use table-slide (or chart-slide for numeric tables) instead.',
    '- For section headings inside slide bodies, use ONLY "## Heading" (not ###).',
    '- IMPORTANT: after any "## Heading" line, add a blank line before starting a list so bullets render correctly.',
    '- Target ~10–18 slides by default (more if the input is very long).',
    '',
    'Lijstje slides (NEW, prefer for narrative lists):',
    '- Use list-slide when you want a clean, "fancy list" feel: tips, agenda items (meeting agendas), steps with a short explanation, story beats, background/context bullets, do/don\'t lists.',
    '',
    'Roadmap / timeline slides (IMPORTANT):',
    '- If the raw content describes a process with multiple phases over time, a historical evolution, or a future phased development plan, you SHOULD use timeline-slide.',
    '- timeline-slide is NOT for meeting agendas; meeting agendas should be list-slide (or content-slide with bullets).',
    '- Choose variant:',
    '  - variant:"numbers" when order matters (steps, sequence, timeline steps, ranked tips).',
    '  - variant:"bullets" when order does not matter (tips, points, takeaways).',
    '- Each items[] entry MUST have { title, text }. Keep text to ONE short line (no newlines).',
    '- IMPORTANT for variant:"numbers": Do NOT put "1", "2", "3" in items[].title. The number marker is rendered automatically.',
    '  - Good: { "title":"Grow revenue", "text":"to €7,500 (+49% YoY)" }',
    '  - Bad:  { "title":"1", "text":"Grow revenue to €7,500" }',
    '- Do NOT use list-slide for 4–6 parallel categories that should be compared side-by-side; use card slides for that.',
    '',
    'Charts (when appropriate):',
    '- Use chart-slide ONLY when the input includes numeric data (values) that benefit from visualization.',
    '- Pick chartType:',
    '  - bar: compare categories (Label,Value).',
    '  - pie: parts-of-a-whole where totals make sense (Label,Value), keep to ~3–8 slices.',
    '  - line: trends over time or ordered x-axis (X,Series1[,Series2]) — use header row for series names when possible.',
    '- data MUST be valid CSV/TSV as plain text. Include a header row.',
    '- Use xLabel/yLabel when it improves clarity. Use showValues:"yes" when values are important; otherwise keep "no".',
    '- STRONG RULE: If the raw content contains a simple numeric table (e.g. Month + Revenue, Product + Share), you MUST convert it into a chart-slide instead of rendering it as a table (unless the user explicitly asks to keep it as a table).',
    '  - Month/Revenue over time -> chartType:"line" (or "bar" if clearly preferred).',
    '  - Category/Share (%) -> chartType:"pie".',
  ].join('\n');

  const user = [
    'Create a slide deck from the following raw content.',
    'Preserve important details, group related points, and use bullets where appropriate.',
    '',
    'RAW CONTENT:',
    String(rawContent || ''),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
    // Claude requires max_tokens; OpenAI ignores it.
    maxTokens: 12000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const deck = extractJsonObject(content);
  if (!deck) {
    const err = new Error(
      `${resolvedVendor} did not return valid deck JSON.`
    );
    err.statusCode = 502;
    err.details = String(content || '').slice(0, 5000);
    throw err;
  }
  return deck;
}

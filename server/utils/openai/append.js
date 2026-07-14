import { ICON_NAMES } from '../../../shared/icon-names.js';
import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { extractJsonObject } from './json.js';
import { detectDeckLanguage, normalizeLang } from './lang.js';
import { summarizeDeckForPrompt } from './prompt.js';
import { buildSlideTypesPrompt } from './slide-types-prompt.js';

export async function generateSlidesToAppendFromRawContent(
  rawContent,
  {
    existingDeck = null,
    preferredPlaceholderImage = '/assets/images/backgrounds/backgroundpic-1.jpg',
    targetLang = null,
    vendor = null,
    contentOnly = false,
    verbatim = false,
    disabledSlideTypes = [],
    customSlideTypes = [],
    // Revision mode (batch review "Adjust"): the previously generated batch
    // plus the user's feedback on it. The model returns a revised full batch.
    priorSlides = null,
    feedback = '',
  } = {}
) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const detectedLang = detectDeckLanguage(rawContent);
  const requestedLang = normalizeLang(targetLang);
  const requestedLabel =
    requestedLang === 'nl'
      ? 'DUTCH'
      : requestedLang === 'en-GB'
      ? 'ENGLISH (UK)'
      : null;
  const deckSummary = existingDeck
    ? summarizeDeckForPrompt(existingDeck, { maxSlides: 60 })
    : 'Title: (unknown)\nTheme: (unknown)\n\nSlides (in order):\n(none provided)';

  const system = [
    'You are a presentation-slide generator for a self-hosted slide editor.',
    'You will be given an EXISTING presentation deck summary, and a user request for NEW slides to add.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `DETECTED REQUEST LANGUAGE: ${detectedLang.label}.`,
    ...(requestedLabel
      ? [
          `LANGUAGE MODE (UI): ${requestedLabel}.`,
          `You MUST write all generated slide titles and bodies in ${requestedLabel}.`,
          'If the user request is in a different language, translate it into the language mode.',
        ]
      : [
          `You MUST write all generated slide titles and bodies in ${detectedLang.label}.`,
        ]),
    'Keep consistent wording/style with the existing deck when possible.',
    ...(verbatim
      ? [
          '',
          '=== VERBATIM MODE (HIGHEST PRIORITY) ===',
          'The user has already written finished copy. Reproduce their words on the',
          'slides EXACTLY as given. Do NOT rewrite, rephrase, paraphrase, summarize,',
          'expand, shorten, translate, or "improve" the wording, tone, or punctuation.',
          '- The ONLY text edits allowed are fixing obvious typos/spelling/casing slips.',
          '- The input may MIX instructions/context/explanation WITH the copy to use.',
          '  Follow the instructions to decide slide type, structure, and how to split',
          '  the copy across slides/fields, but the words placed on the slides must be',
          '  the user\'s own copy, quoted verbatim. Do NOT treat the instructions as copy.',
          '- Do NOT invent, add, or embellish content that is not in the user\'s text.',
          '  If a field would require inventing text, leave it empty instead.',
          '- Preserve the user\'s ordering and line/bullet breaks where they map to',
          '  titles, bullets, or fields.',
          'This VERBATIM rule overrides any style/rewriting guidance below when they',
          'conflict. Slide-type choice and field-splitting rules still apply.',
          '=== END VERBATIM MODE ===',
        ]
      : []),
    '',
    'IMPORTANT: You are NOT creating a new deck. You are appending slides to an existing presentation.',
    '- Do NOT return "title", "theme", "format", or "version".',
    '- Output MUST be exactly: { "rationale": "...", "slides": [ { "type": "...", "content": { ... }, "why": "...", "alternatives": [ { "type": "...", "reason": "..." } ] }, ... ] }',
    '- "rationale": 1-3 sentences addressed to the user, summarizing what you added and the structure you chose (e.g. "Based on your prompt I added 4 slides: a chapter title, then..."). Written in the same language as the slides.',
    '- "why" (per slide): ONE short sentence explaining why this slide type fits this content. Same language as the slides.',
    '- "alternatives" (per slide): 0-2 other slide types that could also work, each with a one-line "reason". Use an empty array when nothing else genuinely fits. Only use type names from the catalog below.',
    '- Do NOT include UUIDs or ids.',
    '- Do NOT repeat existing slides; build logically on what already exists.',
    '- Do NOT add a new title-slide unless the user explicitly asks for it.',
    '- Do NOT output follow-invite-slide; the app manages that automatically.',
    '',
    buildSlideTypesPrompt({ preferredPlaceholderImage, disabledSlideTypes, customSlideTypes }),
    '',
    'Rules:',
    '- Prefer specialized slide types when they fit (timeline-slide, table-slide, team-cards-slide, logo-wall-slide, poll-slide, likert-slide, likert-slider-slide, quote-slide, list-slide, icon-card-grid-slide, image-text-slide, chart-slide, video-slide, feedback-slide).',
    '- But only use a specialized type when the content genuinely has its structure; when unsure, use list-slide or content-slide. Use text-blocks-slide ONLY for a real cause→effect / input→output relationship between rows (its arrows assert causality); for plain or parallel points, use list-slide.',
    '',
    'HARD RULES (avoid falling back to content-slide):',
    '- Audience questions with multiple options -> poll-slide (NOT content-slide).',
    '- Agree/disagree or scale statements -> likert-slide (NOT content-slide).',
    '- 1–10 rating questions -> likert-slider-slide (NOT content-slide).',
    '- Open-ended "type your feedback" prompts -> feedback-slide (NOT content-slide).',
    '- Lists of people (Name — role) -> team-cards-slide (NOT content-slide).',
    '- Lists of partner organisations -> logo-wall-slide when it reads like a "partner landscape".',
    '- Numeric datasets (CSV/TSV) -> chart-slide (NOT table-slide, NOT content-slide).',
    '- Use MORE slides rather than cramming content: prefer splitting into smaller chunks.',
    ...(contentOnly
      ? [
          '- CONTENT ONLY MODE: Do NOT add chapter-title-slide or payoff-slide. Generate only content slides.',
          '- The user wants to add slides within an existing section, not create new sections.',
          '- Focus on the content; the presentation structure is already established.',
        ]
      : [
          '- For each NEW major topic/section you introduce, add a chapter-title-slide to announce the topic, THEN immediately follow it with ONE slide that elaborates on that topic.',
        ]),
    '- Quote slides are IMPORTANT for interviews and narrative source text.',
    '- Images: If the user asks for a photo/image (or you choose to add an image slide), you MUST use a placeholder image URL from the app so the slide validates.',
    `  - Use this placeholder URL: "${preferredPlaceholderImage}".`,
    '  - Also add a clear TODO marker in the body (last bullet) so the user knows to replace the image, e.g. "- TODO: replace image".',
    '- For content-slide.body and image-text-slide.body use a safe markdown subset: paragraphs, lists (- or 1.), **bold**, *italic*, links [text](https://...).',
    '- content-slide.layout selection:',
    '  - Use layout:"one-column" for light slides (short paragraph, or ~3–7 bullets). Do NOT default to two-column for tiny content.',
    '  - Use layout:"two-column" for dense slides (many bullets / multiple paragraphs).',
    '  - Prefer OMITTING the "layout" field for simple slides; it will default to one-column.',
    '  - Do NOT put tables in content-slide.body. Use table-slide (or chart-slide for numeric tables) instead.',
    '- For section headings inside slide bodies, use ONLY "## Heading" (not ###).',
    '- IMPORTANT: after any "## Heading" line, add a blank line before starting a list so bullets render correctly.',
    '',
    'Lijstje slides (prefer for narrative lists):',
    '- Use list-slide for tips, story beats, context/background points, agenda items, do/don\'t lists, small sequences.',
    '- Use variant:"numbers" when order matters; otherwise variant:"bullets".',
    '- Each items[] entry MUST have { title, text } and text MUST be ONE short line (no newlines).',
    '- IMPORTANT for variant:"numbers": Do NOT put "1", "2", "3" in items[].title. The number marker is rendered automatically.',
    '  - Good: { "title":"Grow revenue", "text":"to €7,500 (+49% YoY)" }',
    '  - Bad:  { "title":"1", "text":"Grow revenue to €7,500" }',
    '',
    'Roadmap / timeline slides (IMPORTANT):',
    '- If the user describes a timeline, phased roadmap, evolution/history, or future development plan with multiple phases, you SHOULD use timeline-slide.',
    '- timeline-slide is NOT for meeting agendas; meeting agendas should be list-slide (or content-slide bullets).',
    '',
    'Charts (when appropriate):',
    '- Use chart-slide ONLY when the request includes numeric data that benefits from visualization.',
    '- bar: compare categories. pie: parts-of-a-whole (3–8 slices). line: trends over time / ordered x.',
    '- data MUST be valid CSV/TSV as plain text with a header row.',
    '- STRONG RULE: If the request includes a simple numeric table, you MUST convert it into a chart-slide instead of rendering a table (unless the user explicitly asks to keep it as a table).',
    '',
    'Card slides (IMPORTANT):',
    '- Use card slides when the content naturally forms 4–6 items of the SAME kind (phases, goals, challenges, pillars, principles, workstreams).',
    'PRIORITY (very important):',
    '- Prefer icon-card-grid-slide for ANY section with 4–6 parallel items.',
    '- STRONG RULE: if a section contains exactly 6 parallel items, you MUST represent it as an icon-card-grid-slide (cardCount:"6").',
    '- Each icon-card-grid-slide card MUST use an allowed icon value (pick from the list below).',
    '',
    'Allowed icon values for icon-card-grid-slide (pick from this list only):',
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
  ].join('\n');

  const isRevision =
    Array.isArray(priorSlides) && priorSlides.length > 0 && String(feedback || '').trim();

  const user = [
    'EXISTING PRESENTATION SUMMARY:',
    deckSummary,
    '',
    'USER REQUEST (new slides to add):',
    String(rawContent || ''),
    ...(isRevision
      ? [
          '',
          '=== REVISION MODE ===',
          'You previously generated the batch below for this request. The user reviewed it and wants changes.',
          'PRIOR BATCH (JSON):',
          JSON.stringify(
            priorSlides.map((s) => ({ type: s?.type, content: s?.content || {} })),
            null,
            2
          ),
          '',
          'USER FEEDBACK ON THE BATCH:',
          String(feedback || '').trim(),
          '',
          'Return the FULL revised batch in the same output format (not a diff).',
          'Keep slides the feedback does not touch as they are; change only what the feedback asks for (content, slide types, count, order).',
          '=== END REVISION MODE ===',
        ]
      : []),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    // Verbatim mode wants faithful reproduction, not creative variation.
    temperature: verbatim ? 0 : 0.2,
    responseFormat: { type: 'json_object' },
    maxTokens: 12000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  const slides = obj?.slides;
  if (!Array.isArray(slides)) {
    const err = new Error(
      `${resolvedVendor} did not return a valid { slides: [...] } JSON object.`
    );
    err.statusCode = 502;
    err.details = String(content || '').slice(0, 5000);
    throw err;
  }
  const rationale = typeof obj?.rationale === 'string' ? obj.rationale.trim() : '';
  // Per-slide review metadata ("why this type" + alternative types), aligned
  // with `slides` by index. Kept separate because deck normalization strips
  // unknown slide keys; the route re-attaches these after normalization.
  const review = slides.map((s) => ({
    why: typeof s?.why === 'string' ? s.why.trim() : '',
    alternatives: Array.isArray(s?.alternatives)
      ? s.alternatives
          .map((a) => ({
            type: typeof a?.type === 'string' ? a.type.trim() : '',
            reason: typeof a?.reason === 'string' ? a.reason.trim() : '',
          }))
          .filter((a) => a.type)
          .slice(0, 2)
      : [],
  }));
  return { slides, rationale, review };
}

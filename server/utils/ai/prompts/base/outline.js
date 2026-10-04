/**
 * Base prompt copy — Phase 1 (outline), in two calls.
 *
 * The outline used to be one call that read the whole source and returned
 * structure, slide budget, groupings, presenter notes, chapters and loading-
 * screen status lines at once. It is now two calls with one job each:
 *
 * 1. **Analysis** reads the source and says what it contains: title, summary,
 *    sections with their key points, a verbatim excerpt and any quotes. No
 *    slides yet.
 * 2. **Structure** turns that analysis into a slide plan within the budget:
 *    intent, rough content, hints and grouping per slide. It never sees the raw
 *    source, so the analysis must carry the specifics.
 *
 * Presenter notes are written in Phase 2, which sees each slide's section of
 * the analysis. Status lines are derived from the analysis in code.
 *
 * This is the OSS-default prompt content. A downstream fork can override any
 * builder by exporting a same-named function from `custom/ai/prompts.js` (see
 * `server/utils/ai/prompts/custom-loader.js`). The generation *mechanism* (LLM
 * transport, JSON parsing, validation) stays in `generate-outline.js`.
 */

/** The output-language label both calls write in. */
function outputLanguageLabel({ detectedLang, requestedLang }) {
  if (requestedLang === 'nl') return 'DUTCH';
  if (requestedLang === 'en-GB') return 'ENGLISH';
  return detectedLang.label;
}

/**
 * Build the system prompt for the analysis call.
 */
export function buildAnalysisSystemPrompt({ detectedLang, requestedLang }) {
  const langLabel = outputLanguageLabel({ detectedLang, requestedLang });

  return `You analyse a source document that will become a presentation. Your only job is to say what the source contains and what matters in it. You do not design slides.

OUTPUT LANGUAGE: ${langLabel} (except "excerpt" and quote "text", which stay verbatim in the source's language)

Return ONLY valid JSON:
{
  "title": "Presentation title",
  "subtitle": "Event, date or speaker name, or empty",
  "summary": "2-3 sentences: the source's main message",
  "sections": [
    {
      "heading": "Short name for this part of the source",
      "importance": "high|medium|low",
      "keyPoints": ["A specific point, with the numbers, names and dates the source gives"],
      "excerpt": "One short verbatim sentence from the source that carries this section",
      "quotes": [{ "text": "Verbatim quote", "author": "Name", "role": "Role or empty" }]
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
TITLE AND SUBTITLE - SHORT
═══════════════════════════════════════════════════════════════════════════════

- Title: the core topic in at most 6-8 words, like a conference badge. No explanatory phrases.
- Subtitle: at most 8-10 words of context only (event, date, speaker). May be empty. No pipes.
- An event name or date in the source's own title is context: put it in the subtitle and find the real topic for the title.

═══════════════════════════════════════════════════════════════════════════════
SECTIONS
═══════════════════════════════════════════════════════════════════════════════

- Follow the source's own logic: one section per distinct topic, in the order that tells the story best (usually the source's order).
- "importance": how much of a presentation this section deserves. Be honest; most sources have only a few high sections.
- "keyPoints": 2-8 per section. Each point stands on its own and keeps the specifics (figures, names, dates, steps in order). A later step builds slides from these points alone, without the source, so a missing figure is lost for good.
- Keep sequences recognisable: phases, steps and dated events stay in order and say so ("Phase 1: ...", "2026: ...").
- "excerpt": copy one sentence from the source exactly, character for character. Never paraphrase it. Max 200 characters.
- "quotes": only real quotes from the source with a named speaker. Omit the field when there are none.
- Leave out boilerplate: tables of contents, disclaimers, legal notices, navigation text.`;
}

/**
 * Build the user prompt for the analysis call.
 */
export function buildAnalysisUserPrompt({
  rawContent,
  userName,
  rawFirstSlideTitle,
}) {
  const lines = ['Analyse this source.', ''];

  if (rawFirstSlideTitle) {
    lines.push(`ORIGINAL TITLE FROM SOURCE FILE: "${rawFirstSlideTitle}"`);
    lines.push(
      'This may be an event name, date or contextual title rather than the topic.',
    );
    lines.push('');
  }

  if (userName) {
    lines.push(`PRESENTER NAME (use as subtitle): ${userName}`);
    lines.push('');
  }

  lines.push('SOURCE:');
  lines.push(String(rawContent || ''));

  return lines.join('\n');
}

/**
 * Build the system prompt for the structure call.
 */
export function buildStructureSystemPrompt({
  detectedLang,
  requestedLang,
  targetSlides,
}) {
  const langLabel = outputLanguageLabel({ detectedLang, requestedLang });

  return `You plan the slides of a presentation from an analysis of its source. You decide which slides exist, in which order, and what each one says. You do not choose visual slide types; a later step does that from your hints.

CRITICAL: A good presentation is the 20% of the source that conveys 80% of the value. Each slide earns its place. Give high-importance sections more room, and merge or drop low-importance ones.

OUTPUT LANGUAGE: ${langLabel}

Return ONLY valid JSON:
{
  "slides": [
    {
      "intent": "chapter|content|quote|closing",
      "section": 0,
      "roughContent": "What appears on the slide",
      "hints": ["has-4-items"],
      "groupId": "group-1"
    }
  ]
}

"section" is the index (0-based) of the analysis section the slide draws on.

═══════════════════════════════════════════════════════════════════════════════
SLIDE INTENTS
═══════════════════════════════════════════════════════════════════════════════

The presentation already has a title slide. Never add one; start with a chapter or content slide.

"chapter" - Section divider. roughContent: "Chapter title\\nOptional subtitle"
"content" - Regular slide. roughContent: 3-6 focused lines with the key specifics (figures, names, dates). One clear message per slide.
"quote"   - roughContent: "The quote text.\\nAuthor name\\nAuthor role". Only quotes the analysis lists; 1-3 sentences, max 260 characters.
"closing" - Optional final payoff. roughContent: one tagline or call to action.

═══════════════════════════════════════════════════════════════════════════════
HINTS (content slides only) - the shape of the content, not a slide type
═══════════════════════════════════════════════════════════════════════════════

- "has-N-items" (e.g. "has-4-items") - parallel points
- "is-timeline" - sequential phases with dates
- "is-list-with-explanations" - items with title + description
- "has-numeric-data" - statistics, KPIs
- "has-cause-effect" - one group genuinely LEADS TO the other (plain parallel points are "has-N-items")
- "has-comparison" - pros/cons, A vs B, before/after
- "has-matrix" - 2x2 grid such as SWOT
- "has-pyramid" - hierarchical levels, priority tiers
- "has-funnel" - narrowing stages with decreasing numbers
- "has-cycle" - recurring process (PDCA, sprints)
- "has-process" - linear step-by-step workflow
- "has-history" - historical events with past dates

"groupId": give content slides that belong together (same section, similar shape) the same id, so they are styled consistently.

═══════════════════════════════════════════════════════════════════════════════
BUDGET AND STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

1. Target: ${targetSlides} content slides (excluding chapter dividers, quotes and closing).
2. Chapters only for major sections, each with 3-5 content slides. Under 10 content slides, at most 2 chapters; only a long deck needs more than 4.
3. Never put two quote slides back to back.
4. If two slides would overlap, merge them. Repetition is worse than omission.

All text MUST be in ${langLabel}.`;
}

/**
 * Build the user prompt for the structure call.
 *
 * @param {object} options
 * @param {object} options.analysis - normalized output of the analysis call
 */
export function buildStructureUserPrompt({ analysis }) {
  const lines = [
    'Plan the slides for this presentation.',
    '',
    `TITLE: ${analysis.title}`,
  ];
  if (analysis.subtitle) lines.push(`SUBTITLE: ${analysis.subtitle}`);
  if (analysis.summary) lines.push(`SUMMARY: ${analysis.summary}`);
  lines.push('');

  analysis.sections.forEach((section, i) => {
    lines.push(
      `--- SECTION ${i} (${section.importance} importance): ${section.heading} ---`,
    );
    for (const point of section.keyPoints) lines.push(`- ${point}`);
    for (const quote of section.quotes) {
      const by = [quote.author, quote.role].filter(Boolean).join(', ');
      lines.push(`QUOTE: "${quote.text}"${by ? ` (${by})` : ''}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

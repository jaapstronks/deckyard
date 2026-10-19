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
- Preserve distinctions that change a claim: qualifiers, separate terms for different artifacts, and which date or citation belongs to which event. Do not flatten two different conditions into one generic point.
- Keep sequences recognisable: phases, steps and dated events stay in order and say so ("Phase 1: ...", "2026: ...").
- Keep enumerations whole and counted: when the source lists a set (three target groups, five partner organisations), say how many there are and name every member. A sentence that introduces or comments on the set (its goal, an implication, an ambition) is a separate point, never one of the members.
- "excerpt": copy one sentence from the source exactly, character for character. Never paraphrase it. Max 200 characters.
- "quotes": only real quotes from the source with a named speaker. Omit the field when there are none.
- Leave out boilerplate: tables of contents, disclaimers and navigation text. Keep licensing or usage terms when they define the product or its output.`;
}

/**
 * Build the user prompt for the analysis call.
 */
export function buildAnalysisUserPrompt({
  rawContent,
  userName,
  rawFirstSlideTitle,
  sourceImages = [],
}) {
  const lines = ['Analyse this source.', ''];

  if (sourceImages.length) {
    lines.push(
      'SOURCE IMAGES: the source marks its images where they stand, as [IMAGE n: description].',
    );
    lines.push(
      'Give each section an extra field "images": the numbers of the images in that part of the source that show something the audience should see (a photo, chart or diagram the text is about). Leave out images that only decorate. Omit the field when the section has none.',
    );
    lines.push('');
  }

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
LISTS - A LIST CLAIMS ITS ITEMS ARE ALIKE
═══════════════════════════════════════════════════════════════════════════════

A heading with N lines under it tells the audience: there are N things of the kind the heading names. Keep that claim true.

- The count follows the source. When the source enumerates N parallel things, the slide has exactly those N lines and the hint says "has-N-items" with that N. Never pad a short list; a slide with three items is fine.
- Every line answers the question the heading asks. A remark ABOUT the list (its goal, an implication, an ambition, the sentence that introduces it) is not an item: write it as one introducing sentence directly under the heading, ending in a colon, or leave it for the presenter notes.
- Merging or reordering items is fine; adding a different kind of thing is not.

BAD (the source names three target groups):
  "Target groups\\nSMEs in the creative industry\\nFreelance makers\\nEducation institutions\\nGoal: coverage of the whole chain\\nImplication for the design: one scheme for all three"   hint "has-5-items"
GOOD:
  "Target groups\\nTogether these three cover the whole chain:\\nSMEs in the creative industry\\nFreelance makers\\nEducation institutions"   hint "has-3-items"

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

1. Budget: about ${targetSlides} slides in the finished deck, INCLUDING the automatic title slide, chapter dividers, quotes and closing. Plan at most ${targetSlides - 1} slides here. A chapter, quote or closing takes a place that could otherwise carry content.
2. Spend the budget on the important findings first. Combine related facts on one focused content slide instead of making a separate slide for every key point; keep the figures, names and dates that support the main message. Preserve qualifiers ("limited" is not "no") and keep each figure or citation attached to the claim it supports. Low-importance sections may need no slide.
3. Chapters only for major changes of subject, with at least 3 content slides between dividers. Under 10 planned slides, at most 2 chapters; even a long deck rarely needs more than 4.
4. Never put two quote slides back to back. A quote needs to add something the surrounding content does not already say.
5. If two slides would overlap, merge them. Repetition is worse than omission.

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
    for (const image of section.images || []) {
      lines.push(`IMAGE ${image.n}: ${image.description}`);
    }
    lines.push('');
  });

  if (analysis.sections.some((section) => section.images?.length)) {
    lines.push(
      'IMAGES: a section may list images from the source. A content slide may show one of them: add "image": <number> to that slide when the image shows what the slide says. Each image on at most one slide; most slides have none.',
    );
  }

  return lines.join('\n');
}

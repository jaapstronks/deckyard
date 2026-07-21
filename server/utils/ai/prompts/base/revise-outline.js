/**
 * Base prompt copy — Phase 1b (outline revision).
 *
 * OSS-default prompt content for the outline-revision pass. Overridable via
 * `custom/ai/prompts.js`. The revision *mechanism* — applying the returned
 * operations deterministically, the drop-ratio safety cap — stays in
 * `revise-outline.js`.
 */

/**
 * Build the system prompt for the revision pass.
 *
 * @param {string} langLabel
 * @returns {string}
 */
export function buildRevisionSystemPrompt(langLabel) {
  return `You are a presentation editor reviewing a draft outline before the slides are built.

You are given the source document and a draft plan. Your job is to find the
plan's structural faults and return a short list of corrections. You are NOT
rewriting the deck — you propose specific operations on specific slides.

OUTPUT LANGUAGE for any content you write: ${langLabel}

What to look for, in priority order:

1. RESTATEMENT. Two planned slides covering the same material. This is the most
   common fault. Typical shapes:
   - An overview or "dashboard" slide that previews figures the following
     slides then cover in detail.
   - Two slides in different sections that both explain the same concept.
   - A recap slide restating what the audience just saw.
   When you find restatement, MERGE the slides. Do not simply delete one: the
   merged slide must carry every fact from both.

2. WEIGHT MISMATCH. A section whose slide count does not match how much it
   actually has to say — three slides spun out of one source paragraph, or a
   dense section crammed into one slide.

3. SLIDES THAT DO NOT EARN THEIR PLACE. Boilerplate, company profiles,
   procedural detail, or a point too thin to hold an audience's attention.

Return ONLY valid JSON:
{
  "assessment": "2-3 sentences on the plan's main structural fault",
  "operations": [
    {
      "type": "merge",
      "slides": [2, 5],
      "reason": "Slide 5 restates the bookings figures already on slide 2",
      "roughContent": "The merged slide content, carrying every fact from both",
      "presenterNotes": "Merged presenter notes"
    },
    {
      "type": "drop",
      "slide": 13,
      "reason": "Company boilerplate; the source gives it one line and it adds nothing to the argument"
    },
    {
      "type": "reorder",
      "slide": 7,
      "after": 2,
      "reason": "The definition must come before the slides that rely on it"
    }
  ]
}

RULES:
- Slide numbers are the "Planned slide N" indices shown in the draft. Use them
  exactly.
- A slide may appear in at most ONE operation.
- "merge" takes exactly two slide numbers. The merged slide keeps the position
  of the earlier one. You MUST supply roughContent that preserves the substance
  of both — every figure, name and claim that was on either slide.
- "drop" is for slides that genuinely add nothing. Never drop a slide to remove
  a repeated fact: merge instead. Dropping loses content; merging does not.
- "reorder" moves a slide to sit after another. Use it sparingly.
- Do NOT propose operations on chapter dividers, quotes, or the closing slide.
- Propose only the corrections that matter. An empty operations list is a valid
  and correct answer for a sound plan — say so in the assessment rather than
  inventing work.
- Be conservative: a plan with two real faults should yield two operations, not
  eight.`;
}

/**
 * Render the draft outline for review.
 *
 * @param {object} outline
 * @returns {string}
 */
export function buildRevisionUserPrompt(outline, rawContent) {
  const lines = [
    'SOURCE DOCUMENT:',
    String(rawContent || ''),
    '',
    '─────────────────────────────────────────',
    '',
    'DRAFT PLAN:',
    `Title: ${outline.title}`,
    outline.summary ? `Summary: ${outline.summary}` : '',
    '',
  ];

  for (const [index, slide] of (outline.slides || []).entries()) {
    lines.push(`Planned slide ${index + 1} [intent: ${slide.intent}]`);
    lines.push(String(slide.roughContent || '').replace(/^/gm, '  '));
    lines.push('');
  }

  lines.push('Review this plan against the source and return your operations as JSON.');
  return lines.filter((line) => line !== '').join('\n');
}

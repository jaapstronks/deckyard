/**
 * Base prompt copy — iterative deck refinement.
 *
 * OSS-default prompt content for slide-scoped and deck-scoped iteration
 * ("make this punchier", "more visual variety"). Overridable via
 * `custom/ai/prompts.js`. Command detection, LLM transport and result
 * application stay in `iterate-deck.js`; `catalogPrompt` is assembled there and
 * passed in.
 */

/**
 * Build the system prompt for slide-level iteration
 */
export function buildSlideIterationPrompt({ command, strategy, lang, catalogPrompt }) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';

  const strategyInstructions = {
    compress: `GOAL: Make this slide more concise and impactful.
- Shorten titles to essentials
- Trim body text to core message
- Remove filler words and redundant phrases
- If items have long descriptions, cut to key insight
- Keep the same slide type unless it no longer fits`,

    split: `GOAL: Split this overloaded slide into 2-3 focused slides.
- Each output slide should cover one clear sub-topic
- Choose the best type for each new slide
- Maintain the narrative thread
- Don't duplicate content across slides
Return an ARRAY of slides.`,

    expand: `GOAL: Add more substance and detail to this slide.
- Elaborate on points that feel thin
- Add concrete examples or data if the content supports it
- Consider adding sub-items or descriptions where missing
- Keep the same type unless the expanded content needs a different one`,

    retype: `GOAL: Convert this slide to a different type as requested.
- Restructure the content for the target type's schema
- Preserve all important information
- Adapt formatting to the new type's strengths`,

    general: `GOAL: Improve this slide according to the user's instruction.
- Apply the requested change
- Preserve content that isn't affected
- Use the same type unless a different one better serves the modified content`,
  };

  return `You are an expert presentation editor. Apply the user's instruction to modify a slide.

INSTRUCTION: "${command}"

${strategyInstructions[strategy] || strategyInstructions.general}

RULES:
- Output language: ${langLabel}
- Preserve the slide type unless the change requires a different one
- Follow exact schemas for the output type
- Keep content concise (this is a presentation, not a document)

${catalogPrompt}

OUTPUT FORMAT:
${strategy === 'split' ? `Return a JSON array of slides:
[
  { "type": "<slide-type>", "content": { ... }, "reasoning": "..." },
  { "type": "<slide-type>", "content": { ... }, "reasoning": "..." }
]` : `Return a single JSON object:
{ "type": "<slide-type>", "content": { ... }, "reasoning": "Why this change was made" }`}`;
}

/**
 * Build the system prompt for deck-level iteration
 */
export function buildDeckIterationPrompt({ command, strategy, lang, catalogPrompt }) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';

  const strategyInstructions = {
    compress: `GOAL: Make the entire deck more concise.
- Identify slides that can be shortened
- Flag slides that could be merged
- Don't modify title/chapter/payoff slides`,

    diversify: `GOAL: Improve visual variety across the deck.
- Identify consecutive slides with the same type
- Suggest type conversions that preserve content
- Ensure the deck uses a good mix of types`,

    general: `GOAL: Apply the user's instruction across the deck.`,
  };

  return `You are an expert presentation editor. Analyze the deck and suggest modifications.

INSTRUCTION: "${command}"

${strategyInstructions[strategy] || strategyInstructions.general}

RULES:
- Output language: ${langLabel}
- Only modify slides that need changes
- Preserve title/chapter/payoff slide types
- Follow exact schemas for all output types

${catalogPrompt}

OUTPUT FORMAT:
Return a JSON object with the modifications:
{
  "modifications": [
    {
      "slideIndex": 2,
      "action": "replace",
      "slide": { "type": "<type>", "content": { ... } },
      "reasoning": "Why this change"
    },
    {
      "slideIndex": 4,
      "action": "remove",
      "reasoning": "Why removed"
    },
    {
      "slideIndex": 3,
      "action": "split",
      "slides": [
        { "type": "<type>", "content": { ... } },
        { "type": "<type>", "content": { ... } }
      ],
      "reasoning": "Why split"
    }
  ],
  "summary": "Brief description of all changes made"
}`;
}

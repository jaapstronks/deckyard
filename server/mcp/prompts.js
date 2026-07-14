/**
 * MCP Prompt Templates for Deckyard
 *
 * These appear in the Claude Desktop "/" menu and provide
 * guided workflows for common presentation tasks.
 */

/**
 * Register all Deckyard prompts on an McpServer instance
 *
 * @param {McpServer} server
 */
export function registerPrompts(server) {

  // ─── Create Presentation ────────────────────────────────────────────────

  server.prompt(
    'create-presentation',
    'Generate a slide deck from text, notes, or a document',
    [
      {
        name: 'content',
        description: 'Paste your text, meeting notes, report, or bullet points here',
        required: true,
      },
      {
        name: 'language',
        description: 'Language: "nl" for Dutch, "en-GB" for English (auto-detected if omitted)',
        required: false,
      },
      {
        name: 'speaker',
        description: 'Speaker name for the title slide',
        required: false,
      },
    ],
    async ({ content, language, speaker }) => {
      const langNote = language ? ` Use language "${language}".` : '';
      const speakerNote = speaker ? ` The speaker is ${speaker}.` : '';

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Create a presentation from the following content using the Deckyard tools.${langNote}${speakerNote}

After generating, show me:
1. The edit URL so I can open it in the browser
2. A summary of each slide (index, type, title)
3. Run validation to check for any issues

Here's the content:

${content}`,
          },
        }],
      };
    }
  );

  // ─── Create From Structured Data ───────────────────────────────────────

  server.prompt(
    'create-from-structured-data',
    'Build a deck from pre-structured slides — no AI rewriting. Use when you already know the exact slide types and content.',
    [
      {
        name: 'title',
        description: 'Presentation title',
        required: true,
      },
      {
        name: 'data',
        description: 'Structured input describing the slides (JSON, table, or your own notes). The model maps this onto slide types.',
        required: true,
      },
      {
        name: 'language',
        description: 'Language: "nl" or "en-GB" (default: "nl")',
        required: false,
      },
    ],
    async ({ title, data, language }) => {
      const lang = language || 'nl';
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Create a presentation titled "${title}" from the structured data below, using the create_presentation_from_slides tool — NOT create_presentation. Do not rewrite or summarize the data; map it directly onto slide types.

Steps:
1. Call get_slide_types with lang="${lang}" to see available types + example content
2. Map the data onto an array of { type, content } entries
3. Call create_presentation_from_slides with title="${title}", lang="${lang}", validation="strict"
4. If strict validation fails, fix the offending field and retry — do not silently switch to validation="fix"
5. Show me the edit URL and a slide-by-slide summary

Structured data:

${data}`,
          },
        }],
      };
    }
  );

  // ─── Improve Presentation ──────────────────────────────────────────────

  server.prompt(
    'improve-presentation',
    'Analyze an existing presentation and apply improvements',
    [
      {
        name: 'presentationId',
        description: 'The presentation ID to improve (find it via list_presentations)',
        required: true,
      },
      {
        name: 'focus',
        description: 'What to focus on: "punchier", "shorter", "more visual", "better structure", or leave blank for general improvements',
        required: false,
      },
    ],
    async ({ presentationId, focus }) => {
      const focusNote = focus
        ? `Focus especially on making it ${focus}.`
        : 'Look at structure, visual variety, content density, and language.';

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Improve the presentation "${presentationId}" using the Deckyard tools.

Steps:
1. First, get the presentation and show me what's in it
2. Run validation and analysis to find issues
3. ${focusNote}
4. Apply 2-3 targeted improvements using iterate_presentation
5. Show me what changed

Be specific about what you changed and why.`,
          },
        }],
      };
    }
  );

  // ─── Refine Slide ─────────────────────────────────────────────────────

  server.prompt(
    'refine-slide',
    'Improve a specific slide with natural language instructions',
    [
      {
        name: 'presentationId',
        description: 'The presentation ID',
        required: true,
      },
      {
        name: 'instruction',
        description: 'What to change, e.g. "make slide 3 punchier", "split the long list", "convert to KPI grid"',
        required: true,
      },
    ],
    async ({ presentationId, instruction }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Modify the presentation "${presentationId}" using iterate_presentation.

First, get the presentation so you can see the current slides.
Then apply this change: "${instruction}"
Show me the before and after for the affected slide(s).`,
        },
      }],
    })
  );

  // ─── Compress Deck ────────────────────────────────────────────────────

  server.prompt(
    'compress-presentation',
    'Make a presentation shorter and punchier by merging or removing slides',
    [
      {
        name: 'presentationId',
        description: 'The presentation ID to compress',
        required: true,
      },
      {
        name: 'intensity',
        description: '"moderate" (careful) or "aggressive" (cut hard)',
        required: false,
      },
    ],
    async ({ presentationId, intensity }) => {
      const intensityNote = intensity === 'aggressive'
        ? 'Be aggressive — cut hard, merge ruthlessly.'
        : 'Be moderate — only merge or remove where it clearly improves the deck.';

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Compress the presentation "${presentationId}" using the Deckyard tools.

1. First, get the presentation and count the slides
2. Run compress_presentation in preview mode to see recommendations
3. Show me what it suggests (merges and removals)
4. ${intensityNote}
5. Ask me before applying — I want to approve first

Show the current slide count and what it would become after compression.`,
          },
        }],
      };
    }
  );

  // ─── Add Content ──────────────────────────────────────────────────────

  server.prompt(
    'add-content',
    'Add new slides to an existing presentation from additional text',
    [
      {
        name: 'presentationId',
        description: 'The presentation ID to extend',
        required: true,
      },
      {
        name: 'content',
        description: 'New content to add as slides',
        required: true,
      },
    ],
    async ({ presentationId, content }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Add new slides to the presentation "${presentationId}" using append_slides.

New content to add:

${content}

After adding, show me:
1. How many slides were added
2. What types they are
3. The updated slide overview
4. Run validation on the full deck to check for issues`,
        },
      }],
    })
  );

  // ─── Quick Overview ───────────────────────────────────────────────────

  server.prompt(
    'deck-overview',
    'Get a quick overview of a presentation: slides, themes, validation',
    [
      {
        name: 'presentationId',
        description: 'The presentation ID (or leave blank to list all presentations)',
        required: false,
      },
    ],
    async ({ presentationId }) => {
      if (!presentationId) {
        return {
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: `List all my presentations using list_presentations. Show them as a numbered list with title, theme, slide count, and edit URL.`,
            },
          }],
        };
      }

      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Give me a comprehensive overview of the presentation "${presentationId}":

1. Get the presentation data
2. Show each slide: index, type, title/tagline, and a one-line content summary
3. Note the type distribution (how many of each type)
4. Run validation and flag any warnings
5. Show the edit and present URLs

Keep it concise but complete.`,
          },
        }],
      };
    }
  );
}

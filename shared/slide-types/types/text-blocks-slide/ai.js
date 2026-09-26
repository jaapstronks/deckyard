/**
 * text-blocks-slide — the agent-facing editorial layer. **SERVER-ONLY.**
 *
 * This is the hand-written half of the agent contract: when to pick this type
 * and when not to. The other half — the field schema — is derived from the
 * definition's `fields[]` by deriveAgentSchema() and is deliberately absent
 * here (#407).
 *
 * ## Why this file is server-only, and enforced
 *
 * Deckyard has no bundler, so an `import` in a module the browser loads is a
 * file the browser fetches. The AI catalog is ~168 KB of prose that the browser
 * never executes; colocating it *and* importing it from `index.js` would add it
 * to the 368 KB of type modules every presenter page already pulls down. So the
 * rule is: a type's `index.js`/`render.js` import nothing from here, and the
 * server catalog reaches in from its side.
 * tests/slide-type-directory-boundary.test.js fails if that ever stops being
 * true — the track's own point is that an agreement without a test drifts.
 */

export const ai = {
  category: 'content',
  resolveInPhase1: false,
  description: `
      A SPECIFIC slide for a DIRECTIONAL RELATIONSHIP between 1-3 ROWS of
      colored blocks: the rows are connected by arrows that assert
      cause→effect, input→output, before→after, or problem→solution.

      USE THIS ONLY WHEN THE ROWS GENUINELY RELATE. The arrow between rows
      claims causality or sequence, so picking this type asserts a relationship
      that may not exist. If the content is just parallel points, categories,
      or a plain enumeration with NO cause/sequence between the groups, do NOT
      use text-blocks — use list-slide (title+text items) or content-slide
      (bullets). When in doubt, choose the plainer type.

      SIGNAL TEST: if you would leave every row's arrow on "none", the content
      almost certainly does NOT belong on a text-blocks-slide.

      STRUCTURE: rows[] array with 1-3 row objects. Each row has:
      - title: Optional heading for the row (usually empty for row 1)
      - color: "yellow" (accent, good for inputs/activities) or "black" (dark, good for outputs)
      - arrow: "none", "down", or "up" — the flow to the NEXT row; set "down"/"up"
        when the next row is caused by / produced from this one
      - blocks: Array of 1-6 block objects, each with { title, body }

      GENUINE PATTERNS (each has a real relationship):
      1. TWO-ROW CAUSE→EFFECT: Row 1 (activities, arrow: "down") -> Row 2 (outputs)
      2. THREE-ROW FLOW: Inputs -> Processing -> Outputs
      3. PROBLEM → SOLUTION or BEFORE → AFTER (two contrasting rows)
    `,
  bestFor: [
    'Cause→effect: activities/programmes (A, B, C) that PRODUCE specific outputs',
    'Input→processing→output flows',
    'Problem→solution or challenge→response structures',
    'Before→after transformations',
    'Strategy→tactics→results chains',
    'Any 2-3 row structure where each row LEADS TO the next',
    'Consequence chains: X causes Y, which causes Z. Prefer this over process-slide when nobody performs the steps -- the items are outcomes, not actions',
  ],
  notFor: [
    'Plain enumerations or lists of points (use list-slide or content-slide)',
    'Parallel items/categories with NO causal or sequential relationship — ' +
      'use list-slide, or icon-card-grid-slide if each needs an icon',
    'A single row of blocks used just to group text (use list-slide)',
    'Single items without grouping (use content-slide)',
    'Sequential timelines with dates (use timeline-slide)',
    'Items that each need an icon (use icon-card-grid-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'Programme activities A, B, C -> Outputs (IDEAL FOR CAUSALITY)',
    title: 'Human Capital Development',
    subheading: 'How our instruments produce results',
    rows: [
      {
        title: 'Instruments',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          {
            title: 'A) Learning Communities',
            body: 'For students, researchers and practitioners',
          },
          {
            title: 'B) Education Modules',
            body: 'Lifelong learning and upskilling',
          },
          {
            title: 'C) Training Vouchers',
            body: 'Professional skills development',
          },
        ],
      },
      {
        title: 'Outputs',
        color: 'black',
        arrow: 'none',
        blocks: [
          { title: '12 Communities', body: 'Active learning networks' },
          { title: '30 Modules', body: 'Training programmes' },
          { title: '10,000 Professionals', body: 'Educated and upskilled' },
        ],
      },
    ],
  },
  {
    _variation: 'Two rows with arrow (cause -> effect)',
    title: 'Challenges and Solutions',
    subheading: 'How we address key issues',
    rows: [
      {
        title: '',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          { title: 'Challenge A', body: 'Market uncertainty' },
          { title: 'Challenge B', body: 'Resource constraints' },
          { title: 'Challenge C', body: 'Technical complexity' },
        ],
      },
      {
        title: '',
        color: 'black',
        arrow: 'none',
        blocks: [
          { title: 'Solution A', body: 'Agile approach' },
          { title: 'Solution B', body: 'Partnerships' },
          { title: 'Solution C', body: 'Modular design' },
        ],
      },
    ],
  },
  {
    _variation: 'Three rows (input -> process -> output)',
    title: 'Value Creation Process',
    subheading: 'From inputs to outcomes',
    rows: [
      {
        title: 'Inputs',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          { title: 'Data', body: 'Raw information' },
          { title: 'Resources', body: 'Team and tools' },
          { title: 'Insights', body: 'Market research' },
          { title: 'Feedback', body: 'User input' },
        ],
      },
      {
        title: 'Processing',
        color: 'black',
        arrow: 'down',
        blocks: [
          { title: 'Analysis', body: 'Deep dive into patterns' },
          { title: 'Synthesis', body: 'Combining insights' },
        ],
      },
      {
        title: 'Outputs',
        color: 'yellow',
        arrow: 'none',
        blocks: [
          { title: 'Strategy', body: 'Clear direction' },
          { title: 'Actions', body: 'Concrete steps' },
          { title: 'Results', body: 'Measurable impact' },
        ],
      },
    ],
  },
  {
    _variation: 'Before -> after (the arrow claims the transformation)',
    title: 'Before vs After',
    subheading: 'The transformation',
    rows: [
      {
        title: 'Before',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          { title: 'Manual', body: 'Time-consuming' },
          { title: 'Siloed', body: 'Poor collaboration' },
          { title: 'Reactive', body: 'Waiting for issues' },
        ],
      },
      {
        title: 'After',
        color: 'black',
        arrow: 'none',
        blocks: [
          { title: 'Automated', body: 'Efficient workflows' },
          { title: 'Connected', body: 'Seamless sharing' },
          { title: 'Proactive', body: 'Preventing problems' },
        ],
      },
    ],
  },
];

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
      'Parallel items/categories with NO causal or sequential relationship — '
        + 'use list-slide, or icon-card-grid-slide if each needs an icon',
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
    row1Title: 'Instruments',
    row1Count: '3',
    row1Color: 'yellow',
    row1Block1Title: 'A) Learning Communities',
    row1Block1Body: 'For students, researchers and practitioners',
    row1Block2Title: 'B) Education Modules',
    row1Block2Body: 'Lifelong learning and upskilling',
    row1Block3Title: 'C) Training Vouchers',
    row1Block3Body: 'Professional skills development',
    arrow1: 'down',
    row2Enabled: 'yes',
    row2Title: 'Outputs',
    row2Count: '3',
    row2Color: 'black',
    row2Block1Title: '12 Communities',
    row2Block1Body: 'Active learning networks',
    row2Block2Title: '30 Modules',
    row2Block2Body: 'Training programmes',
    row2Block3Title: '10,000 Professionals',
    row2Block3Body: 'Educated and upskilled',
  },
  {
    _variation: 'Two rows with arrow (cause -> effect)',
    title: 'Challenges and Solutions',
    subheading: 'How we address key issues',
    row1Count: '3',
    row1Color: 'yellow',
    row1Block1Title: 'Challenge A',
    row1Block1Body: 'Market uncertainty',
    row1Block2Title: 'Challenge B',
    row1Block2Body: 'Resource constraints',
    row1Block3Title: 'Challenge C',
    row1Block3Body: 'Technical complexity',
    arrow1: 'down',
    row2Enabled: 'yes',
    row2Count: '3',
    row2Color: 'black',
    row2Block1Title: 'Solution A',
    row2Block1Body: 'Agile approach',
    row2Block2Title: 'Solution B',
    row2Block2Body: 'Partnerships',
    row2Block3Title: 'Solution C',
    row2Block3Body: 'Modular design',
  },
  {
    _variation: 'Three rows (input -> process -> output)',
    title: 'Value Creation Process',
    subheading: 'From inputs to outcomes',
    row1Title: 'Inputs',
    row1Count: '4',
    row1Color: 'yellow',
    row1Block1Title: 'Data',
    row1Block1Body: 'Raw information',
    row1Block2Title: 'Resources',
    row1Block2Body: 'Team and tools',
    row1Block3Title: 'Insights',
    row1Block3Body: 'Market research',
    row1Block4Title: 'Feedback',
    row1Block4Body: 'User input',
    arrow1: 'down',
    row2Enabled: 'yes',
    row2Title: 'Processing',
    row2Count: '2',
    row2Color: 'black',
    row2Block1Title: 'Analysis',
    row2Block1Body: 'Deep dive into patterns',
    row2Block2Title: 'Synthesis',
    row2Block2Body: 'Combining insights',
    arrow2: 'down',
    row3Enabled: 'yes',
    row3Title: 'Outputs',
    row3Count: '3',
    row3Color: 'yellow',
    row3Block1Title: 'Strategy',
    row3Block1Body: 'Clear direction',
    row3Block2Title: 'Actions',
    row3Block2Body: 'Concrete steps',
    row3Block3Title: 'Results',
    row3Block3Body: 'Measurable impact',
  },
  {
    _variation: 'Single row grid (simpler than icon-card-grid)',
    title: 'Key Focus Areas',
    subheading: 'Our priorities this quarter',
    row1Count: '4',
    row1Color: 'black',
    row1Block1Title: 'Growth',
    row1Block1Body: 'Expand market share',
    row1Block2Title: 'Quality',
    row1Block2Body: 'Improve standards',
    row1Block3Title: 'Efficiency',
    row1Block3Body: 'Optimize processes',
    row1Block4Title: 'Culture',
    row1Block4Body: 'Strengthen team',
    arrow1: 'none',
    row2Enabled: 'no',
  },
  {
    _variation: 'Two rows comparison (no arrow - contrast)',
    title: 'Before vs After',
    subheading: 'The transformation',
    row1Title: 'Before',
    row1Count: '3',
    row1Color: 'yellow',
    row1Block1Title: 'Manual',
    row1Block1Body: 'Time-consuming',
    row1Block2Title: 'Siloed',
    row1Block2Body: 'Poor collaboration',
    row1Block3Title: 'Reactive',
    row1Block3Body: 'Waiting for issues',
    arrow1: 'none',
    row2Enabled: 'yes',
    row2Title: 'After',
    row2Count: '3',
    row2Color: 'black',
    row2Block1Title: 'Automated',
    row2Block1Body: 'Efficient workflows',
    row2Block2Title: 'Connected',
    row2Block2Body: 'Seamless sharing',
    row2Block3Title: 'Proactive',
    row2Block3Body: 'Preventing problems',
  },
];

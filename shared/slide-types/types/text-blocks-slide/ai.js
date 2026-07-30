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

/**
 * comparison-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Side-by-side comparison of two options/concepts.
      Each side has title and body (Markdown bullets). Optional verdict badge.

      The 'variant' field picks the TREATMENT — the same two columns, styled to
      say what kind of comparison this is. It changes nothing about the fields:

      - versus       — the neutral duel, two options weighed evenly (default)
      - before-after — a change over time; put the old state left, the new
                       state right, because the left column reads as the one
                       being left behind
      - pros-cons    — one subject's upsides against its downsides; the left
                       column is the pros and the right the cons, and the
                       bullets become ✓ / ✗
      - tradeoff     — two options read off against criteria rather than pitted
                       against each other ("A is faster, B is simpler")

      Leave 'variant' out for an ordinary A-vs-B slide.
    `,
  bestFor: [
    'A vs B comparisons (products, approaches)',
    'Pros and cons analysis (variant: pros-cons, pros on the left)',
    'Before vs after transformations (variant: before-after, before on the left)',
    'Option evaluation and decision support (variant: tradeoff)',
  ],
  notFor: [
    'More than 2 options (use table-slide or icon-card-grid-slide)',
    '2x2 matrices like SWOT (use matrix-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'Pros and cons comparison',
    title: 'Build vs Buy Decision',
    variant: 'pros-cons',
    leftTitle: 'Build In-House',
    leftBody:
      '- Full customization possible\n- Complete ownership of IP\n- Higher upfront investment\n- Longer time to market\n- Requires dedicated team',
    rightTitle: 'Buy Solution',
    rightBody:
      '- Faster deployment\n- Lower initial cost\n- Proven reliability\n- Vendor dependency\n- Limited customization',
    verdict: 'Recommended: Buy for MVP, build later',
    background: 'lime',
  },
  {
    _variation: 'Before and after transformation',
    title: 'Digital Transformation Impact',
    variant: 'before-after',
    leftTitle: 'Before',
    leftBody:
      '- Manual data entry\n- Paper-based workflows\n- Siloed departments\n- 2-week processing time\n- High error rate (15%)',
    rightTitle: 'After',
    rightBody:
      '- Automated pipelines\n- Digital-first processes\n- Connected systems\n- Same-day processing\n- Near-zero errors (<1%)',
    background: 'mist',
  },
  {
    _variation: 'Two options read off against criteria',
    title: 'Postgres or SQLite',
    variant: 'tradeoff',
    leftTitle: 'Postgres',
    leftBody:
      '- Concurrency: many writers\n- Operations: a server to run\n- Scale: grows with the team',
    rightTitle: 'SQLite',
    rightBody:
      '- Concurrency: one writer\n- Operations: a file to copy\n- Scale: one machine',
    verdict: 'SQLite until the second writer',
    background: 'mist',
  },
];

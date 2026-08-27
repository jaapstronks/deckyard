/**
 * callout-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      One idea, alone on a slide, with a stated promise about how to read it.
      The 'variant' field carries that promise and picks the accent + icon:

      - insight    — the takeaway the deck is building toward
      - warning    — a gotcha the audience must not miss
      - definition — one term pinned down before it is used; put the TERM in
                     'label' and its meaning in 'body'
      - note       — a quiet aside, an exception, a caveat
      - tip        — a piece of practical advice

      Leave 'label' empty for every variant except definition: it then falls
      back to the right eyebrow ("Warning", "Tip", …) in the deck's language.
      Keep 'body' to one or two sentences — the slide's whole force comes from
      being short. Use it sparingly, at most a couple of times per deck; a
      callout every third slide stops being a contrast.
    `,
  bestFor: [
    'A single key takeaway you want to land on its own slide',
    'A warning or gotcha the audience must not miss',
    'Defining one term before you use it (variant: definition)',
    'A short aside or tip that would clutter a content slide',
  ],
  notFor: [
    'A full argument or several points (use content-slide or list-slide)',
    'A pull quote with a named speaker (use quote-slide)',
    'Two options weighed against each other (use comparison-slide)',
    'A section divider between chapters (use chapter-title-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from. One per variant, because the variant is the
 * whole decision this type asks a model to make.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    variant: 'insight',
    body: 'Teams that ship weekly find integration bugs six times earlier than teams that ship quarterly.',
    source: 'DORA, State of DevOps 2024',
    background: 'mist',
  },
  {
    variant: 'warning',
    body: 'Migrating the database without draining the queue first will drop in-flight jobs. Drain, then migrate.',
    background: 'mist',
  },
  {
    variant: 'definition',
    label: 'Lead time',
    body: 'The elapsed time from a commit landing on main to that commit running in production.',
    background: 'mist',
  },
  {
    variant: 'note',
    body: 'These figures cover the Dutch market only; the European roll-out starts in Q3.',
    background: 'mist',
  },
  {
    variant: 'tip',
    body: 'Run the migration behind a feature flag so you can roll back without a deploy.',
    background: 'mist',
  },
];

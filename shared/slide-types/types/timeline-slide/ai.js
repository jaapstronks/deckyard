/**
 * timeline-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Chronological timeline with 2-10 DATED events.
      Visual display with cards above and below a timeline track.

      Use for both PAST events (history, milestones) and FUTURE roadmaps
      (phases, development plans, project timelines).

      EVERY item MUST have a real date or date-range — that is what places it on
      the time axis (e.g. "Q1 2025", "Apr 2025", "23 May 2025", "Jul–Oct 2025").
      An item with no date does NOT belong on the timeline. When you turn source
      text into a timeline, keep ONLY the dated events as items; do not invent a
      date, and do not force an undated line into an item.

      Non-dated content goes elsewhere, not as an extra item:
      - A closing/summarising line — a total, an aggregate count, a takeaway
        (e.g. "42 partners across 5 consortia") — belongs in \`bottomSubheading\`.
      - Framing/context for the whole timeline belongs in \`subheading\`.

      Keep item \`title\` short (a few words); put detail in the item's optional
      \`text\`. Keep the slide \`title\` concise (e.g. "ADRIE activities"), not a
      long descriptive sentence.

      IMPORTANT: This is for TIME-BASED sequences, not meeting agendas.
      For meeting agendas, use list-slide instead.
    `,
    bestFor: [
      'Roadmaps with phases (Q1/Q2/Q3, Year 1/2/3, Phase 1/2/3)',
      'Company history and milestones',
      'Project retrospectives and future plans',
      'Historical event sequences',
      'Product evolution timelines',
      'Future development plans',
      'Now/Next/Later timelines',
    ],
    notFor: [
      'Meeting agendas (use list-slide)',
      'Non-sequential items (use icon-card-grid-slide or list-slide)',
      'More than 10 items (split into multiple slides)',
      'Processes without dates/phases (use process-slide)',
      'Undated summary/total lines as items (put them in bottomSubheading)',
    ],
};

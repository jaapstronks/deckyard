/**
 * list-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      A "fancy list" slide with structured items. Each item has a title and short explanation.
      Visually cleaner than content-slide bullets. 2-8 items.

      SUBHEADING (optional): a single-sentence intro that sets up the list, like a
      hero/lead paragraph on a web page - NOT a second title. Use it to frame WHY
      these items or WHERE they come from. Example: title "5 trends in duurzaam
      ontwerp", subheading "Op basis van ons jaarlijkse sectoronderzoek zetten we
      de belangrijkste trends op een rij:". Keep it to one line.

      LAYOUT RULES:
      - layout:"one-column" - Use for 2-4 items (default, items stack vertically)
      - layout:"two-column" - Use for 5-8 items (items split into two columns to fit)

      IMPORTANT: When you have 5 or more items, ALWAYS use layout:"two-column"!

      TEXT SIZE (density, optional): "auto" (default sizing), "comfortable" (larger
      titles + text, good for a short list of 2-4 items so it fills the slide),
      "compact" (smaller, good when many items must fit). Prefer "comfortable" for
      sparse lists and "compact" for dense ones.

      Use variant:"numbers" when order matters (steps, ranked items).
      Use variant:"bullets" when order doesn't matter (tips, points).
    `,
    bestFor: [
      'Tips, recommendations, or best practices',
      'Meeting agendas (not roadmaps - those are timeline)',
      'Steps with short explanations',
      'Do/don\'t lists',
      'Key takeaways or highlights',
      'Any list where items have both a title AND a brief explanation',
    ],
    notFor: [
      'NUMERIC HIGHLIGHTS like "220 trajectories" or "10,000 professionals" (use kpi-metrics-slide!)',
      'Output targets or deliverables with specific numbers (use kpi-metrics-slide)',
      'Parallel categories that should be compared side-by-side (use card slides)',
      'Timeline/roadmap with phases over time (use timeline-slide)',
      'Simple bullets without title+text structure (use content-slide)',
    ],
};

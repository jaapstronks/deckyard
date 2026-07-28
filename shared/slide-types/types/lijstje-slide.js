import listSlide from './list-slide.js';

/**
 * Back-compat alias of `list-slide`, kept only so stored decks that carry the
 * original Dutch type name keep rendering. **Nothing produces it any more**:
 * the markdown importer emits `list-slide` since the consolidation, and the
 * picker, the settings curation and the agent catalog no longer offer it.
 *
 * It used to be a full copy of the definition, which is how it drifted: the
 * copy kept a much older layout resolution (two columns from 5 items, no
 * capacity model, no size resolution at all), so an imported or legacy list
 * rendered visibly worse than the same content on a `list-slide`. Making it a
 * genuine alias fixed the behaviour but left a second name for one type, and
 * the picker showed both — two adjacent tiles, both labelled "List".
 *
 * Rung 1 of the deprecation ladder (docs/reference/slide-type-removal.md):
 * registered and rendering, out of every insertion path. Because the field
 * schema is *identical* to `list-slide`, the eventual migration is a pure
 * rename with no content conversion. Rung 3 (removal + a `removed.js`
 * tombstone with `successor: 'list-slide'`) waits until after A7.1's KPI
 * measurement — an alias with no CSS and no render of its own would distort
 * that number rather than confirm it.
 */
export default {
  structure: 'collection',
  ...listSlide,
  // Renderable, not authorable: drops out of the picker (isInsertableSlideType)
  // and out of AI/MCP (isAgentOptOut).
  deprecated: true,
  // Redundant with `deprecated` for agents, kept explicit: offering both names
  // would be a duplicate entry an agent has to choose between.
  ai: false,
};

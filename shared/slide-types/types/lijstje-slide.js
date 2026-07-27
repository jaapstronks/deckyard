import listSlide from './list-slide.js';

/**
 * Back-compat alias of `list-slide`, kept so decks that stored the original
 * Dutch type name keep rendering — and so the markdown importer, which still
 * emits this type name (server/utils/markdown-import/constants.js), produces
 * slides that behave exactly like a `list-slide`.
 *
 * It used to be a full copy of the definition, which is how it drifted: the
 * copy kept a much older layout resolution (two columns from 5 items, no
 * capacity model, no size resolution at all), so an imported or legacy list
 * rendered visibly worse than the same content on a `list-slide`. It is now
 * genuinely an alias — one definition, one behaviour — with the single
 * documented difference below.
 */
export default {
  ...listSlide,
  // Deliberately not offered to agents (see server/utils/ai/slide-catalog/
  // agent-catalog.js): offering both names would just be a duplicate entry an
  // agent has to choose between.
  ai: false,
};

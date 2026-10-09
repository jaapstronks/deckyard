/**
 * Core layouts a fork can compose instead of copying (D270).
 *
 * The one stable address for a core slide type that offers its markup as a
 * function. A fork imports from here, never from `types/<name>/…`: those are
 * internal paths that move with upstream reorganisations, and a deep import
 * is what breaks on merge.
 *
 * The shape per type is two functions: `resolve…View(content, slide, ctx)`
 * returns a plain view object (documented as a typedef next to it), and
 * `render…View(view)` returns the markup. A fork's own `renderHtml` resolves
 * core's view, sets its own values in it (another logo, an extra root class
 * or modifier) and renders. It never writes a core class name and never
 * escapes: the render function escapes every string in the view. Setting
 * `view.background` to `null` asks for no `slide-bg-*` class at all, for a
 * ground nothing in the deck paints.
 *
 * A type that offers its layout also offers its inline-edit descriptor here
 * (`titleInlineEdit`), so a fork that lends the markup sets
 * `inline: titleInlineEdit` instead of copying a descriptor whose anchors name
 * core classes.
 *
 * Types are added on request, one at a time (a fork asks through a briefing):
 * `title-slide` is the first because a fork measured the cost of copying it.
 * The recipe is in docs/developer/slide-types.md § Leaning on a core layout.
 * `tests/fixtures/fork-slide-types/fork-title-slide.js` composes on this
 * module, so core's fork CI lane breaks the day a view field is renamed.
 */

export {
  resolveTitleView,
  renderTitleView,
} from './types/title-slide/render.js';
export { inlineEdit as titleInlineEdit } from './types/title-slide/inline-edit.js';

/** @typedef {import('./types/title-slide/render.js').TitleView} TitleView */

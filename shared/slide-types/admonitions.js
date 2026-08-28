/**
 * The admonition vocabulary — what a warning IS, stated once.
 *
 * A callout earns its meaning by contrast, and a deck has two axes to make
 * that contrast on. **Temporal**: a whole slide that IS the warning, against
 * the slides before and after it — `callout-slide`. **Spatial**: a small
 * contrasting block beside the prose it comments on — the aside inset
 * (`aside-field.js`). They are deliberately different shapes, so they have
 * different renderers and different stylesheets.
 *
 * What they must NOT differ on is the vocabulary. If the slide says "Let op"
 * under a `circle-alert` and the inset says something else under a triangle,
 * a deck has two admonition systems in it rather than one — which is the whole
 * thing the editorial slide-type work set out to avoid. So neither surface
 * owns the table: it lives here, and each reads the row it needs.
 *
 * The five kinds are the callout family; the inset takes only the three
 * **quiet** ones. An inset is no place for a key insight or a definition —
 * those are the point of a slide, not a footnote on one.
 *
 * NOT here: the COLOUR. A tone is a CSS role (`--slide-color-caution` and its
 * family in `00-tokens.css`, reached through the `--slide-tone` seam that
 * `00-patterns.css` documents), and the variant → tone mapping belongs in the
 * stylesheet next to the treatment it feeds. A colour name in this file would
 * be half a CSS rule written in JavaScript.
 */

/** The full family, in picker order: loudest promise first. */
export const ADMONITION_VARIANTS = Object.freeze([
  'insight',
  'warning',
  'definition',
  'note',
  'tip',
]);

/**
 * The three an inset may take.
 *
 * Ordered quietest first, because that is the order an author reads them in
 * when choosing whether a paragraph deserves a box at all.
 */
export const QUIET_ADMONITION_VARIANTS = Object.freeze([
  'note',
  'tip',
  'warning',
]);

/**
 * variant → its derived parts.
 *
 * `icon` is a canonical Lucide name from the curated catalog
 * (`shared/icon-catalog.js`); all five are vendored. `copyKey` names the
 * eyebrow word in `SLIDE_COPY` (`shared/slide-types/slide-copy.js`) — rendered
 * copy follows the DECK's language, which is why it is slide-copy and not the
 * `t()` UI layer.
 *
 * @type {Readonly<Record<string, {icon: string, copyKey: string}>>}
 */
export const ADMONITION_META = Object.freeze({
  insight: { icon: 'lightbulb', copyKey: 'admonitionInsight' },
  warning: { icon: 'circle-alert', copyKey: 'admonitionWarning' },
  definition: { icon: 'book', copyKey: 'admonitionDefinition' },
  note: { icon: 'info', copyKey: 'admonitionNote' },
  tip: { icon: 'sparkles', copyKey: 'admonitionTip' },
});

/**
 * Resolve a stored value against a vocabulary, falling back to its default.
 *
 * Both surfaces need the same answer to "the deck stored something; is it a
 * kind I know?", and both must degrade rather than emit a class no stylesheet
 * defines — an unrecognised variant should look like the default, not like
 * nothing.
 *
 * @param {unknown} value - the stored variant
 * @param {readonly string[]} vocabulary - the kinds this surface offers
 * @param {string} fallback - the kind an unknown value resolves to
 * @returns {string}
 */
export function resolveAdmonitionVariant(value, vocabulary, fallback) {
  const v = typeof value === 'string' ? value.trim() : '';
  return vocabulary.includes(v) ? v : fallback;
}

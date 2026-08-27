/**
 * callout-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 */

export default {
  /**
   * Which curated shelf offers this type: the editor's insert picker and the
   * settings curation list both derive their membership from this key. Display
   * order stays with each consumer. Vocabulary + rationale in
   * shared/slide-types/authoring-groups.js.
   *
   * `basic`, not `layouts`: a callout is a plain text slide with one promise
   * attached, and it competes with content-slide for the same moment.
   */
  group: 'basic',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'One insight, warning or definition on its own slide',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases:
    'callout admonition insight takeaway warning caution definition note tip ' +
    'aside kernpunt inzicht waarschuwing let op definitie noot uitleg begrip',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   *
   * `statement`, shared with payoff: the shape a callout draws IS a centred
   * statement, and the five variants differ in colour and glyph rather than in
   * layout — neither of which a two-line schematic can show. A dedicated kind
   * would draw the same two lines under a new name.
   */
  schematic: { kind: 'statement' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    variant: 'insight',
    label: '',
    body: 'Teams that ship weekly find integration bugs **six times** earlier than teams that ship quarterly.',
    source: 'DORA, State of DevOps 2024',
    background: 'mist',
  },
};

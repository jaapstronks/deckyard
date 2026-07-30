/**
 * logo-wall-slide — the authoring companions.
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
   */
  group: 'media',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'A wall of logos',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'sponsors clients brands partners logos logowand klanten',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'logos', cells: 8 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Our Partners',
    subheading: 'Trusted by industry leaders',
    logos: [
      { image: 'https://picsum.photos/seed/logo1/200/80', name: 'Acme Corp', alt: 'Acme Corp logo' },
      { image: 'https://picsum.photos/seed/logo2/200/80', name: 'TechFlow', alt: 'TechFlow logo' },
      { image: 'https://picsum.photos/seed/logo3/200/80', name: 'Innovate Inc', alt: 'Innovate Inc logo' },
      { image: 'https://picsum.photos/seed/logo4/200/80', name: 'GlobalNet', alt: 'GlobalNet logo' },
      { image: 'https://picsum.photos/seed/logo5/200/80', name: 'Summit Co', alt: 'Summit Co logo' },
      { image: 'https://picsum.photos/seed/logo6/200/80', name: 'Bright Labs', alt: 'Bright Labs logo' },
    ],
  },
};

/**
 * gallery-slide — the authoring companions.
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
  description: 'A grid of images',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'photos images grid fotogalerij beelden',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'gallery', cells: 6 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Project Highlights',
    subheading: 'Recent work',
    layout: 'grid',
    images: [
      {
        src: 'https://picsum.photos/seed/gallery1/800/600',
        caption: 'Project Alpha',
        alt: '',
      },
      {
        src: 'https://picsum.photos/seed/gallery2/800/600',
        caption: 'Project Beta',
        alt: '',
      },
      {
        src: 'https://picsum.photos/seed/gallery3/800/600',
        caption: 'Project Gamma',
        alt: '',
      },
      {
        src: 'https://picsum.photos/seed/gallery4/800/600',
        caption: 'Project Delta',
        alt: '',
      },
    ],
    background: 'mist',
  },
};

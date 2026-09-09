/**
 * image-set-slide — the authoring companions.
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
  description: 'Two or three images with text',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'photos row duo beeldreeks foto rij tekst',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { row: 'top' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * The placeholder image URLs are inlined (see image-slide's note): an
   * authoring.js is self-contained plain data, and the seeds are meaningless
   * picsum ids.
   */
  sample: {
    title: 'Three moments',
    body: '- Where it started\n- What changed\n- Where it stands now',
    images: [
      {
        src: 'https://picsum.photos/seed/image-set-1/800/600',
        alt: 'Sample image',
      },
      {
        src: 'https://picsum.photos/seed/image-set-2/800/600',
        alt: 'Sample image',
      },
      {
        src: 'https://picsum.photos/seed/image-set-3/800/600',
        alt: 'Sample image',
      },
    ],
    caption: '',
    imageRole: 'content',
    layout: 'top',
    background: 'lime',
  },
};

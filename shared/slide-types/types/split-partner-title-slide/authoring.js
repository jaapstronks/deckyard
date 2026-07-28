/**
 * split-partner-title-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 *
 * **This type is `deprecated` (archived 2026-07-21) and hidden from every
 * insertion path.** It owns no live authoring companions — no schematic, no
 * picker group — so it stays out of SLIDE_TYPE_SCHEMATIC and the picker maps.
 * The one companion it still carries is `sample`, and only so that
 * getSampleContent('split-partner-title-slide') round-trips byte-identically for
 * any stored deck or fork that asks for it. Moving it here from the old
 * consumer's map is what lets fase 2 of the seam collapse
 * (docs/plans/briefs/slide-type-seam-collapse.md) delete the type by deleting
 * its own directory, instead of hunting a straggler in a far-away editor file.
 */

export default {
  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition). Dead in practice (the picker never offers a
   * deprecated type); kept for behavioural identity, see the module note above.
   */
  sample: {
    title: 'Partnership',
    subheading: 'Working together',
    partnerLogo: '',
    background: 'lime',
  },
};

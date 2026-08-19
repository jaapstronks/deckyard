/**
 * custom-html-slide — the authoring companions.
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
  group: 'other',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'Your own HTML and CSS, for anything else',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'raw html css code escape hatch eigen code',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'code' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    html: '<div class="ch-card">\n  <p class="ch-kicker">Uptime this quarter</p>\n  <p class="ch-figure">99.98%</p>\n  <p class="ch-note">Two incidents, both under four minutes.</p>\n</div>',
    css: '.ch-card {\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 0.35rem;\n  text-align: center;\n}\n.ch-kicker { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.9rem; opacity: 0.7; }\n.ch-figure { font-size: 4.5rem; font-weight: 800; line-height: 1; }\n.ch-note { opacity: 0.7; }',
    background: 'lime',
  },
};

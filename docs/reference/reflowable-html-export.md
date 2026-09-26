# Reflowable "reader" HTML export

A published deck can be read as a **semantic, reflowable document** in addition
to the canvas presentation view. Where the canvas page is a fixed 1600×900
projection driven by presenter JavaScript, the reader is a plain accessible
document that stays readable with JavaScript — and author CSS — turned off.

## Where it lives

- **Published URL:** `/p/:id-:slug/reader` (served alongside the canvas page at
  `/p/:id-:slug`). Same publish lookup, language projection (`?lang=`), and
  `published` visibility filter; no auth.
- **Builder:** `server/export/reader.js` → `buildReaderHtml(repoRoot, pres, opts)`.
- **Projection:** `shared/slide-types/semantic-projection.js` — a pure,
  field-vocabulary-driven projection of each slide's content.

## What it produces

- `<html lang dir>`, a `<header>` with the deck `<h1>`, a `<nav aria-label="Slides">`
  table of contents, and a `<main>` with one
  `<section data-slide-type="…" aria-labelledby="slide-N-title">` per slide
  (the full type name, the same marker every HTML surface puts on its slide
  wrapper: `section.deck-slide` in presenter, export and embed),
  each led by an `<h2>`. The section is emitted by `renderSlideSectionHtml` in
  the projection, not by the document wrapper, so everything the reader says
  about a slide is in one place and one fixture.
- The print handout (`server/export/print.js`, the editor's **Text handout**)
  is the same projection in another shell: it emits these sections unchanged
  and adds only its toolbar and a stylesheet for paper. There is one
  reader; `tests/print-reads-projection.test.js` holds both documents to the
  same section HTML per type.
- Per-slide content is derived generically from the slide type's declared
  `fields` (see `field-types.js`), so **every** slide type — core or custom —
  projects without bespoke code and the output cannot drift from the type
  definitions:
  - `string` → `<p>`, `markdown` → semantic prose (headings, lists, blockquotes),
    `code` → `<pre><code>`, `csv` → a `<table>`. A `code` field declaring
    `markup: true` holds author HTML the canvas renders (custom-html's `html`),
    so it projects as that HTML, sanitized by the canvas's own
    `sanitizeSlideHtmlSync`, in one `<div data-field>`; its stylesheet (`css`)
    is `presentational`, and so are the author's `style` attributes, which the
    projection drops (`presentation: false`): a reflowable document reads
    without author CSS wherever it sits (D151). `class` and `id` stay, they
    are structure. The markup's first `h1..h3` names a slide that has no
    title, as a hidden heading (below), and stays in the body where the author
    put it. A `dataset` payload's
    `<caption>` is the type's `datasetSummary` sentence in the deck language
    ("Lijndiagram met 5 punten. Min: 25. Max: 85.", the same sentence the
    canvas gives assistive tech) followed by its `encodingKeys` fields as
    "<label>: <value>" (a line chart names its two series). A `tabular`
    type's rows array is a `<table>` too; `rowHeader: 'first'` makes its first
    column `<th scope="row">`, as the canvas styles that column the label.
  - A text field's `role` decides its element (D128). The same declaration that
    sets a field's style affordances (`text-alignment.md`) is its document
    semantics, because both follow from what the text is. One table, applied to
    the slide body and to every item alike:
    - `quote` → `<blockquote data-field>` around the paragraph(s).
    - `attribution` (a name, a role, a source, a byline) → a `<p data-field>`
      inside the block's **one** `<footer>`, placed where the first attribution
      field is declared and outside the `<blockquote>`. The footer holds several
      fields, so it carries no `data-field` of its own; its lines do. No filled
      attribution, no footer.
    - `caption` → the `<figcaption data-field>` of the block's figure when the
      block draws exactly one figure without a caption of its own; otherwise
      `<p class="reader-caption">`.
    - `label` → `<p class="reader-label">`, the eyebrow. A label declaring
      `termWhen: { field, in }` (the one operator `visibleWhen` reads) wraps its
      text in `<dfn>` while the predicate holds: the callout label on a
      `definition`. A blank label declaring `defaultFromOption: '<enum>'`
      shows the chosen option's `copyKey` word in the deck language instead
      (a callout reads "Key insight" / "Kernpunt", as its canvas eyebrow does,
      and its hidden heading says the same); a stand-in is never a `<dfn>`.
    - `aside` → `<aside data-field>` around the paragraph(s): text that
      comments on the body beside it. A field declaring `kindKey: '<enum>'`
      names the sibling enum whose chosen option is the aside's kind: the
      option value travels as `data-kind` and its `copyKey` word opens the
      aside as a `<p class="reader-label">`, in the deck language, the same
      word the canvas eyebrow shows (`<aside data-field="asideText"
data-kind="warning"><p class="reader-label">Warning</p><p>…</p></aside>`).
    - `prose`, `list-item` and an unfilled `heading` → `<p>`.
      A field whose role gives it its own element (`quote`, `caption`, `label`,
      `attribution`, `aside`) never becomes an item's `<h3>`.
      Declared on core types: quote-slide `quote`, `authorName`, `authorTitle`
      (also in `quotes[]`), callout `label` and `source`, title-slide `meta`,
      team-cards `byline`, logo-wall `name`, cycle `centerLabel`, comparison
      `verdict`, and `asideText` (with `kindKey: 'asideVariant'`) on the shared
      aside field of content, list, image-text and image-set.
  - `image` → `<figure>` with an `alt` from the reader's own ladder (D135):
    the explicit alt (`<key>Alt`, else `alt`); else the name of what the
    picture shows — the sibling the field names with `nameKey` (logo-wall
    `name`, the quote portraits' `authorName`), else, for a picture inside an
    item, that item's heading; else `alt=""`. A caption is never the alt (it is
    the `<figcaption>`) and neither is a filename, and a slide's own heading
    does not name a picture on it. This ladder is deliberately shorter than the
    canvas's `pickAltText`, which may still fall back on a caption or guess from
    the filename so a presenter never shows an unlabelled picture: the canvas
    optimises for "something", the document for "true or nothing". A
    `decorative` role yields `alt=""` + `aria-hidden`; an item's picture reads
    the role from the object holding its field when it has none of its own, so
    an image set that is decorative as a whole hides every picture in it. The
    image's sibling `alt`/`caption`/role keys fold into the figure and are not
    repeated as paragraphs.
  - A **set of pictures** — an `items` field whose only readable sub-field is
    one `image` plus its a11y siblings (image-set, gallery), or an `images`
    URL array — is one `<figure class="reader-gallery" role="group">`: each
    picture its own `<figure>` with its own caption, and the set's caption
    (`<key>Caption`, else `caption`, beside the set) as the group's one
    `<figcaption>`. Items with more than a picture (a logo with a link, a team
    card) stay a list. An `images` array carries no alt per picture, so its
    pictures read `alt=""`; a type whose pictures need a name declares
    `items`.
  - **Publishing refuses a picture without a name** (D137): a published deck
    is this document too, so `POST /publish` (internal and v1) answers `422
missing_alt` when a drawn `image` field, at slide or item level, is not
    decorative and ends the ladder above empty — in any language version, on
    any slide a published page shows. Author markup counts too: each `<img>`
    in the sanitized tree of a `markup: true` field without an `alt`
    attribute is refused on that field, and `alt=""` is decorative (B318). The check is the projection's own
    (`imagesMissingAlt`), walked over the declarations of the deck's merged
    registry, so it covers an organisation's own types and cannot disagree
    with the document. The editor shows the refusal beside the Publish
    button, naming the slide and the field.
  - `items` → a list. The item heading is the sub-field the field names in
    `itemLabelField` (the per-item mirror of `labelField`), and otherwise the
    item's first readable string — readable meaning not `hidden`, not
    `presentational`, not a role with its own element, and not already folded
    into the item's own figure. A
    type whose first string is not its heading declares one:
    `kpi-metrics-slide` leads with `value`, so its `metrics` field names
    `label`. A declared field that is empty on one item falls back to the
    default for that item. A heading heads something: an item where nothing
    projects below that string is the `<li>`'s own text (`data-field` on the
    `<li>`), so a poll answer or a likert step is a line, not an `<h3>` over
    nothing. The list is an `<ol>` when the field declares `ordered: true`, or
    while its `orderedWhen: { field, in }` predicate holds (list-slide:
    `variant: numbers`, as the canvas numbers it); otherwise a `<ul>`.
  - A `string` field declaring `mediaRef` is a **reference to media the document
    cannot embed**, not document text, and projects as a stand-in naming the
    medium — linked when a link resolves, plain text otherwise. It names the
    medium and not the slide: the section heading directly above already
    carries the title. The declaration
    carries `label` (what to call it — "Video") and an optional `linkKey` naming
    a sibling that holds the author's own link, which wins and is then folded
    into the stand-in rather than repeated as a loose paragraph. A video slide's
    `source` accepts a URL _or_ a bare provider id, so without this the reader
    printed `<p>3045cc09-605c-…</p>`; an id is never text (D82).
  - **Pairs stay pairs** (D131). A value that belongs to a sibling says so on
    the field, the projection joins the two, and the sibling is consumed rather
    than repeated as a loose paragraph:
    - `unitKey` on a `string`: the value and its unit are one block
      (`<p data-field="value">98%</p>`, kpi-metrics), with no space added, as
      the canvas sets the two spans side by side.
    - `hrefKey` on a `string`: the string is the text of a link to a sibling
      `url` (end-slide `social1Label`, an action button's `label`). Without a
      target the pair projects nothing, as it shows nothing on the canvas, and
      a link text never heads an item.
    - `headingKey` on a `string` or `markdown` block: the named sibling is the
      `<h3 data-field>` over the block (comparison `leftTitle` over
      `leftBody`); over an empty block it is a `<p>`.
    - `duration: { secondsKey }` on a `number`: minutes plus the sibling's
      seconds, one `<p data-field><time datetime="PT1M30S">1:30</time></p>`
      (countdown). The length is resolved by `shared/slide-types/duration.js`,
      which the canvas counts down from too: each part clamped to its field's
      `min`/`max`, a blank part its default, a zero length the defaults.
    - `scale: { min, max, minLabelKey, maxLabelKey }` on the **type**: the two
      end labels are one `<dl class="reader-fields">`, each end's number the
      `<dt>` and its label the `<dd data-field>` (likert-slider). The canvas
      draws its ticks from the same declaration.
  - `url` → `<p data-field><a href>`, through `safeHref`. A slide jump
    (`#N`, or `#slide:<id>` resolved through the document's slide order) links
    to that section, `#slide-N`, with the text "Slide N" in the deck language;
    a jump to a slide the document does not hold is no link at all. `email` →
    a `mailto:` link. Declared on core types: end-slide `contactUrl`,
    `social1Url`/`social2Url` and `contactEmail`, the action buttons' `url`,
    team-cards `linkedin`, the card `link` of icon-card-grid and logo-wall.
  - Presentational field types (`enum`, `color`, `number` without `duration`,
    `boolean`), fields declaring `presentational: true` (an icon name, the
    feedback slide's input `placeholder`) and the global background/logo fields
    carry no document text and are omitted. embed-slide's `embedUrl` is a
    `mediaRef` ("Embedded page"): the reader cannot show the frame.
  - Every block the projection emits for a field carries `data-field="<key>"`
    (D132): the `<p>`, `<h3>`, `<figure>`, `<table>`, list, gallery and media
    stand-in, and the visible `<h2>` for its heading field. A `markdown` field
    may be several blocks, so it is one `<div data-field>` around them. A
    hidden heading is a name rather than a field and carries none. Classes stay
    style hooks; `data-field` is the addressable name.
  - An `enum` declaring `semantic: true` is still not text, but its value
    travels as `data-<key>` on the `<section>` (or on the item's `<li>` for an
    item field): `data-variant` on callout, list and comparison slides,
    `data-tone` on a matrix cell (D130b).
- The slide heading is a **declaration** (D129). A type marks its title with
  `role: 'heading'` on exactly one field (the field walk refuses a second).
  When the slide fills that field, it is the visible `<h2>` and is not repeated
  in the body. Otherwise the `<h2>` carries a **name** and is visually hidden
  (`class="sr-only"`, the one visually-hidden utility), so every section stays reachable by heading
  navigation and in the table of contents: the slide's `a11yTitle`, else the
  value of the type's `labelField`, else the first `h1..h3` of a `markup`
  field, else the type label. A hidden heading
  consumes nothing, so a quote named by its own text still appears in the body.
  No title is guessed from a key name: a type (or fork type) without the
  declaration always gets a hidden name.
- `a11yTitle` is a name, never a replacement title: beside a visible title it
  becomes the section's `aria-label` (instead of `aria-labelledby`), and the
  author's title stays the heading. `a11ySummary` renders as an intro
  paragraph.
- Slides are numbered by position, not text (D133): CSS counters on `<main>`
  and each section, drawn by `h2::before` with empty alternative text, so the
  number is not part of the heading's accessible name.
- A type that declares `liveOnly: true` (`follow-invite-slide`) is left out of
  the reader, like every output that outlives a live session.
- No `<script>`; a self-contained reflow-first stylesheet (single readable
  column, relative units, `max-width: 100%` media, tables scroll in place). It
  meets WCAG 1.4.10 reflow — no horizontal scrolling at 320px.

## Contract

`tests/semantic-reader.test.js` pins the document contract (one `<h1>`, an
`<h2>` per slide with matching ids + `aria-labelledby`, visible vs. hidden
headings, counters instead of number text, the landmarks, every `<img>` carries
`alt`, no script, no fixed canvas geometry).
`tests/semantic-projection.test.js` covers the field-driven projection itself,
and `tests/fixtures/semantic-projection.json` pins the whole `<section>` of every
core type.

## Not (yet) covered

The reader is currently served for published decks. A downloadable, fully
self-contained variant (images embedded as data URIs, like the canvas export)
is a follow-up.

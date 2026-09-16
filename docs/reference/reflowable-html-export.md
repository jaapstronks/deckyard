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
  wrapper: `section.deck-slide` in presenter, export and embed, and
  `section.print-slide`),
  each led by an `<h2>`. The section is emitted by `renderSlideSectionHtml` in
  the projection, not by the document wrapper, so everything the reader says
  about a slide is in one place and one fixture.
- Per-slide content is derived generically from the slide type's declared
  `fields` (see `field-types.js`), so **every** slide type — core or custom —
  projects without bespoke code and the output cannot drift from the type
  definitions:
  - `string` → `<p>`, `markdown` → semantic prose (headings, lists, blockquotes),
    `code` → `<pre><code>`, `csv` → a `<table>`.
  - `image`/`images` → `<figure>` with resolved `alt` (via `pickAltText`; a
    `decorative` `imageRole` yields `alt=""` + `aria-hidden`) and an optional
    `<figcaption>`. An image field's sibling `alt`/`caption` keys fold into the
    figure and are not repeated as paragraphs.
  - `items` → a list. The item heading is the sub-field the field names in
    `itemLabelField` (the per-item mirror of `labelField`), and otherwise the
    item's first readable string — readable meaning not `hidden`, not
    `presentational`, and not already folded into the item's own figure. A
    type whose first string is not its heading declares one:
    `kpi-metrics-slide` leads with `value`, so its `metrics` field names
    `label`. A declared field that is empty on one item falls back to the
    default for that item.
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
  - Presentational field types (`enum`, `color`, `number`, `boolean`) and the
    global background/logo fields carry no document text and are omitted.
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
  (`class="reader-sr-only"`), so every section stays reachable by heading
  navigation and in the table of contents: the slide's `a11yTitle`, else the
  value of the type's `labelField`, else the type label. A hidden heading
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

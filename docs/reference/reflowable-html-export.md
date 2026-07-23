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
  `<section aria-labelledby="slide-N-title">` per slide, each led by an `<h2>`.
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
  - `items` → a list, each item's first text field becoming an `<h3>`.
  - Presentational field types (`enum`, `color`, `number`, `boolean`) and the
    global background/logo fields carry no document text and are omitted.
- The slide heading resolves as: `a11yTitle` override → the type's `labelField`
  → common title keys (`title`, `heading`, …) → the type label. `a11ySummary`
  renders as an intro paragraph.
- No `<script>`; a self-contained reflow-first stylesheet (single readable
  column, relative units, `max-width: 100%` media, tables scroll in place). It
  meets WCAG 1.4.10 reflow — no horizontal scrolling at 320px.

## Contract

`tests/semantic-reader.test.js` pins the document contract (one `<h1>`, an
`<h2>` per slide with matching ids + `aria-labelledby`, the landmarks, every
`<img>` carries `alt`, no script, no fixed canvas geometry).
`tests/semantic-projection.test.js` covers the field-driven projection itself.

## Not (yet) covered

The reader is currently served for published decks. A downloadable, fully
self-contained variant (images embedded as data URIs, like the canvas export)
is a follow-up.

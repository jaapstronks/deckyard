# Importing a deck as editable slides

How "Import an existing deck → PowerPoint or PDF → As editable slides" turns
a PowerPoint file, a PDF the presentation app exported, or both into a deck
of editable slides: which file gives what, what is read from each page, which slide type a page becomes, when a page becomes an
image of itself instead, and where the text goes that is not on a slide.
Where this route sits next to the other creation routes:
[deck-creation-and-reuse.md](deck-creation-and-reuse.md) § Two routes.

The route is `POST /api/presentations/import/slides` (SSE), the sibling of
`import/images`: the same body (`dataUrl` for the PDF, `pptxDataUrl` for the
PowerPoint file, at least one of them; `lang`; `theme`), the same refusals
of the files, its own endpoint. No AI anywhere on this route: nothing is
interpreted, summarised or rewritten.

| Layer           | Module                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Reading the PDF | `server/utils/pdf-extract/` (`extractPdfPages`), pdf.js in Node, no browser |
| Reading a PPTX  | `server/utils/pptx-extract/` (`extractPptxPages`), the same page model      |
| Mapping a page  | `server/services/deck-slides-import.js` (`planPage`, `chooseSlide`)         |
| Fallback pixels | `server/render/pdf-to-images.js` (`pdfToImages({ pages })`), only for those |
| HTTP and SSE    | `server/routes/api/presentations/import-slides.js`                          |
| Creation view   | `client/views/list/modals/creation-view/import-pptx-pdf.js`                 |
| Report in words | `client/views/slide-import/report.js` (`slidesImportOutcome`)               |

## Two promises

- **The text is literal.** Lines on one baseline are joined in x order, the
  lines of one paragraph with a space, whitespace is normalised, a list
  item's bullet or number moves into the list's `variant`, and markdown
  markers in the source are escaped. Nothing else: no casing, no hyphens, no
  summary, no truncation.
- **A page that does not fit falls back on its own**, never the whole deck:
  it becomes an `image-slide` of the rendered page (without a PDF, its text
  on a slide, § Two sources), and the report names the page and a reason.

## The page model

`extractPdfPages()` reads every page into one model, whatever told it the
roles:

| Field        | What                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading`    | the page's heading, or null                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lines`      | every kept line with its position, size, boldness, role and `color` (`#rrggbb`, the fill colour its text was drawn in; null when unknown)                                                                                                                                                                                                                                                                                                      |
| `blocks`     | in reading order: `para`, `list` (items, `bullets`/`numbers`), `table`, `cards`, `caption`, `quote`; each with its `box` on the page (around all its lines, one em above the first baseline to a fifth of an em under the last)                                                                                                                                                                                                                |
| `images`     | embedded raster images as PNG, each with its box on the page and the `Figure` alt text                                                                                                                                                                                                                                                                                                                                                         |
| `background` | `{ color }`: the last solid fill that covers at least 80% of the page (PowerPoint paints its page colour that way), `#ffffff` when nothing covers the page (a PDF page is white where nothing is painted; Chrome prints a page without a CSS background like that), null when only a pattern or gradient without one colour covers it; a pattern painted over a solid colour (the texture on a dark Deckyard slide) does not change it         |
| `drawing`    | `paths`, the number of vector paths; `labels`, the small text inside the drawing; `tablePaths`, the paths inside a tagged table's box (its cell lines, widened by one em: borders and cell fills); `box`, the drawing's box: every path outside the body text (and outside the table, and smaller than half the page) together with the labels and the text under 0.9 × the body size that sit outside the body; null when no such path exists |
| `dropped`    | text not on the slide: `artifact` (footer, page number), `off-page`, `footnote` (< 7 pt in the bottom 15%, or higher up when smaller than the body, under the last body line, at the body's left edge, worded, on a page with reference marks), `reference` (a short number at most 0.8 × the body size, raised just above a body line)                                                                                                        |
| `tagged`     | whether the roles came from the PDF's structure tree                                                                                                                                                                                                                                                                                                                                                                                           |

Colour and boxes are data, not decisions: the mapper below reads the page
colour, the picture boxes, the block boxes and the heading lines to pick a
layout variant and a background (§ Layout and background). The drawing's
`tablePaths` and `box` are there for the next step of track 1b (a table
beside text, the cut-out of a drawing).

Two detectors fill it. A **tagged** PDF (PowerPoint and Chrome tag by
default) carries a structure tree: `H1`–`H3`, `P`, `L/LI`, `Table/TR/TH/TD`,
`Figure`, linked to the text by marked-content ids, so a heading is a
heading without guessing. An **untagged** PDF (Keynote, as far as measured)
is read by geometry: the largest top line is the heading, bullet glyphs and
`1.`/`1)` make list items. The mapper below knows only the model, so an
untagged deck is weaker input to the same path, not a second path.

A PowerPoint file is a **second source of the same model**:
`server/utils/pptx-extract/` (`extractPptxPages`) reads the package without
a browser and gives each visible slide the fields above, plus the speaker
notes beside the pages. PresentationML states what the PDF route rebuilds:
the heading is the title placeholder (a deck without placeholders, such as a
pptxgenjs one, gets it by size and position, the rule of the untagged PDF);
a paragraph with a bullet in force is a list item, whether the slide, its
layout or its master sets the bullet; a table is a table block; a picture
is converted to PNG (SVG, EMF and WMF are dropped as `unsupported-image`); a
chart or diagram frame is a drawing whatever it holds; the background is the
slide's, its layout's or its master's. Size, colour, insets and frames are
inherited the same way, colours resolved through the theme and its colour
map. Footer, slide-number and date placeholders and the text a layout or
master paints are `artifact`. Hidden slides are left out, as a PDF export
leaves them out, so page `n` of both sources is the same slide. A
paragraph is whole, so its text needs no joining; its box is an estimate
(PowerPoint does not store where it wraps).

## Two sources

Which file gives what (B829); `report.source` names the case:

| Files            | Structure (the page model) | Speaker notes       | Pixels of a fallback page or cut-out |
| ---------------- | -------------------------- | ------------------- | ------------------------------------ |
| PDF              | the PDF                    | none                | the PDF                              |
| PowerPoint       | the PowerPoint file        | the PowerPoint file | none                                 |
| PDF + PowerPoint | the PowerPoint file        | the PowerPoint file | the PDF                              |

- **Both files**: the PowerPoint file states what the PDF would have to
  rebuild, so it is read for the pages; the PDF is only rendered, for the
  pages that fall back and the pages a drawing is cut out of. Page `n` of
  both is the same slide, so the PDF's page count must equal the visible
  slides; otherwise the import is refused with both numbers (a PDF that
  kept the hidden slides does not pair).
- **A PowerPoint file alone** has no pixels. A mapped page is the same
  slide as with the PDF beside it. A page that falls back keeps its text:
  its heading and literal text as a `content-slide`, a heading alone as a
  `chapter-title-slide`; where neither holds the text (no heading, or text
  longer than the fields hold) it is an empty `image-slide` with the text
  in the notes. The report line names those pages and adds that the PDF
  export would give an image of them. A drawing is never cut out without a
  rendering.
- **A PDF alone** is read as described above (track 1a).

A picture the PowerPoint file holds as SVG, EMF or WMF does not become a
PNG: it is left out, its description goes to the notes, and the report
names its page (`unsupported-image`).

## Page → slide

The first rule that fits wins. Every candidate is checked against its type's
declared fields; a list too long for the list slide becomes a text slide,
and text longer than any field holds falls back as `too-long`.

| Page                                                               | Slide                 | Content                                                                                                            |
| ------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Page 1, at most four lines, only paragraphs                        | `title-slide`         | heading → `title`, one other line → `subheading`, a date-like line → `meta`; a picture covering ≥ 60% → background |
| Heading with at most one line under it                             | `chapter-title-slide` | `title`, `subheading`                                                                                              |
| Heading + ≥ 3 cards (a small heading with its paragraph, repeated) | `text-blocks-slide`   | one row of blocks, each `{ title, body }`                                                                          |
| Heading + lists of one kind, more items than paragraphs            | `list-slide`          | `items[].title`, a second line in an item → `text`, `variant`                                                      |
| Heading + paragraphs                                               | `content-slide`       | `title`, `body` as markdown, in order                                                                              |
| Heading + text + exactly one picture (any size)                    | `image-text-slide`    | `layout: 'split'`, image side from the picture's x position                                                        |
| Only a picture (with at most a caption)                            | `image-slide`         | `image`, `caption`, `alt`; edge to edge when it covers ≥ 90%                                                       |
| Heading + a tagged table, ≤ 10 columns and ≤ 40 rows               | `table-slide`         | `rows[].c1…cN`, `headerRow` when the first row is `TH`                                                             |
| No heading, ≤ 3 large lines, or a quote                            | `chapter-title-slide` | the text as `title`/`subheading` (`quote-slide` asks for an author a PDF does not reliably name)                   |
| Anything else                                                      | fallback              | see below                                                                                                          |

The new deck takes the theme and language chosen in the creation view. The
source's fonts and colours are not carried over; where a type offers a
choice the page already made, the slide makes it too (below).

## Layout and background

Only options the types already declare, never a free colour or a font; a
slide that would fail `validateSlideFields` is no slide. The thresholds are
constants in `server/services/deck-slides-import.js`, with what they were
measured on.

| From the page                                                                                                  | On the slide                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The picture's share of the page width beside text                                                              | `image-text-slide` `imageWidth`: the nearest of `narrow` (37%), `half` (50%), `wide` (63%)                                     |
| A picture at most 30% wide and 45% high, its top and outer side within 12% of a page corner                    | `image-text-slide` `layout: 'corner'`                                                                                          |
| Block boxes split by a gutter into a left and a right column that overlap in height, read left column first    | `content-slide` / `list-slide` `layout: 'two-column'`; three blocks in a row or labels read after their values stay one column |
| The middle of the heading lines in the top or bottom third of the page                                         | `chapter-title-slide` `layout: 'top'` / `'bottom'` (`center` between)                                                          |
| Every heading line centred on the page and set at least 15% in                                                 | `titleBlockAlign` (section title) / `headerAlign` (list, text blocks) `center`                                                 |
| A dark page colour (white text reads better on it)                                                             | `background`: the theme's first own variant with a dark ground; the type's default when the theme has none                     |
| A light page colour with a channel under `0xf0`                                                                | `background: 'mist'`                                                                                                           |
| White, no colour, or a picture covering ≥ 90% of the page (the extractor reads white under a full-bleed photo) | the type's default                                                                                                             |

The background goes only to a type that declares the field: the section
title has none.

## Mixed pages

A page with a heading, text and a vector drawing (a chart, a diagram) is
the most common page a slide type cannot hold as such. Three rules decide
what it becomes (B831); the thresholds are constants in
`deck-slides-import.js` with what they were measured on:

- **A tagged table is no drawing.** Its borders and cell fills are paths
  too; the drawing threshold of 60 paths counts `paths − tablePaths` (the
  paths inside the table's box, `drawing.tablePaths` in the page model). A
  tagged table beside text under that threshold becomes a `content-slide`
  with the table as a pipe table in its body. A page that holds only the
  table was already a `table-slide`.
- **A drawing that stands apart from the text is cut out.** When the
  page has a heading and no picture of its own, the drawing's box
  (`drawing.box`) covers 8–75% of the page, neither the heading, a body
  line nor a table cell reaches into it, at least one block stands outside
  it and no block straddles its edge, the page becomes an
  `image-text-slide`: the text outside the box as the body, literally, and
  the box cut out of the rendered page as the picture
  (`page-NNN-drawing.png`, `alt` = the heading), on the side away from the
  text. Small paragraphs inside the box are the drawing's labels: they are
  in the picture and go to the notes under "Not on the slide:". The cut
  stops above the footer band (the bottom 15% of the page) when a footer,
  footnote or page number reaches into the box, so a logo beside the
  footer stays out. Measured on Philips Q4 2024, two of the seventeen
  drawing pages qualify (p13, p24); every other drawing page keeps the
  `drawing` fallback, because no cut could avoid losing or repeating text.
- **Only with pixels to cut from.** The cut-out needs a rendering of the
  page: the PDF is rendered for the pages that fall back and the pages a
  drawing is cut out of. A source without a rendering (a PowerPoint file
  alone, B829) passes `pagePixels: false` and keeps such a page as a
  `drawing` fallback; a page the rasteriser skipped falls back the same
  way, with `not-rendered` in the report.

**Decoration.** Before any page is mapped, a picture with the same pixels
(PNG hash) in the same place (within 2 pt) on three pages or more, covering
at most 3% of each, is left out of every page: a logo in a corner would
otherwise turn each page into a picture beside text. The report names it
once (`decorations`). The bound comes from the measurement: the repeated
pictures in both measured decks (one photo at 50%, five at 14%) are content
and stay.

## The six fallback reasons

A closed set, `FALLBACK_REASONS` in `deck-slides-import.js`. The creation
view names each one in its report line; a test pins that every reason the
server names has its own words.

| Reason           | When                                                                                                                                                                                           | In the report (en / nl)                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `no-text`        | no text to edit: a drawing, or nothing                                                                                                                                                         | no text / geen tekst                                       |
| `drawing`        | a heading and text beside a vector drawing of more than 60 paths, a tagged table's own paths not counted, that cannot be cut out (§ Mixed pages); a page holding only a tagged table is exempt | chart / grafiek                                            |
| `table-untagged` | a table found by geometry only, whose cells would be a guess                                                                                                                                   | table / tabel                                              |
| `multi-image`    | more than one picture (beside text, or alone)                                                                                                                                                  | several images / meerdere beelden                          |
| `no-heading`     | text without a heading that is no section title either                                                                                                                                         | no heading / geen kop                                      |
| `too-long`       | the literal text fits no field (a heading over its limit, a table over 10 columns or 40 rows); cutting it would break the first promise                                                        | too much text for one slide / te veel tekst voor één slide |

Only the fallback pages and the pages a drawing is cut out of are rendered
(in the browser-backed rasteriser), so a deck without either never starts
a browser.

## Notes

Every slide's notes are built in one order, parts separated by a blank line:

1. the speaker notes of the PowerPoint file, slide by slide (beside a PDF,
   a page count that does not pair is refused);
2. on a fallback slide only, the page's text, so it can still be copied;
3. under "Not on the slide:" ("Niet op de slide:" in a Dutch deck), the text
   the slide does not show: dropped footers, page numbers and footnotes, and
   on a mapped slide the labels of a drawing (and on a cut-out the small
   paragraphs inside it). Reference marks are left out:
   without their footnote's text beside them they say nothing.

The AI route reads a PDF through the same model (`readPdf()` in
`server/utils/convert-file/pdf-reader.js`, B772), so footnotes and reference
marks stay out of the generation source too. It tells two shapes apart by
the page form (B773, `pdfShape()`):

- **Slides** (most pages landscape, the median page under
  `SLIDE_MAX_CHARS` characters): per page the heading, the blocks and the
  drawing labels (`pageText()`), framed as `--- SLIDE n ---`. Artifact text
  that occurs only on the first page goes along with page 1.
- **Document** (everything else): the whole PDF as one marked-up text
  (`readDocument()` in `server/utils/pdf-extract/document.js`, also as
  `extractPdfDocument()`), formatted by `formatDocumentForAi()` without
  slide framing. Headings are ranked over the whole document: a short
  paragraph larger than the body (`HEADING_SIZE_RATIO`), or bold where the
  body is not, is a heading; each recurring heading size is a level (`##`,
  `###`, …) and a size used once takes the level of the nearest recurring
  size below it. What the first page opens with above every recurring
  heading size is the `#` title. Margin text at body size that recurs on
  more than one page (digits aside) is dropped as furniture; a paragraph
  without closing punctuation runs on over the page break; a table becomes a
  pipe table when its rows have one shape and it reads as data, otherwise a
  row per line. Of the first page's unique artifact text only a letter's
  heading block stays: the lines in the body column at body size right
  above the running text ("Datum …", "Betreft …"), not the address column.

The generation suite reads its PDF cases with the same `readPdf()`
(`test-suite/scripts/fetch-cases.js`), so `npm run ai-suite:fetch --
--reparse` remakes the `.txt` sources after a reader change.

## The report

The `complete` event carries `presentation` and `report`, in the names the
generation route uses:

```json
{
  "source": "both",
  "slidesExtracted": 12,
  "slidesConverted": 9,
  "errors": [{ "page": 4, "code": "upload-failed" }],
  "pages": [
    { "page": 5, "type": "image-slide", "reason": "drawing", "dropped": 2 }
  ],
  "decorations": [{ "pages": [1, 2, 3] }]
}
```

The creation view reads it with `slidesImportOutcome()`. Every page editable
and nothing failed: the deck opens with a confirmation ("All 12 pages were
imported as editable slides."). Otherwise the sub-tab shows one line, "3 of
12 pages were taken over as images: 5 (chart), 7 (table), 9 (no text).", a
sentence per missing picture, and an "Open presentation" button. An entry in
`errors` carries a `code` from the closed set `REPORT_ERROR_CODES`
(`upload-failed`: the media library refused the picture; `not-rendered`: a
page that fell back got no image from the rasteriser; `unsupported-image`: a
picture of the PowerPoint file in SVG, EMF or WMF was left out) and the
client puts it into words in the deck's language ("Page 4: an image could
not be uploaded"); the server sends no sentence of its own. The slide keeps
an empty image either way. From a PowerPoint file alone (`source: 'pptx'`)
the line names the same pages and reasons without calling them images,
and one sentence follows it: "Their text is kept; add the PDF export for an
image of these pages." Pictures left out as
decoration add one sentence after those ("A picture repeated on 3 pages (a
logo or mark) was left out."), and an import with one is not clean, so the
sub-tab shows it.

## Not on this route

Inserting editable slides into an open deck (B307), OCR of text inside
images, form content and annotations.

# Importing a deck as editable slides

How "Import an existing deck → PowerPoint or PDF → As editable slides" turns
a PDF the presentation app exported into a deck of editable slides: what is
read from each page, which slide type a page becomes, when a page becomes an
image of itself instead, and where the text goes that is not on a slide.
Where this route sits next to the other creation routes:
[deck-creation-and-reuse.md](deck-creation-and-reuse.md) § Two routes.

The route is `POST /api/presentations/import/slides` (SSE), the sibling of
`import/images`: the same body (`dataUrl` for the PDF, required here;
`pptxDataUrl` for the speaker notes; `lang`; `theme`), the same refusals of
the files, its own endpoint. No AI anywhere on this route: nothing is
interpreted, summarised or rewritten.

| Layer           | Module                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Reading the PDF | `server/utils/pdf-extract/` (`extractPdfPages`), pdf.js in Node, no browser |
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
  it becomes an `image-slide` of the rendered page, and the report names the
  page and a reason.

## The page model

`extractPdfPages()` reads every page into one model, whatever told it the
roles:

| Field     | What                                                                                                                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading` | the page's heading, or null                                                                                                                                                                                                                                                                                                             |
| `blocks`  | in reading order: `para`, `list` (items, `bullets`/`numbers`), `table`, `cards`, `caption`, `quote`                                                                                                                                                                                                                                     |
| `images`  | embedded raster images as PNG, each with its box on the page and the `Figure` alt text                                                                                                                                                                                                                                                  |
| `drawing` | the number of vector paths and the small text labels inside the drawing                                                                                                                                                                                                                                                                 |
| `dropped` | text not on the slide: `artifact` (footer, page number), `off-page`, `footnote` (< 7 pt in the bottom 15%, or higher up when smaller than the body, under the last body line, at the body's left edge, worded, on a page with reference marks), `reference` (a short number at most 0.8 × the body size, raised just above a body line) |
| `tagged`  | whether the roles came from the PDF's structure tree                                                                                                                                                                                                                                                                                    |

Two detectors fill it. A **tagged** PDF (PowerPoint and Chrome tag by
default) carries a structure tree: `H1`–`H3`, `P`, `L/LI`, `Table/TR/TH/TD`,
`Figure`, linked to the text by marked-content ids, so a heading is a
heading without guessing. An **untagged** PDF (Keynote, as far as measured)
is read by geometry: the largest top line is the heading, bullet glyphs and
`1.`/`1)` make list items. The mapper below knows only the model, so an
untagged deck is weaker input to the same path, not a second path.

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
source's colours, layout variants and fonts are not carried over yet.

## The six fallback reasons

A closed set, `FALLBACK_REASONS` in `deck-slides-import.js`. The creation
view names each one in its report line; a test pins that every reason the
server names has its own words.

| Reason           | When                                                                                                                                    | In the report (en / nl)                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `no-text`        | no text to edit: a drawing, or nothing                                                                                                  | no text / geen tekst                                       |
| `drawing`        | a heading and text beside a vector drawing of more than 60 paths (a chart, a diagram); a page holding only a tagged table is exempt     | chart / grafiek                                            |
| `table-untagged` | a table found by geometry only, whose cells would be a guess                                                                            | table / tabel                                              |
| `multi-image`    | more than one picture (beside text, or alone)                                                                                           | several images / meerdere beelden                          |
| `no-heading`     | text without a heading that is no section title either                                                                                  | no heading / geen kop                                      |
| `too-long`       | the literal text fits no field (a heading over its limit, a table over 10 columns or 40 rows); cutting it would break the first promise | too much text for one slide / te veel tekst voor één slide |

Only the fallback pages are rendered (in the browser-backed rasteriser), so
an all-editable deck never starts a browser.

## Notes

Every slide's notes are built in one order, parts separated by a blank line:

1. the speaker notes of the PowerPoint file beside the PDF, paired by slide
   order (as in the import as images; a page count that does not pair is
   refused);
2. on a fallback slide only, the page's text, so it can still be copied;
3. under "Not on the slide:" ("Niet op de slide:" in a Dutch deck), the text
   the slide does not show: dropped footers, page numbers and footnotes, and
   on a mapped slide the labels of a drawing. Reference marks are left out:
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
  "slidesExtracted": 12,
  "slidesConverted": 9,
  "errors": [{ "page": 4, "code": "upload-failed" }],
  "pages": [
    { "page": 5, "type": "image-slide", "reason": "drawing", "dropped": 2 }
  ]
}
```

The creation view reads it with `slidesImportOutcome()`. Every page editable
and nothing failed: the deck opens with a confirmation ("All 12 pages were
imported as editable slides."). Otherwise the sub-tab shows one line, "3 of
12 pages were taken over as images: 5 (chart), 7 (table), 9 (no text).", a
sentence per missing picture, and an "Open presentation" button. An entry in
`errors` carries a `code` from the closed set `REPORT_ERROR_CODES`
(`upload-failed`: the media library refused the picture; `not-rendered`: a
page that fell back got no image from the rasteriser) and the client puts it
into words in the deck's language ("Page 4: an image could not be
uploaded"); the server sends no sentence of its own. The slide keeps an empty
image either way.

## Not on this route

PowerPoint as the source of editable slides, the source's colours and layout
variants, cutting a drawing out as a picture for mixed pages, inserting
editable slides into an open deck (B307), OCR of text inside images, form
content and annotations.

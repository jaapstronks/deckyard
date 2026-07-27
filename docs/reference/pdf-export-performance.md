# PDF export: what makes a deck heavy, and how to measure it

What actually drives the size and the viewer-side render cost of a server-rendered
PDF export, and how to measure it without guessing. Measured on a real 80-slide
deck in July 2026; the numbers below are that deck on an Apple-silicon Mac, so
treat them as ratios, not absolutes.

## The one thing that matters: image compression must stay wired in

`server/export/image-compress.js` downsamples every embedded raster to
`PDF_EXPORT_IMAGE_MAX_PX` (default 2600) and re-encodes it (JPEG when opaque, PNG
when transparency must survive). Without it, `toDataUrlIfLocal` inlines each image
at its original resolution.

The difference is not marginal:

| 80-slide deck, PDFKit @2× | without compression | with compression |
|---|---|---|
| file size | 328,7 MB | 28,6 MB |
| first page visible | 502 ms | 45 ms |
| scroll all pages | 91,6 s | 1,71 s |
| median per page | 1364 ms | 9,3 ms |

The transform is threaded into `buildSlidesPdfHtml` **by hand, at two call sites**
— the slide-field embed pass and the rendered `<img src>` pass. Dropping either
argument leaves every unit test green while full-resolution originals return to
the PDF. `tests/export-pdf-image-compression-wired.test.js` guards that seam;
`tests/pdf-image-compression.test.js` covers the transform itself.

## What does *not* cost render time

Measured, so nobody re-litigates these:

- **Gradient layers at `opacity: 0`.** The export sets `--t-gradient-enabled: 0`,
  which leaves `.slide-chapter-title::before`, `.slide-quote::before` and
  `.slide-icon-card-grid::before/::after` present but invisible. Replacing that
  with `display: none` changes render time by nothing — Skia discards a layer at
  alpha 0 rather than compositing it.
- **Type 3 fonts.** A macOS export embeds ~22 Type 3 font entries, because
  `stripFontFacesFromCss` removes Inter's `@font-face` while `--ps-font-sans`
  still names `system-ui`/`-apple-system`, so text falls through to the variable
  system font that Skia can only emit as Type 3. Ugly, and it leaks app-chrome
  tokens into slide rendering, but it costs no measurable render time.
- **Lowering `PDF_EXPORT_IMAGE_MAX_PX` below the default.** It buys bytes
  (2600 → 1600 halves the file) but not speed, and it is not monotonic: pages
  with a full-bleed background photo get *slower* at 1100 px because the viewer
  has to upscale.

## Measuring

**Pick the engine your readers use.** Poppler and PDFKit disagree by a factor of
~25 on the same file and rank the causes differently — a deck that looks slow
under `pdftoppm` can be perfectly smooth in Preview.app.

Inventory (no re-export needed, works on any PDF):

```sh
pdfinfo  deck.pdf                  # pages, producer, page size
pdffonts deck.pdf                  # embedded/subset fonts; watch for "Type 3"
pdfimages -list deck.pdf           # per image: dimensions, encoding, ppi, stream size
```

In `pdfimages -list`, two columns carry the diagnosis: **`enc`** (`image` means
Flate-stored raw pixels, not JPEG) and **`x-ppi`** (effective resolution at
display size — anything far above ~200 is decode cost you are not seeing).

Render timing per page, in the macOS viewer engine, via a short Swift program
using `PDFDocument` + `page.thumbnail(of:for:)`: time the document open, the
first page separately, then every page, and report median/p90. Timing one page
per process invocation re-parses the whole file each time and swamps the signal —
render all pages in one process.

## Knobs

| Env var | Default | Effect |
|---|---|---|
| `PDF_EXPORT_IMAGE_COMPRESSION` | on | `0`/`off`/`false`/`no` disables the transform entirely |
| `PDF_EXPORT_IMAGE_MAX_PX` | 2600 | Longest edge cap; `0` disables |
| `PDF_EXPORT_IMAGE_QUALITY` | 80 | JPEG quality (mozjpeg) |
| `PDF_EXPORT_TIMEOUT_MS` | 120000 | Puppeteer `setContent` + `pdf` cap; `0` disables |

## Known open edge

`--t-gradient-enabled: 0` gates only the *generated* theme gradient from
`shared/theme-normalize.js`. A theme that ships its background through
`slideBackgrounds` (`shared/theme-slide-backgrounds.js`) sets a gradient straight
onto `--t-slide-bg-<id>`, which the gate never sees. No measured cost so far, but
it is an inconsistency: two ways to deliver a background, one export gate.

## See also

- [`video-slide-pdf-export.md`](video-slide-pdf-export.md) — video slides become a
  static "watch online" placeholder in PDF
- [`theme-slide-backgrounds.md`](theme-slide-backgrounds.md) — theme-defined
  background variants

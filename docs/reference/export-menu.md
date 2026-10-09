# Editor export menu

The editor topbar's **Export** button opens a single grouped modal
(`client/views/editor/export-modal.js`) rather than a flat dropdown. Each row
is a colour-coded icon, a format name, a one-line description, and an action
button. A single language toggle at the top drives every export URL.

This replaced an older flat dropdown whose labels were the whole story: three
overlapping PDF entries and a duplicated "other language" section.

## Layout

| Group         | Format                  | Route (`/api/presentations/:id/export/…`) | Builder                                                                         |
| ------------- | ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Slides        | PDF                     | `pdf-slides.pdf`                          | `renderSlidesToPdfBuffer` (`server/render/pdf.js`, Puppeteer)                   |
| Slides        | PNG                     | `png`                                     | `buildSlidesPngExportHtml` (opens in a tab)                                     |
| Slides        | PowerPoint              | `pptx`                                    | `buildPptxBuffer` (each slide an image, [see below](#what-the-pptx-hands-back)) |
| Slides        | PowerPoint, editable    | `pptx-editable`                           | `buildEditablePptxBuffer` ([see below](#what-the-editable-pptx-hands-back))     |
| Slides        | PPTX template           | `pptx-template`                           | `buildThemeTemplateBuffer` (download)                                           |
| Slides        | HTML                    | `html`                                    | `buildStandaloneHtml` (download)                                                |
| Documents     | Text handout            | `pdf`                                     | `buildPrintHtml` (the reader projection, laid out for paper)                    |
| Documents     | Notes (Markdown / Word) | `notes.md` / `notes.docx`                 | `buildNotesMarkdown` / `buildNotesDocxBuffer`                                   |
| Data & bundle | .deck                   | `deck.zip`                                | `buildDeckBundle` (download)                                                    |
| Data & bundle | JSON                    | `json`                                    | `presentationToDeck` (download)                                                 |
| Data & bundle | Handoff ZIP             | `handoff.zip`                             | `buildHandoffZipBuffer`                                                         |

The full server-side pipeline (routes, async queue, builders) is in
`server/routes/api/export.js` and `server/export/`.

## Direct export routes (no menu row)

`server/routes/api/export.js` registers two more export routes that the modal
does **not** surface — they are reachable by URL but have no button. Documented
here so the route inventory is complete, not because they are user-facing today.

| Format           | Route (`/api/presentations/:id/export/…`) | Builder                                                                                                     |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PNG ZIP          | `png.zip`                                 | `buildSlidesPngZipBuffer` (`server/export/png-zip.js`) — every slide as PNG in one ZIP; `?scale=` supported |
| Single-slide PNG | `png/:n.png` (1-based)                    | `renderSlideToPngBuffer` (`server/render/png.js`) — one slide as PNG; `?scale=` supported                   |

Implementation status: the routes are live and covered by the export pipeline.
Whether the PNG-ZIP earns a menu row is an open product question, not a
promise — treat these URLs as internal until the modal exposes them.

## The single PDF entry

There is one **PDF** row, not two. It downloads the deterministic
server-rendered PDF, and only reveals a **Print in browser** fallback when that
render fails or times out.

- Clicking **Export** fetches `pdf-slides.pdf?sync=1`. `?sync=1` forces the
  synchronous render path, so the response is the PDF bytes (or an error)
  rather than a `202` job hand-off that would need polling. The blob is saved
  with the filename from the `Content-Disposition` header.
- A client-side timeout (`PDF_FETCH_TIMEOUT_MS`, 90s; the server's own cap is
  `EXPORT_RENDER_TIMEOUT_MS`, 120s) aborts a stuck render.
- On error or timeout, an inline fallback appears under the PDF row: a short
  message plus a button that opens the browser-print page (`pdf-slides`, the
  same 16:9 slide HTML) in a new tab, where the user does Cmd/Ctrl-P → Save as
  PDF.

The old menu exposed the server render and the browser-print page as two
co-equal items ("PDF" and "PDF (print in browser)"), which conflated _which
renderer runs_ (an implementation detail) with a genuine user choice. The
genuinely distinct artifact is the **Text handout** (document layout), which
stays its own row under Documents.

The handout is not a reader of its own. Each slide is the section the reader
projects (`renderSlideSectionHtml` in `shared/slide-types/semantic-projection.js`),
with the same heading, body and `data-slide-type` marker; `buildPrintHtml`
owns only the document shell, the print toolbar and the paper stylesheet, and
numbers slides with a CSS counter rather than text in the heading.
Whatever the projection says about a slide type, the handout says too. See
[`reflowable-html-export.md`](./reflowable-html-export.md).

## Two PowerPoint rows

PowerPoint has two rows because there are two intents, and neither is the default (D141): a file to show or to drop into someone else's presentation, and a file to keep working in. Each row's description is its promise.

| Row                  | Promise (the row's description)                        | Route                  |
| -------------------- | ------------------------------------------------------ | ---------------------- |
| PowerPoint           | Pixel-perfect: every slide as an image, videos play    | `export/pptx`          |
| PowerPoint, editable | Text and pictures you can edit, on the theme's layouts | `export/pptx-editable` |

The pixel-perfect row opens the file in a tab, like the other downloads. The editable row fetches it (`?sync=1`), saves it, and then says which slides became pictures, as an `info` toast built from the `X-Image-Slides` response header (`IMAGE_SLIDES_HEADER` in `shared/export-headers.js`): "Slides 3, 7 are images: their type has no editable form yet." No toast when every slide is editable. The v1 API offers the same two routes (`exportPresentationPptx`, `exportPresentationPptxEditable`) and sends the same header on the editable one.

The editor says it before the export too. The inspector of a slide whose type the editable export photographs ends with "In the editable PowerPoint, this slide is an image." The hint reads the type's `fidelity` facet off the `/api/slide-types` response, resolved per target (`resolvedFidelities()` in `shared/slide-types/fidelity.js`), through the predicate the export dispatches on (`needsNativeComposition()`), never a type name. A fork type's declaration is therefore heard, and a database type is served the `raster` the export uses.

## What the PPTX hands back

Every slide but video travels as one picture, so nothing in the exported file is editable; video plays (D307: a video as a still is a loss, not a faithful copy). Which branch a slide takes is the type's own `fidelity.pptx` declaration rather than a name the export recognises — see [`slide-type-fidelity.md`](./slide-type-fidelity.md). The handoff ZIP carries this file.

## What the editable PPTX hands back

`export/pptx-editable` is the second PPTX intent (D141): the deck on the theme's three layouts, as text and pictures PowerPoint can edit, as far as each type allows.

Each slide goes the way its type's `fidelity.pptx` says. A type with a native composition of its own (`video-slide`, `image-slide`, `image-text-slide`, `quote-slide`, `chapter-title-slide`, `kpi-metrics-slide`, `chart-slide`, `callout-slide`, `comparison-slide`) uses it; a type that declares `native` or `mixed` without one goes through **layer 0** (`server/export/pptx-generic.js`); a `raster` type travels as its image, exactly as in the pixel-perfect file, named by its heading as alt text. The builder returns the numbers of those image slides (`imageSlides`), the route sends them as `X-Image-Slides` and the server log records them, so "editable" says where it is pictures. A queued export (no `?sync=1`, a queue running) answers `202` and carries no header; the editor always asks synchronously. Which types declare what follows Jaap's judgement at gate A2.8: title, content, list, table, text-blocks and end are `native` on layer 0 (B587, D306); image, image-text, quote, chapter-title, kpi-metrics, chart, callout and comparison are `native` through their own mappers (B588); the live types, the picture sets and the diagrams stay `raster`.

Layer 0 reads the slide's semantic projection, the same one the reader and the handout print, and places what it says onto a layout without any per-type code: the heading into the title placeholder, paragraphs and lists into the body placeholder (one paragraph per list item, label and value on soft-broken lines, a bullet glyph per level, numbered lists numbered explicitly), a table as a real table with its header row marked, pictures fitted to their own ratio with their alt text. A slide that is a heading and at most two short lines takes the title layout, pictures beside text the image layout, everything else heading and body. The library leaves three things to the caller, and layer 0 does them: a line budget (there is no working autofit, so the body size shrinks from the theme's `lg` step to 10pt until the estimate fits, and an overflow is reported), the picture frames (pptxgenjs never reads a picture's size), and `firstRow` on a table (patched into the written package). A slide whose projection holds nothing visible stays an empty layout and is reported.

The image slide has its own mapper (`server/export/pptx-image-slide.js`), because layer 0 placed its picture too small and in the wrong place (gate A2.8). It reads the slide's own image axes through the type's one resolution: without bleed the picture fills the padded column between the heading and the bottom subheading, with bleed it fills the slide. `contain` fits a frame of the picture's ratio into that box, placed by the focus point; `cover` fills it with a PowerPoint crop that keeps the focus point in view, so "Crop" in PowerPoint shows the rest of the picture. The title goes in the layout's title placeholder; on a bleed slide the heading, bottom subheading and caption sit on the canvas' dark scrim over the picture instead. A decorative picture is marked decorative in the package, so a screen reader skips it.

The image-text slide has its own mapper too (`server/export/pptx-image-text-slide.js`), because layer 0 put it on the generic heading-image-body layout while the canvas runs the picture edge to edge in its own column. The mapper follows the canvas grid: the picture fills the full slide height on the side `imageSide` names, at 37, 50 or 63 per cent of the width (`imageWidth`), or in the top 58 per cent of a 45 per cent column for the corner layout. `cover` crops as on the image slide; `contain` fits the picture inside the column's padding on a white plate (none with `imageBackground: match`). The heading and the body, read from the semantic projection like layer 0, sit in the other column, balanced on its middle (the corner layout keeps them at the top). The heading is the slide's title placeholder at that position: the package pass turns the text box named `Slide title` into the placeholder, since pptxgenjs copies a placeholder's position from the layout. The caption is the image slide's chip; alt text comes from `imageTextAltText`, the same answer the canvas `<img alt>` reads.

`?compose=generic` sends every slide through layer 0, whatever it declares. It is not a user choice but the comparison gate A2.8 is judged on (D141 (c)); any other value is refused.

Pictures are fetched the way the other exports fetch them: local assets from disk, remote `http(s)` through the SSRF guard, which does not follow redirects. A picture that cannot travel is replaced by its alt text in a dashed frame, and reported.

## What the theme template hands back

The **PPTX template** row downloads a `.pptx` built from the deck's theme (`server/export/pptx-theme.js`): its three layouts, and one sample slide on each. Its promise is deliberately the smaller one: ground, fonts, text colours and logo come from the theme and are applied per slide; it is not a master that restyles an existing deck. That wording is the promise, not a hedge — see D106 in `docs/plans/done/decisions.md` for the decision and the measurement behind it.

The reason is the library. pptxgenjs 4.0.1's `defineSlideMaster` does not write an OOXML master at all; it writes a _layout_, and a placeholder's options are copied into the run properties of every slide built on it rather than inherited from it. Editing the layout afterwards therefore moves nothing that already exists — precisely the handling most people mean by "template". A genuinely restyling template means writing `slideMaster1.xml` by hand alongside pptxgenjs, and is its own piece of work. The word "master" belongs in this file only where it names the layout.

Three consequences are visible in the output, and each is pinned by `tests/export-pptx-theme-master.test.js`:

- **Every placeholder names its own colour.** There is no theme text colour in OOXML: `pptx.theme` carries font faces and nothing else, and a run that names no colour is written as hard-coded black — invisible on a dark ground. Any later layer that writes runs onto these layouts must do the same.
- **The logo travels as a raster.** pptxgenjs writes an SVG twice: behind the modern `asvg:svgBlip` extension, and as a "PNG" fallback that is the same SVG bytes under a `.png` name. PowerPoint takes the first; everything else draws a broken-image box. The mark is rendered to real PNG bytes here, sized to its own aspect ratio, or left out entirely.
- **The ground is read, not assumed.** It is the theme's `defaultBackground` when it declares one and the `lime` slot otherwise, resolved through `resolveSlideBgHex` — the same reader the slide surface uses, because `lime` is near-black under `midnight` and white under `deckyard`.

The three layouts are `Title`, `Heading and body` and `Heading, image and body` (`PPTX_LAYOUTS`). Their boxes and type sizes are expressed in the slide's own 1600x900 reference pixels and converted once, so they sit where the theme's padding and type scale put them; `--t-slide-text-scale` is honoured like any other theme value. Two things in the file are the library's, not the theme's: PowerPoint's layout gallery also lists pptxgenjs' own blank `DEFAULT` layout, which the writer always emits first; and the image slot of the third layout is an untyped content placeholder rather than a picture placeholder, because pptxgenjs 4.0.1 never writes `type="pic"` (it maps `image` to `pic` and then looks `pic` up again). PowerPoint offers such a slot for a picture as readily as for text, and a later layer addresses it by name (`image`), so nothing is lost, but the box is not picture-only.

The file opens on its sample slides, one per layout, in the layouts' own order: the theme's name on `Title`, then a slide that says what each layout is for, with a dashed frame where the picture goes on the third. That is not decoration but the only way the layouts are visible on opening. A package of layouts with no slides in it opens on nothing of its own: PowerPoint shows the first layout, but Keynote adds a slide on a black `Default` layout it writes itself, so the first impression is an empty black rectangle and the theme's layouts stay hidden until you insert a slide (B637; D126 had already measured the `Default` Keynote adds). Before and after in Keynote: `docs/reports/b637-theme-template/README.md`.

The sample copy is English and not translated, for the reason the layout names are not: each line names the layout it sits on. Its sizes ride in the runs rather than on the text box, because pptxgenjs takes a box addressed by `placeholder` from the layout and drops the options given beside it — the same reason the editable export carries its sizes per run. The word in the picture slot goes in the placeholder itself rather than in a box over it: pptxgenjs writes every placeholder a slide leaves empty onto that slide, and PowerPoint fills such a one with its own "Click to add text" and insert icons, which a second box over the same rectangle runs straight through.

The pixel-perfect PPTX does not use these layouts; the editable one puts each slide's content onto them ([see above](#what-the-editable-pptx-hands-back)).

## Speaker notes in the PPTX

The PPTX carries every slide's speaker notes as PowerPoint notes, in the notes
part that belongs to that slide (`addSpeakerNotes` in `server/export/pptx.js`,
one call site for both the raster and the video branch). `slides[].notes` is already
resolved to the exported language version — the language projection swaps the
whole `slides` array — so a translated export carries that version's notes with
no second path.

A slide with no notes, or notes that are only whitespace, gets no note text.
pptxgenjs writes a notes part for every slide regardless, to keep the
relationship numbering intact; the part simply stays empty, which PowerPoint
shows as an empty notes pane.

The document author (`docProps/core.xml`) is `APP_NAME`
(`server/config/branding.js`), so a white-label deployment ships decks under its
own name.

The Documents group's separate **Notes** rows stay: `notes.md` / `notes.docx`
are the standalone handout, not a substitute for notes inside the deck.

## Language

`export-modal.js` reads `pres.i18n.active` for the default language. When the
deck carries more than one language version (`existingVersionLangs`), a
segmented control appears with one segment per version — the active language
first — and its value is appended as `?lang=` to every export URL except the
two that carry every language version themselves: `.deck` and JSON
(`allLanguages` on the format, D89). Their routes ignore `?lang=`, so the menu
does not send it. Single-
language decks show no control. This replaces the dropdown's second, duplicated
"Export ({other lang})" section, and before B182 fase 2 it offered exactly two
segments, so a deck with `nl`, `de` and `fr` could be exported in two of them.

## i18n

Strings live under `editor.export.*` in `client/i18n/<locale>/editor.json`
(group titles, per-format descriptions, the PDF busy/fallback copy, the
language label). Format acronyms (PDF, PNG, PPTX, HTML, JSON, .deck) are hard-coded.
Non-nl/en locales fall back to the English defaults passed to `t()`.

## See also

- `docs/reference/standalone-html-export.md` — the HTML export builder.
- `docs/reference/video-slide-pdf-export.md` — video-slide placeholders in the PDF.
- `docs/reference/bulk-export.md` — the separate account-backup ZIP (Settings → Data Export), unrelated to this menu.

The editable quote mapper keeps the theme's dark ground, quote and attribution text, and circular author portraits. Single quotes support left or centered alignment; up to three quotes alternate left/right as on the canvas. Its type sizes follow the canvas steps and shared quote scale. The first quote is the PowerPoint title placeholder. The animated gradient is omitted; typography and spacing remain best effort. Missing portraits retain their alt text and produce a warning.

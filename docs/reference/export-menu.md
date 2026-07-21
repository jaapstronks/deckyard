# Editor export menu

The editor topbar's **Export** button opens a single grouped modal
(`client/views/editor/export-modal.js`) rather than a flat dropdown. Each row
is a colour-coded icon, a format name, a one-line description, and an action
button. A single language toggle at the top drives every export URL.

This replaced an older flat dropdown whose labels were the whole story: three
overlapping PDF entries and a duplicated "other language" section.

## Layout

| Group | Format | Route (`/api/presentations/:id/export/…`) | Builder |
|-------|--------|--------------------------------------------|---------|
| Slides | PDF | `pdf-slides.pdf` | `renderSlidesToPdfBuffer` (`server/render/pdf.js`, Puppeteer) |
| Slides | PNG | `png` | `buildSlidesPngExportHtml` (opens in a tab) |
| Slides | PPTX | `pptx` | `buildPptxBuffer` |
| Slides | HTML | `html` | `buildStandaloneHtml` (download) |
| Documents | Text handout | `pdf` | `buildPrintHtml` (document layout, not slides) |
| Documents | Notes (Markdown / Word) | `notes.md` / `notes.docx` | `buildNotesMarkdown` / `buildNotesDocxBuffer` |
| Data & bundle | JSON | `json` | `presentationToDeck` (download) |
| Data & bundle | Handoff ZIP | `handoff.zip` | `buildHandoffZipBuffer` |

The full server-side pipeline (routes, async queue, builders) is in
`server/routes/api/export.js` and `server/export/`.

## The single PDF entry

There is one **PDF** row, not two. It downloads the deterministic
server-rendered PDF, and only reveals a **Print in browser** fallback when that
render fails or times out.

- Clicking **Export** fetches `pdf-slides.pdf?sync=1`. `?sync=1` forces the
  synchronous render path, so the response is the PDF bytes (or an error)
  rather than a `202` job hand-off that would need polling. The blob is saved
  with the filename from the `Content-Disposition` header.
- A client-side timeout (`PDF_FETCH_TIMEOUT_MS`, 90s; the server's own cap is
  `PDF_EXPORT_TIMEOUT_MS`, 120s) aborts a stuck render.
- On error or timeout, an inline fallback appears under the PDF row: a short
  message plus a button that opens the browser-print page (`pdf-slides`, the
  same 16:9 slide HTML) in a new tab, where the user does Cmd/Ctrl-P → Save as
  PDF.

The old menu exposed the server render and the browser-print page as two
co-equal items ("PDF" and "PDF (print in browser)"), which conflated *which
renderer runs* (an implementation detail) with a genuine user choice. The
genuinely distinct artifact is the **Text handout** (document layout), which
stays its own row under Documents.

## Language

`export-modal.js` reads `pres.i18n.active` for the default language. When the
deck has both language versions (`hasLangVersion`), an NL/EN segmented toggle
appears and its value is appended as `?lang=` to every export URL. Single-
language decks show no toggle. This replaces the dropdown's second, duplicated
"Export ({other lang})" section.

## i18n

Strings live under `editor.export.*` in `client/i18n/<locale>/editor.json`
(group titles, per-format descriptions, the PDF busy/fallback copy, the
language label). Format acronyms (PDF, PNG, PPTX, HTML, JSON) are hard-coded.
Non-nl/en locales fall back to the English defaults passed to `t()`.

## See also

- `docs/reference/standalone-html-export.md` — the HTML export builder.
- `docs/reference/video-slide-pdf-export.md` — video-slide placeholders in the PDF.
- `docs/reference/bulk-export.md` — the separate account-backup ZIP (Settings → Data Export), unrelated to this menu.

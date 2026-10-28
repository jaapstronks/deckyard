# Incomplete slides

A slide whose `essential` picture is still empty is **incomplete** (B590). The editor shows it and its author can work on it; every output leaves it out. A grey "image goes here" frame in a presentation, an export or a published page is never what anyone meant.

## The rule

`isSlideIncomplete(slide, slideTypes)` in `shared/incomplete-slides.js` is the one predicate. A slide is incomplete when its type declares, among the fields it draws (not `hidden`, `visibleWhen` holds):

- an `image` field with `essential: true` whose value is empty (`image-slide.image`, `image-text-slide.image`), or
- an `essential` list of pictures whose first entry is missing or has no picture. For a list, `essential` means its first entry ([essential-fields.md](essential-fields.md), D211). A list is a list of pictures when its item has one `image` sub-field and every string that could name the item is that picture's own alt or caption (`alt`/`caption`, or `<key>Alt`/`<key>Caption`, the spelling the alt ladder reads). `gallery-slide.images` and `image-set-slide.images` are; a logo carries an organisation's name and a team card a person, so `logo-wall-slide.logos` and `team-cards-slide.members` are not.

Only pictures count: an empty essential text field makes a sober slide, not a broken one. The rule is derived from the content. There is no flag, marker or visibility preset for it, so filling the picture by any route (editor, MCP, v1, import) finishes the slide, and nothing needs migrating.

A type that does not resolve in the registry is never incomplete. Callers pass the deck organization's merged registry so a custom type is judged by its own declarations; without one, core decides.

## Where it applies

The predicate sits inside the visibility seam, `isSlideVisibleIn` / `filterSlidesForContext` in `shared/slide-visibility.js`. After the context's own flag, an incomplete slide is left out of `presentation`, `export`, `published` and a read-only `viewer`. Only an editor's `viewer` keeps it. Every output that filters by context therefore leaves it out without a filter of its own:

| Output                                                                          | Through                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Presenter and projector window                                                  | `filterPresentSlides` (client), with `/api/slide-types` as registry                                                                         |
| Follow-along, share link, view-only reads, published page, embed, reader        | `projectPresentationForAudience`                                                                                                            |
| PDF, PNG, PNG ZIP, print, both PowerPoints, handoff ZIP, standalone HTML, notes | `buildExportContext` → `filteredPres` = `filterForExport`, for the author and a reader alike, in every language version, jumps pinned first |
| Deck card thumbnail                                                             | `thumbnailSlide`: the first slide a presentation shows                                                                                      |
| OG preview                                                                      | `firstPublicSlide` (published channel)                                                                                                      |

The data formats (JSON, the portable `.deck`) carry the whole deck and build from `pres`, so an incomplete slide survives a round trip.

The MCP previews (`preview_slide`, `preview_presentation`) show every slide so `preview_slide` keeps addressing slides by their stored index; an incomplete one carries a visible note with `data-incomplete="true"`.

## Publishing refuses, the editor tells

Publishing is refused with `422 incomplete_slides` while a slide the published page would show (not `hideInPublished`, not live-only, in any language version) is incomplete. `details.slides` lists the 1-based slide numbers ([api-error-format.md](api-error-format.md)). The check runs in `publishPresentation` before the alt check (`server/services/publish-complete-check.js`), so the editor's Publish button and the v1 API meet the same refusal; the Share dialog shows it inline beside the button.

Before presenting or exporting, the editor names the slides that output will skip in a confirm dialog (`client/views/editor/incomplete-slides-notice.js`). The notice is informative: the leaving-out itself is the seam's, so `/present/:id` opened directly, an MCP export and a v1 export skip the same slides without it. Present starts on the selected slide, or the first one after it the presentation shows.

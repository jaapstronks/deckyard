# The language of a slide type's built-in copy

Interactive slide types render copy of their own: "Follow along + vote", "Live
results", "Total:", scale labels, chart legends, image placeholders. This page
says where that language comes from and what happens when there isn't one.

This is a reference page: it describes what is, not what will change.

## One question, one answer

`resolveDeckLang(pres)` in `shared/i18n-utils.js` is the only thing that decides
a deck's language. Every render entrypoint calls it and passes the result to
`renderSlideHtml` as `ctx.lang`; every slide type reads `ctx.lang` and nothing
else.

It reads, in order: `i18n.active`, then `i18n.dominant`, then `pres.lang`. When
none of those says anything it returns **`null`** — not a guess.

That order is load-bearing. `active` is the language the deck is currently being
shown in — the editor swaps `pres.slides` to that version, and the language
toggle reads it — while `pres.lang` is the language the deck was _created_ in
and never moves. A bilingual deck created in Dutch and read in English has
`lang: 'nl'` and `active: 'en-GB'`, so reading `lang` first puts Dutch copy
under English slides. `dominant` covers a deck with an i18n block but no active
choice; `lang` covers a deck with no i18n block at all.

Returning `null` rather than a guess matters too: a caller cannot mistake "the
deck says nothing" for a real answer, and the copy layer gets to apply its own
documented default rather than inheriting an accident.

This is a narrower question than `<html lang>`, which also honours legacy
per-slide `content.lang` values and RTL codes and always produces a string. That
one lives in `server/utils/doc-lang.js` and is unchanged.

## The fallback is English

```js
export const DEFAULT_SLIDE_COPY_LANG = 'en-GB';
```

`getSlideCopy(lang)` (`shared/slide-types/slide-copy.js`) resolves `nl` and
`en-GB` to their own tables, accepts `en` as an alias for the canonical tag, and
sends everything else — an unknown locale, an empty string, `null` — to
`DEFAULT_SLIDE_COPY_LANG`.

It used to be Dutch, and that was never a decision. It was the `else` branch of
one file. English is what the rest of the product already falls back to: every
`t(key, fallback)` call ships an English fallback, and the locale-tiering
direction degrades a tier-2 locale to English rather than to Dutch.

**This is not the default language of a new deck.** That is a stored, editable
property of the presentation, seeded from the organization by
`resolveInitialDeckLang()` (stored preference > UI locale > first supported
language), and it still starts at `nl` for a Dutch organization. The constant above
only decides what happens when there is genuinely no language information to go
on — which, now that the deck language reaches the renderer, is rare.

## Why an English deck used to speak Dutch

Two faults, stacked, each hiding the other.

**Nothing ever set `ctx.lang`.** Not one caller of `renderSlideHtml` passed it —
not the editor canvas, not the presenter, not the exports, not the embed. Twelve
renderers read a value that was always `undefined`.

**Six type files papered over it** with a literal `ctx?.lang || 'nl'`
(`poll-slide`, `likert-slide`, `likert-slider-slide`, `feedback-slide`,
`timeline-slide`, `chart-slide`). So the missing language never presented as
missing; it presented as a Dutch deck.

Fixing either alone would not have been enough. Plumbing the language through
would still have hit `|| 'nl'` in six types; removing the six fallbacks would
have left every deck on the copy layer's own default.

`tests/slide-copy-language.test.js` scans the type sources and fails if any type
ever re-derives a language of its own again.

## Adding copy

`SLIDE_COPY` carries one table per language, and both tables must carry exactly
the same keys — asserted, so a key added to one and forgotten in the other fails
rather than rendering `undefined` when someone switches language. No value may
be empty.

Copy that a renderer prints must go through `getSlideCopy()`. Some strings still
do not. The first group are editor-canvas affordances rather than deck content:

| Type                | Strings                                 |
| ------------------- | --------------------------------------- |
| `countdown-slide`   | `Start`, `Pause`, `Reset`               |
| `custom-html-slide` | `Custom HTML`                           |
| `embed-slide`       | the "Paste an HTTPS URL to embed…" hint |
| `video-slide`       | the "Paste a YouTube/Vimeo URL…" hint   |

The second group _is_ deck content — it is just only ever heard, not seen. Four
types hardcode the `aria-label` on their structural list, where their siblings
(`poll-slide`, `likert-slide`, `timeline-slide`) take it from `copy`:

| Type            | Label            |
| --------------- | ---------------- |
| `cycle-slide`   | `Cycle stages`   |
| `funnel-slide`  | `Funnel stages`  |
| `process-slide` | `Process steps`  |
| `pyramid-slide` | `Pyramid levels` |

All of these are English-only, so they are an untranslated string rather than a
wrong-language one — a different defect from the one this page describes, and
not yet fixed. The `aria-label` group is the closer of the two to this page's
defect (a Dutch deck's screen reader announces English), and it is the cheaper
fix: four keys in each table, no markup change.

## Where the language is passed from

Client render surfaces go through `renderSlideElement` / `mountSlideInto`
(`client/lib/slide-runtime/slide-render.js`), which take a `lang` option:
editor canvas and thumbnails, slide list, deck grid, presenter, share viewer,
viewer panel, the bulk-edit and chart-data previews, and the slide library
(which passes the library item's own language, not a deck's).

Server-side: standalone HTML, PDF, PNG, PPTX, the handoff zip, the embed
fragment, the custom-slide-type render route, and the MCP `preview_slide` /
`preview_presentation` tools (`server/mcp/preview.js`).

Sample and preview surfaces that have no deck — the theme picker, the theme
editor preview, sandbox examples, curation thumbnails — deliberately pass
nothing and get `DEFAULT_SLIDE_COPY_LANG`. Leaving `lang` out is not neutral, so
anywhere a presentation is in hand it should be passed.

`tests/slide-copy-language.test.js` enforces that second sentence: it scans
`client/`, `server/` and `shared/` and fails on any `renderSlideHtml` call whose
options object has no `lang`. That gate exists because the two MCP preview tools
were missed on the first pass — and with the per-type `|| 'nl'` gone, a missed
call site no longer renders the _wrong_ language loudly; it renders the default
quietly, which is harder to notice.

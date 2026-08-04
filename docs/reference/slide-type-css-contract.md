# The slide-type CSS class contract

The class names a slide type renders are a public contract. Renaming one is a
change a fork has to hear about, and `tests/slide-type-css-contract.test.js` is
the gate that keeps the upstream half honest: **every class a core slide type
emits must resolve to a CSS rule.**

## Why this one is a gate and not an advisory

`npm run lint:deadcss` already walks the other direction — CSS selectors no
source references — and it stays advisory because class names in this codebase
are composed (`slide-bg-${id}`, `is-${state}`) and a naive scanner over-reports.
This direction has no such problem: a rendered class is a literal string, so the
question "does it have a rule?" has an exact answer.

It is a gate because this is the failure that reached production.

v1.8.0 replaced the title slide's class contract — `.slide-title`, `.title-bar`,
`.title-text`, `.title-logo`, `.logo-mark`, `.logo-img` and `.subtitle` became
`.slide-title-universal` plus the `tsu-*` family. Only the new names carried CSS.
A fork's own `ciiic-title-slide.js` still emitted the old ones and fell back to
bare document flow: a full-bleed title slide rendered as an inline image with the
heading under it and the logo blown up across the bottom.

Nothing that CI or an agent watches broke. No import failed. The slide produced
valid HTML. The merge had 2151 green tests. The site returned 200. The difference
was purely visual and a human found it hours after deploy.

## What the test does

For every registered core type it renders the defaults, plus one variant per
value that can carry a modifier class, and collects the class names. Three kinds
of value are swept:

- every declared option of every enum field;
- both states of every boolean field;
- the same two, one level down, for the fields of a collection field's items
  (`itemFields`, recursively) — the variant mutates one item of the type's own
  default content, or of the field's declared new-item skeleton when the
  defaults carry no items.

The variants matter: rendering defaults alone never emits the `is-*` family — the
layout, alignment and background modifiers that only appear on a non-default
value — and those are precisely the names a restyle renames. Enumerating the
values costs 777 renders across the registry and reaches 59 class names the
defaults alone never produce, four of them entries in the `UNSTYLED` list below.

Sweeping past the top-level enums is what makes that coverage stable rather than
accidental. `is-bleed` was reached only through image-slide's *legacy* hidden
`layout` enum, so retiring that compatibility field would have quietly dropped
the class from the sweep; the canonical `bleed` toggle now covers it. `is-black`
(text-blocks `rows[].color`) was emitted but never swept at all, and
`is-fit-contain` is now attributed to image-text through its own `images[].fit`
instead of being borrowed from image-slide.

A class passes if it has a rule in `client/styles/**`, or if the rendered markup
styles it in its own inline `<style>` block (the likely shape for a fork type
that ships its own rules), or if it is listed in `UNSTYLED` with a reason.

## The `UNSTYLED` list

Two kinds of entry, and they mean different things:

- **`hook`** — the class exists so code can find the element. `chart-frag` is
  queried by presenter stepping; `team-cards-group-right` is an inline-edit
  anchor. Styling them would be beside the point. These are permanent.
- **`unstyled`** — the class is emitted and no dedicated rule targets it, yet its
  presence is deliberate: it is the default value of an enum whose base slide
  already styles it, or a name whose look comes from an inline style or a
  numbered variant beside it. Each entry's reason says which.

Standing up the test found thirteen of the second kind. Recording them rather
than deleting them was deliberate: removing an emitted class is itself a contract
change under the rule this test enforces, so it belongs in a release with a note,
not in the commit that happened to notice it. Seven of the thirteen turned out to
be genuinely dead — emitted, styled nowhere, queried by nothing — and were later
removed at source in exactly such a release (`team-cards-group-left`, `kpi-note`,
`quote-author-text`, `poll-results-main`, `sfi-header`, `sfi-card-code`,
`sfi-card-qr`; see the release notes).

The six that remain are correct as they stand:

| Class | Why it is emitted without a rule |
| --- | --- |
| `chart-slice` | the pie renderer emits it beside the styled `chart-slice-<n>`; the base name is the category, the indexed one carries the colour |
| `is-left` | image-text marks the default side explicitly; only the opposite, `.split.is-right`, needs rules |
| `slide-bg-custom` | the `custom` background takes its colour from an inline style, so there is nothing to declare |
| `aspect-square` | the default `imageAspect` of team-cards; only the non-default `.aspect-original` carries a rule, the base slide styles this value |
| `shape-rounded` | the default `imageShape` of team-cards; only `.shape-square`/`.shape-circle` carry rules |
| `is-layout-center` | the default `layout` of chapter-title; only `.is-layout-top`/`.is-layout-bottom` carry rules |

The list cannot rot in either direction: one test fails if an entry names a class
no type renders any more, another fails if an entry quietly gained a stylesheet,
and a third requires every entry to carry a reason. Same two-way honesty as
`tests/docs-paths-resolvable.test.js`.

## What it cannot see

**A fork's own slide types.** They live in `custom/slide-types/`, which upstream
does not have. The test protects upstream from renaming a class out from under
*itself*; nothing in this repo can tell a fork that its `ciiic-title-slide`
depends on a name that moved. That is what the release-notes rule is for —
`docs/reference/versioning.md` § *Renamed slide-type classes go in the release
notes*.

**Whether the rule is any good.** A class with an empty or wrong rule passes. The
assertion is "this name is known to the stylesheets", not "this slide looks
right". Visual regression is a separate question (see the pixel-comparison
discussion in `docs/developer/export-smoke-test.md`).

**Content-dependent classes beyond the swept values.** A class emitted only for,
say, a particular item count, a combination of two options, or a specific string
value is not reached — the sweep varies one field at a time, and inside a
collection it varies one item. The declared-value sweep is the cheap 80%; a class
that only appears under bespoke content stays uncovered.

# Home view

The landing view (`/app`, `client/views/list/views/home-view.js`), shown after
login and on the Home sidebar tab. It answers a returning user's two top jobs —
resume recent work, and catch up on what others did — in a deliberately calm
two-column layout ("direction A", chosen over a zoned dashboard).

## Layout

Full-width greeting header over two columns (`.home-columns`, collapses to one
below 960px; CSS in `client/styles/base/01-core/31-list-layout.css`):

- **Main (`.home-main`)** — `Recent` (resume work) → `Popular` (discovery) →
  **Building blocks** shelf (the create affordance).
- **Rail (`.home-rail`, `aside`)** — a persistent **"From others"** activity
  feed, so awareness is never buried at the bottom of a scroll.

There is deliberately **no statistics strip**: engagement stats are only
meaningful for publicly shared decks and read as noise for private drafts.

First-run (zero decks) skips all of this and shows the theme picker + a single
create CTA instead of empty sections that read as "broken".

## Building-blocks shelf

Replaces the old theme-picker "start something new" zone. Cards: a dashed
**Blank presentation** (always present), slide **collections** (team first,
capped), then recent individual **team slides**. Clicking a block opens the
creation view pre-seeded (`onComposeFrom` → `preselect`). A subtle **"New to
you"** corner badge flags team-scope items the current user has never started a
deck from; it clears after first use. Usage is tracked per-user in
`slide_library_usage` (see `deck-creation-and-reuse.md`).

## The "From others" rail

An activity feed of what *other* people did (`excludeSelf`), bundled: a run of
same-actor / same-deck / same-type events collapses into one line with a count
pill (`bundleActivityEvents`). Each line reads "{actor} {action} \"{deck}\"".

Rich content on the line:

- **Comment text** — `comment.created` events carry a ≤100-char `bodyPreview`
  in their event data, shown under the line.
- **Slide preview thumb** — for a comment on a slide, the feed enrichment
  (`server/routes/api/activity.js`) attaches a minimal slide projection
  (`event.slide = { id, type, content }`) plus `event.themeId`, resolved from
  the presentation it already loads for the title/access check. The rail renders
  it client-side with the shared `renderSlideElement({ mode: 'thumb' })` +
  `attachThumbScale` + `loadThemeById` — the same path the presentation cards
  use, so there is **no server-side image render and no caching**. Custom slide
  types degrade to a type-name placeholder. Thumb cleanup callbacks go into the
  shared `detachThumbs` collector.

Event types surfaced include `presentation.created/updated`,
`comment.created/resolved`, `collaborator.added`, and **`slide.added`** — a
bundled "added N slides to a deck" event (`data: { count, slideIds, title }`)
emitted on save for decks of any scope (the feed filters by read access, so it
only reaches people who can open the deck). See
`server/services/activity-events.js` (`recordSlidesAdded`) and
`diffAddedSlideIds` in `server/routes/api/presentations/helpers.js`.

## One-request load: `GET /api/home`

The home's async sections load in a single round-trip via `/api/home`
(`server/routes/api/home.js`), which returns
`{ ok, popular, activity, buildingBlocks: { collections, teamSlides }, usage }`
by running the existing storage/handlers in parallel (`getPopularPresentations`,
`getEnrichedActivity`, `listPersonal/TeamCollections`, `listTeamLibrary`,
`listSlideLibraryUsage`). The activity filter surface
(`limit / excludeSelf / since / until / actorEmail / eventTypes[] /
presentationId`) is threaded through.

`recent` and total `counts` are deliberately **not** in the response: the home
derives them synchronously from the full presentation list `list.js` already
loads once and shares with the Presentations / search views, so re-deriving them
here would add latency for data the client discards.

The individual endpoints stay live for MCP / external callers, and the three
section loaders share one memoized `/api/home` fetch — each falling back to its
own endpoint if the aggregate fails.

## Navigation

The sidebar consolidated from nine items to six (Home · Presentations · Library ·
Insights · Activity · Trash). Recent / Workspace / My presentations / Shared with
me merged into one filterable **Presentations** view (scope chips + sort + tag
filter over a single list); see `client/views/list/views/presentations-view.js`.

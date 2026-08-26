# Deck creation and reuse

How a user starts a new deck, and the three mechanisms Deckyard offers for
reusing existing slides. Shipped across the `create-flow` track (Slices 1-4,
July 2026).

## The creation view

"+ New" opens a two-column creation view (`client/views/list/modals/creation-view/`),
a large modal rather than a route. The left rail is the method; the right pane
is the selected method, with the theme and language controls shown only where
they apply. The header and action bar are pinned; only the right pane scrolls.

Left rail methods:

- **Blank** - an empty deck in the chosen theme/language.
- **From the library** - compose a deck from reusable slides. A
  **Collections | All slides** toggle at the top switches between picking a
  whole collection (pre-seeds the tray in order) and picking individual slides.
  Multi-select with a drag-to-reorder tray drives the "Create · N slides"
  footer.
- **From content · AI** - paste text, upload a file, or pull from Notion.
- **Import** - restore a `.json` or `.md` file. Quiet by design: it is restore,
  not create, so the theme picker is hidden for JSON import.

"Duplicate a whole deck" is intentionally not in this view; it lives on every
deck card in the list.

## The three reuse mechanisms

Reuse is library-first. Three clean, non-overlapping mechanisms replace what
used to be split between starter kits and the slide library:

1. **Reuse a whole deck → Duplicate.** The per-card action clones the entire
   deck (`POST /api/presentations/:id/duplicate`). No special flag needed.
2. **Compose from parts → the slide library.** A library item is
   `{ slideType, content }` and composes freely into any deck, adopting the
   target deck's theme (theme is deck-level). The shared compose path is
   `client/lib/slide-library/compose.js`
   (`buildSlidesFromLibraryItems` / `createDeckFromLibraryItems`), which
   preserves per-language content across the NL/EN round-trip.
3. **A curated, repeatable start → Collections.** A named, ordered, scoped set
   of library slides - the "starter kit" job, but composable instead of
   clone-then-prune.

### Copying a slide: what gets re-derived

Duplicating, pasting and inserting from the library are all _copies of a slide_,
and they share one routine — `cloneSlidesForInsert()` in
`client/lib/slide-authoring/clone-slides.js`. It mints fresh slide ids,
re-points a nested child at its cloned parent when both are copied, and applies
the copied type's `instanceKeys` declaration.

`instanceKeys` is the per-type half: which **content** keys are bound to one
slide instance and must not travel with a copy. Two core types declare one — the
poll's `pollId` (`fresh-id`: it addresses the interaction state a live session
collects, so two slides sharing it would share the answers) and the
follow-invite's `presentationId` (`presentation-id`: the QR code is built from
it, so a copy into another deck has to re-point). The vocabulary is closed and
lives in `shared/slide-types/instance-keys.js`; the declaration travels on
`GET /api/slide-types`, so a fork type carrying an id of its own is honoured by
every copy path without touching a file outside its own directory.

Whole-deck duplication (`POST /api/presentations/:id/duplicate`) is a different
path and does not run this recipe.

### Saving a slide: the same declaration, a different rule

Instance keys are also written when a slide is merely **saved**, at the storage
write seam (`normalizeSlides` in
`server/storage/presentations/slides.js`). It reads the same declaration, and
the _source_ decides how each key is written:

| source            | on copy           | on save                                                                                           |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `fresh-id`        | always re-minted  | minted only when missing — an existing value addresses state kept outside the deck                |
| `presentation-id` | the new deck's id | re-derived from the deck being written, always; left alone when the writer does not know the deck |

So a poll keeps its `pollId` (and the answers collected under it) across every
save, while a follow-invite's `presentationId` is refreshed on every save and
can never go stale.

### Collections

A collection references existing `slide_library` items in an explicit order; it
does not copy content. Fields: `id`, `name`, `description?`, `shelf`
(`'personal' | 'organization'`, mirroring the library split), `ownerEmail`,
ordered `slideIds[]`, timestamps.

- **Storage**: migration `046_slide_collections.js` (`slide_collections` +
  ordered `slide_collection_items`) with the Postgres `withCollections` mixin.
  Facade `server/storage/collections.js` applies the personal-owner and
  organization-shelf guards.
- **API:** `/api/slide-collections` (GET/POST/PATCH/DELETE + reorder), same
  shelf/authz conventions as `server/routes/api/slide-library.js` (the shared
  shelf lives under the `/organization` segment).
- **Manage** from the library sidebar (`client/lib/slide-collections/`): a
  collections bar (create/rename/delete + chips), a manage-membership modal
  (drag-reorder + remove), and add-to-collection off the card more-menu.
- **Use** from the creation view: picking a collection pre-seeds the compose
  tray in order (deselectable), then Create composes via
  `createDeckFromLibraryItems`.

## Theme default and the allowlist

Two organization settings govern which themes are on offer, both edited in the
Themes settings tab and both resolved server-side:

- **`defaultThemeId`** — the theme new decks start with. Precedence:
  app setting, then the `DEFAULT_THEME` env var, then the built-in default
  (`getDefaultThemeId`, `server/storage/settings.js`).
- **`enabledThemes`** — the allowlist of themes that may be picked. Same
  precedence shape: app setting, then the comma-separated `ENABLED_THEMES` env
  var, then empty (`getEnabledThemeIds`). **Empty means no allowlist is
  configured, so every theme is offered.**

The allowlist is **hard**: `GET /api/themes` does not return a theme outside it,
so all three pickers that read the endpoint — the creation grid, the editor's
deck-settings theme select, and the "start from a theme" row on Home — offer the
same set. There is no client-side toggle that reveals the rest.

Two themes stay in the response regardless of the allowlist:

- the resolved **default theme**, so an organization cannot allowlist itself out
  of the theme its own new decks get;
- the theme named by **`?current=<id>`**. Pickers editing a deck pass the theme
  it is on, so a deck that predates a withdrawal keeps rendering and keeps
  showing its own selection. The two picker helpers in
  `client/lib/theme/theme-select.js` add the parameter automatically.

`?all=1` returns the unfiltered list and is honoured only for users who may
manage themes. It exists for one caller: the Themes settings tab, which cannot
offer a checkbox for a theme it is not allowed to see.

Forks (e.g. CIIIC) ship both seams as configuration: `DEFAULT_THEME` for the
starting theme, `ENABLED_THEMES` for the allowlist. Note the consequence of the
precedence: while `ENABLED_THEMES` is set, saving the settings tab with every
theme checked stores an empty app setting, which hands control back to the env
var rather than opening everything up.

## Starter kits (removed)

The per-deck `is_starter_kit` flag and its dedicated tab/mode/share-option were
removed in Slice 4 (migration `047_drop_starter_kits.js` drops the column).
Their job is covered by Duplicate + the library + Collections. Former kit decks
are now normal organization decks, editable and duplicable under the usual
organization rules. `isViewOnly` is a separate, still-supported concept.

## Composing keeps both languages

A library item stores per-language content under `i18n.versions[<lang>].content`,
and every hop of the compose path carries it: `mapSlideLibraryRow`
(`server/storage/slide-library.js`) returns `i18n` on the item, the
internal `/api/slide-library` routes serve that object as-is,
`buildSlidesFromLibraryItems` (`client/lib/slide-library/compose.js`) forwards
each available language as `contentByLang`, and `prepareNewPresentation`
(`server/storage/presentations/crud/factory.js`) expands that into one i18n
version per language, sharing a stable slide id across versions. A slide with
no multilingual content falls back to a single version.

Pinned by `tests/slide-library-compose-i18n.test.js` (both halves of the
round-trip) and `tests/pg/slide-library-i18n-storage.pgtest.js` (create,
read-back and update against real PostgreSQL).

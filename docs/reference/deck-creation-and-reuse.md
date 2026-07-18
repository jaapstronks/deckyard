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

### Collections

A collection references existing `slide_library` items in an explicit order; it
does not copy content. Fields: `id`, `name`, `description?`, `scope`
(personal/team, mirroring the library split), `ownerEmail`, ordered
`slideIds[]`, timestamps.

- **Storage** is dual-backend like the slide library: file backend
  `server/storage/collections-file.js`; DB backend migration
  `046_slide_collections.js` (`slide_collections` + ordered
  `slide_collection_items`) with the Postgres `withCollections` mixin. Facade
  `server/storage/collections.js` (`withStorageFallback`) keeps them parallel,
  with personal-owner and team-creator/admin guards.
- **API:** `/api/slide-collections` (GET/POST/PATCH/DELETE + reorder), same
  scope/authz conventions as `server/routes/api/slide-library.js`.
- **Manage** from the library sidebar (`client/lib/slide-collections/`): a
  collections bar (create/rename/delete + chips), a manage-membership modal
  (drag-reorder + remove), and add-to-collection off the card more-menu.
- **Use** from the creation view: picking a collection pre-seeds the compose
  tray in order (deselectable), then Create composes via
  `createDeckFromLibraryItems`.

## Theme default

The theme picker defaults to a workspace-configured default theme; non-default
themes sit behind a "Show all themes" toggle governed by the `enabledThemes`
allowlist. `GET /api/themes` honours the allowlist and returns a resolved
`defaultThemeId` (app settings + the `DEFAULT_THEME` env seam, via
`getDefaultThemeId`). Admins set the default and the visible subset in the
Themes settings tab. Forks (e.g. CIIIC) default to their own theme through
`DEFAULT_THEME` + the allowlist.

## Starter kits (removed)

The per-deck `is_starter_kit` flag and its dedicated tab/mode/share-option were
removed in Slice 4 (migration `047_drop_starter_kits.js` drops the column).
Their job is covered by Duplicate + the library + Collections. Former kit decks
are now normal workspace decks, editable and duplicable under the usual
workspace rules. `isViewOnly` is a separate, still-supported concept.

## Known limitation

On Postgres installs the slide-library adapter's `mapSlideLibraryRow` does not
surface `i18n`, so composed decks fall back to single-language content
(file-mode keeps NL+EN). The compose path degrades gracefully; storing and
returning library-item i18n from the adapter is a separate storage task.

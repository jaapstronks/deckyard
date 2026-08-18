# Vocabulary — one word per meaning

Deckyard names each concept exactly one way, at every level: wire (API fields
and values), code (identifiers), database (columns and stored values), and
docs. A second accepted spelling for the same meaning — or one word carrying
two meanings — is a defect, not a convenience; the doctrine behind that is
`versioning.md` § *The beta stance: purity over compatibility*. This page is
the normative register of the settled words. Guard tests pin the losers to
zero so they cannot creep back.

## The register

| Concept | The word | Never |
|---|---|---|
| The tenant entity (who owns decks, members, settings) | **`organization`** — code, DB, API, docs | `workspace` in any identifier, field, value, or column |
| What the UI calls an organization | **"Workspace"** — user-visible label strings only (i18n values, `t()` fallbacks) | leaking the label into code |
| Who can see a deck besides owner/creator/collaborators | **`visibility`**, values **`'private' \| 'organization'`** | `scope` as a field name; `'workspace'` as a value |
| The org+actor context a storage call runs under | **`storageScope`** (type `StorageScope`, `server/storage/scope.js`) | a bare `scope` variable in mixed contexts |
| Which decks a listing includes by source (`owned`/`shared`/`all`) | **`ownership`** — MCP list filters, the client presentations view | `scope` (that's storage-scope); `visibility` (that's deck audience) |
| Where a saved slide/collection lives (a person's shelf or the shared one) | **`shelf`**, values **`'personal' \| 'organization'`** — `slide_library`/`slide_collections`, storage, internal API, client | `scope` as the field name (that's storage-scope); `'team'` as the stored value |
| What an API key may do (`['read','write','ai',…]`) | **`permissions`** | `scopes` |
| What a collaborator may do on one deck (`view/comment/edit/admin`) | **`permission`** (singular, per deck) | — distinct from API-key `permissions` |
| The presenter/audience live domain | **`live-session`** | `present-session` |
| The multi-tenant feature flag | **`MULTI_ORG_ENABLED`** (`isMultiOrgEnabled()`) | `MULTI_WORKSPACE_ENABLED` |

## The organization / "Workspace" rule

The entity is an `organization` everywhere a machine reads the word:
identifiers, file names, DB columns and values, API fields and values, event
names (`presentation.moved_to_organization`), env vars. **"Workspace" survives
exclusively as the UI label** — the text a human sees on screen. That means
i18n JSON values and the English fallback strings inside `t()` calls may say
"workspace"; nothing else may. When code needs to mention the label, it says
so explicitly (e.g. "the UI labels an organization \"workspace\"").

Decided as D10+D11 (2026-08-06); executed in B41-a. The public API break
(`scope` → `visibility`, `'workspace'` → `'organization'`) shipped as a
breaking MINOR with a stored-data migration (074) — no accepts-both reading.

## Implementation status (honest notes)

- **Enforced**: `tests/organization-vocabulary.test.js` pins `'workspace'`
  as a quoted value, the workspace-flag spellings, and the old scope-as-
  visibility API names to zero in code; `tests/live-session-vocabulary.test.js`
  does the same for the live-session domain;
  `tests/listing-filter-vocabulary.test.js` pins the deck-source listing
  filter to `ownership` (never `scope`/`visibility`);
  `tests/shelf-vocabulary.test.js` pins the slide-library/collections axis to
  `shelf` (never `scope`). `server/db/migrations/` is excluded as the
  historical record.
- **Doc prose is gated too (B88, 2026-08-18).** The three gates above each
  carry a `docs/reference/**.md` section, so a reference page cannot keep a
  loser spelling alive after the code drops it. The needles are per-axis and
  narrow rather than a blanket word ban: `\bteam\b` would drown in the
  `team-cards` slide type and its CSS locals, and bare `scope`/`visibility`
  are legitimate on nearly every page. Exempt in every gate: this file (the
  register must name a loser spelling to forbid it) and `collab-research.md`
  (a deliberately frozen phase-0 snapshot); the organization gate also exempts
  `notion-import.md`, which describes Notion's own workspace concept.
- **`scope` still legitimately exists** for the storage-scope concept
  (`server/storage/scope.js` — the module and its prose; variables say
  `storageScope`).
- **Listing filter — done (B53 sweep (a), 2026-08-17).** The MCP
  `list_presentations` / `list_recent_comments` filter and the client
  presentations view now spell the owned/shared/all source filter
  **`ownership`**. The storage helper's `visibility` option
  (`listAccessiblePresentationRefs`, `listRecentCommentsForOwner` in
  `server/storage/presentations/comments.js`) — a second homonym for the same
  concept — was renamed with it. This was a breaking change to the MCP tool
  schema, shipped deliberately with no back-compat alias; MCP clients re-read
  the schema each session.
- **Shelf axis — done (B53 sweep (b), 2026-08-17).** The slide-library /
  slide-collections axis that says where a saved slide or collection lives is
  **`shelf`**, values **`'personal' | 'organization'`**. The stored-data half
  is migration 076 (`slide_library.scope` / `slide_collections.scope` → `shelf`,
  `'team'` → `'organization'`, indexes renamed); the field flows through
  storage, the internal API (the route segment `/team` became `/organization`)
  and the client. It never appeared in the public v1 API
  (`sanitizeLibraryItem` omits it) and still does not. "Team" survives only as a
  UI label. Deploying this requires migration 076 to run.
  **Names finished in B90 (2026-08-18).** B53 moved the field, the values and
  the route segment but left the *names*: the storage exports
  (`listTeamLibrary`, `getTeamCollection`, …), the shelf route handlers, the
  bulk-export ZIP entry `slide-library/team.json` and the `/api/home` response
  fields (`collections.team`, `teamSlides`). All now read *organization*; the
  ZIP entry is `slide-library/organization.json` and the manifest stat is
  `organizationSlideLibraryItems`. `tests/shelf-vocabulary.test.js` pins the
  loser identifiers to zero across `server/`, `client/` and `tests/`.
  Deliberately untouched: the *tenant* axis, where "team" means an
  organization (`getTeamWeeklyAnalytics`, `buildTeamDigestEmail`), and the
  webhook surface (`slideAddedToTeamLibraryUrl`, event
  `slide.added_to_team_library`), which is a stored settings key plus a public
  payload contract and so needs its own migration, on the model of migration
  074 for `presentationMovedToOrganizationUrl`.
- **Local, non-persisted use of the word "scope" is not a homonym defect.**
  A view-local variable using "scope" in its ordinary English sense (the
  comments panel's `'slide' | 'deck'` toggle, prose like "scoped to") makes
  no vocabulary claim: it names nothing in storage, the API, or a schema.
  The register above governs *persisted and contract-level* names only.
- The physical table `present_sessions` keeps its name (renaming is a
  migration with no behavioural payoff; see the note in
  `tests/live-session-vocabulary.test.js`).

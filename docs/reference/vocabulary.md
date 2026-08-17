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
  does the same for the live-session domain. `server/db/migrations/` is
  excluded as the historical record.
- **`scope` still legitimately exists** for the storage-scope concept
  (`server/storage/scope.js` — the module and its prose; variables say
  `storageScope`).
- **Remaining homonyms — decided 2026-08-17, sweeps pending.** The normative
  targets are now fixed; the code has not been swept yet:
  - The listing *filters* named `scope` on the MCP tools
    (`list_presentations`, `list_recent_comments`: `owned/shared/all`) and
    the client presentations view become **`ownership`**. This is a breaking
    change to the MCP tool schema — deliberate; MCP clients re-read the
    schema each session.
  - The slide-library/collections shelf axis (`scope: 'personal' | 'team'`,
    DB columns `slide_library.scope`, `slide_collections.scope`) becomes
    **`shelf: 'personal' | 'organization'`** — internal rename plus
    migration; this field does not appear in the public v1 API.
- **Local, non-persisted use of the word "scope" is not a homonym defect.**
  A view-local variable using "scope" in its ordinary English sense (the
  comments panel's `'slide' | 'deck'` toggle, prose like "scoped to") makes
  no vocabulary claim: it names nothing in storage, the API, or a schema.
  The register above governs *persisted and contract-level* names only.
- The physical table `present_sessions` keeps its name (renaming is a
  migration with no behavioural payoff; see the note in
  `tests/live-session-vocabulary.test.js`).

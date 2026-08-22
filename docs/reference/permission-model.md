# The permission model

Who may read, comment on, edit, share and delete a deck — the per-deck axis of
access control. Written 2026-08-05 against HEAD.

Other docs name permission levels (`edit`, `comment`, `view`) and roles
("collaborator", "author", "owner") in passing. This is the one place that
defines them: what the levels are, which grants exist, in what order they are
consulted, who can hand them out, and how the answer is cached. The
**organization** axis — which organization a request acts in, and why a deck in
another organization is absent rather than forbidden — is
[`tenant-isolation.md`](tenant-isolation.md), and it sits _underneath_
everything here: a deck that the storage scope does not return never reaches a
permission check at all.

## Purpose & scope

Deckyard's per-deck authorization is a set of **pure decider functions** in
`server/utils/presentation-authz/`. Each takes the objects a route already has
in hand — the authenticated user, the presentation row, and (where relevant) a
collaborator permission the caller looked up — and answers one boolean. They
touch no storage, so they are the same functions on every surface: browser
routes, the public API, MCP, and the client's advisory mirrors all decide by
the same rules.

The deciders sit between two layers that are not theirs. Below them, the
storage layer scopes every query on `organization_id` and hands back a
presentation or nothing. Above them, the routes turn `false` into an HTTP
status. What the deciders own is only the rule itself, and each rule is stated
once: ownership comparison lives in `shared/identity-match.js`, the level
ladder in `shared/constants/permissions.js`, and the deck-level grants in
`presentation-authz/presentations.js`.

## Module map

The deciders (`server/utils/presentation-authz/`, 5 modules, 604 lines), fronted
by one barrel:

- `server/utils/presentation-authz.js` — the barrel every call site imports;
  re-exports the deciders plus the identity helpers from `shared/`.
- `server/utils/presentation-authz/presentations.js` — the deck-level deciders:
  read, write, delete, visibility change, force-unlock, ownership transfer,
  authorship, collaborator management, commenting, and the effective level.
- `server/utils/presentation-authz/share-links.js` — what a validated share
  link grants (read / comment / write, and its effective level).
- `server/utils/presentation-authz/comments.js` — comment moderation
  (resolve/reopen) and comment authorship (edit/delete).
- `server/utils/presentation-authz/guests.js` — what a verified share-link
  guest may do with their own comments.
- `server/utils/presentation-authz/actor-access.js` — the machine-client
  wrapper: takes an actor `{ email, organizationId }`, resolves it to a
  `users.id` and fetches the collaborator permission, then applies the same
  deciders.

Shared with the client (imported by both sides, so the rule cannot fork):

- `shared/identity-match.js` — "is this actor the person this stamp names?",
  keyed on `users.id` and on nothing else.
- `shared/constants/permissions.js` — the four levels and the four predicates
  (`canRead` / `canComment` / `canWrite` / `canManage`).

Storage and cache:

- `server/storage/collaborators.js` — the collaborator CRUD and the
  `getCollaboratorPermission` lookup the deciders are fed from.
- `server/storage/cache/permission-cache.js` — Redis-or-memory cache in front
  of that lookup, with explicit invalidation on every write.

Enforcement seam and the routes that hand grants out:

- `server/utils/route-middleware.js` — `withPresentationAuth` (load + check +
  respond, for `read` / `write` / `delete` / `manage`) and
  `withPresentationReadAuth` (the same, plus a guest-session fallback).
- `server/routes/api/collaborators.js` — invite, list, revoke and re-level
  collaborators.
- `server/routes/api/share-links/management.js` — the link-based grants.

The client's advisory mirrors — which affordance to show, never whether an
operation is allowed — are `client/lib/comments/comment-authz.js`,
`client/lib/slide-authoring/slide-lock-authz.js` and the owner gate of
`client/views/editor/modals/share-modal/index.js`.

## The ladder

Four levels, ordered, defined once in `shared/constants/permissions.js`:

| Level     | Read | Comment | Edit | Manage collaborators |
| --------- | ---- | ------- | ---- | -------------------- |
| `view`    | ✅   | —       | —    | —                    |
| `comment` | ✅   | ✅      | —    | —                    |
| `edit`    | ✅   | ✅      | ✅   | —                    |
| `admin`   | ✅   | ✅      | ✅   | ✅                   |

`admin` is a _deck-level_ level: it lets someone delegate access without owning
the deck (migration 022, which widened the `check_collaborator_permission`
constraint). It is unrelated to the instance-wide `isAdmin` flag and to an
organization role — see _Authz & tenancy_ below.

Above the ladder sit two positions that are not levels because they are not
handed out per deck:

- **Owner / creator** — the identity stamped on the deck
  (`ownerId`/`ownerEmail`, `createdById`/`createdBy`). Two stamps, and they
  answer two different questions (D43, D49):

  | Question                                                                                                          | Reads              | Deciders                                                                                                                                                                                   |
  | ----------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | **Power over the object** — writing it, deleting it, changing who may see it, handing out access, handing it over | `isOwner`          | `canWritePresentation`, `canDeletePresentation`, `canChangePresentationVisibility`, `canManageCollaborators`, `canTransferOwnership`, `getEffectivePermission`                             |
  | **Authorship and sight** — who made it, who may see it, whose mark it carries                                     | `isOwnerOrCreator` | `canReadPresentation`, `canCommentOnPresentation`, `isPresentationAuthor` (slide locks), the two comment-moderation deciders, the "my decks" filter, trash, bulk export, the v1 middleware |

  The line follows from one fact: **`created_by` is create-only by
  construction** (`server/storage/presentations/index.js` never rewrites it).
  A creator-inclusive grant is therefore one that nothing can ever take away —
  exactly wrong for a power that is supposed to be transferable, and exactly
  right for a fact about the past. Before D49 the creator stamp still carried
  write, delete, visibility and collaborator management, which made the
  transfer dialog's promise ("you will become a collaborator with edit access")
  false in the one case where it mattered: a previous owner who declined the
  collaborator row kept strictly more than the row would have given them.

  `getEffectivePermission` sits on the power side because it picks the UI
  (editor vs viewer) and so has to answer the same as `canWritePresentation`;
  a creator-inclusive `edit` there would open an editor whose every save the
  server refuses.

- **The unrestricted operator** — `user.unrestricted`, set only for the
  anonymous admin of an auth-disabled install (`AUTH_ENABLED=false`,
  `server/auth/auth.js`). There is nobody to protect decks from, so every
  ownership-scoped check grants. Real users never carry the flag, so it cannot
  widen access on an auth-enabled deployment.

Share links carry a level from the same vocabulary but a narrower set:
`view | comment | edit`, constrained in migration 004. There is no `admin`
share link — a link cannot delegate.

## Data model

**`presentation_collaborators`** (migration 010) — one row per person invited
to one deck:

| Column                                           | Notes                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation_id`                                | FK, `ON DELETE CASCADE`                                                                                                                                                             |
| `user_email`                                     | The leading key. `(presentation_id, user_email)` is unique (`unique_collaborator`).                                                                                                 |
| `user_id`                                        | FK to `users.id`, nullable, `ON DELETE SET NULL` (migration 062). Written on every invite, **not yet read** — see _Implementation status_.                                          |
| `organization_id`                                | A denormalized copy of the _deck's_ organization, stamped from the presentation row. Read by exactly one query — the "shared with me" listing.                                      |
| `permission`                                     | `view` / `comment` / `edit` / `admin` (migrations 010, 022).                                                                                                                        |
| `invited_by`, `invited_at`, `accepted_at`        | Provenance.                                                                                                                                                                         |
| `revoked_at`, `revoked_by`, `revocation_message` | Revocation is a soft delete; every read filters `revoked_at IS NULL`. Re-inviting a revoked collaborator reactivates the same row. `revocation_message` arrives from migration 027. |

Two partial indexes, both `WHERE revoked_at IS NULL`: by `presentation_id`
(list a deck's collaborators) and by `(user_email, organization_id)` ("shared
with me").

**Ownership stamps on `presentations`** — `owner_id` / `owner_email`,
`created_by_id` / `created_by` (migration 063). The id is the key; the address
beside it is display only, and a row whose id column is a defined NULL names
nobody.

**`presentation_share_links`** (migration 004) — token, `permission`,
`expires_at`, `revoked_at`, `revocation_message`. The token is globally unique
and _is_ the authorization, which is why link reads take no organization
(see `tenant-isolation.md`, edge decision 6).

## Flows

### 1. A request asks for a deck

`withPresentationAuth({ storageScope, id, authedUser, res, permission })` —
the caller passes the request's central storage scope; the helper builds
nothing itself:

1. `getPresentation(storageScope, id)` — organization-scoped.
   Nothing back → **404**. A deck in another organization is _absent_, not
   forbidden, so authorization never sees it.
2. For `read` and `write`, look up the caller's collaborator permission
   (cached).
3. Apply the decider for the requested permission
   (`read` → `canReadPresentation`, `write` → `canWritePresentation`,
   `delete`, `manage`). `false` → **401**.
4. Return the presentation.

`withPresentationReadAuth` is the same with one extra rung: if the
authenticated checks fail, a verified share-link guest session (cookie
`share_guest_session`) whose link points at this deck may still read.

### 2. The deciders, in order

Every deck-level decider consults the same grants in the same order. Taking
`canReadPresentation` as the shape:

1. **Unrestricted operator** → grant.
2. **No identity at all** (neither `users.id` nor an email) → refuse.
3. **Organization visibility** — the deck is `visibility: 'organization'` _and_
   `isSameOrganization(user, pres)` → grant. This is the only grant that rests
   on "we are in the same organization"; it is what makes an organization deck
   readable by colleagues who were never invited.
4. **Ownership** — `isOwner(user, pres)` for the power deciders,
   `isOwnerOrCreator(user, pres)` for the authorship and sight ones (see
   _Owner / creator_ above) → grant.
5. **Collaborator row** — a permission at or above the level the operation
   needs → grant.
6. Otherwise refuse.

Where the deciders differ from that shape, they differ deliberately:

- **`canWritePresentation`** puts ownership _before_ the organization grant,
  because two gates sit in between: in sandbox mode an organization deck is
  read-only for guests (curated seed content), and `isViewOnly` makes a deck
  read-only for everyone who is not its owner.
- **`canDeletePresentation`**, **`canTransferOwnership`** and
  **`isPresentationAuthor`** consult ownership only. No collaborator level
  reaches them, `admin` included. The first two read the owner stamp; only
  `isPresentationAuthor` reads the pair (see _Owner / creator_ above).
- **`canManageCollaborators`** grants to the owner or an `admin`
  collaborator. Note what is _absent_: the organization grant. Being in the deck's
  organization lets you edit it; it does not let you hand out access to it.
- **`canChangePresentationVisibility`** is a transition check, not a level check:
  same-visibility is a no-op and always allowed; the instance `isAdmin` may make any
  transition; sandbox mode refuses every transition (no guest-to-guest
  sharing); otherwise only the owner, and only `private → organization`.
  `organization → private` is admin-only.
- **`getEffectivePermission`** is the client's answer, not a gate: it returns
  `edit | comment | view` for the editor to pick a UI, and is delivered as
  `_userPermission` on `GET /api/presentations/:id`. A view-only organization deck
  resolves to `comment`; anything unmatched falls back to the collaborator
  level, or `view`.

### 3. Identity: which key decides

`isOwnerOrCreator` → `matchesIdentity` (`shared/identity-match.js`):

1. **Both sides carry a `users.id` and the ids are equal** → the same person.
2. **Anything else** → not the same person. No address is compared, ever.

Rule 2 is the retirement of the old address fallback (decision D22, 2026-08-19):
an external or legacy row whose address never matched a `users` row keeps a NULL
id and now names nobody at all. That is what lets a response name a person as
`{ id, displayName }` instead of handing out their address — the client mirrors
could not answer "is this mine?" without one while the fallback existed. What it
costs is bounded: such a deck is still reachable through `owner_user_id`, and
only rows stamped before an account existed lose their _creator_ claim.

The one actor with no id is the **auth-off operator** (`AUTH_ENABLED=false`),
flagged `unrestricted`. On that instance there is nobody to tell them apart
from, so `matchesIdentity` answers yes for every stamp — stated outright rather
than routed through an address comparison. The **dev bypass**
(`AUTH_DEV_BYPASS`) is a real database user: `server/auth/dev-bypass.js`
resolves `dev@local.test` to a `users` row (creating it on first use) when the
session is built, so it needs no exception.

Machine clients (public API keys, MCP sessions) hold an address and no id, so
the boundary resolves it once — `middleware.js` for the public API,
`actingIdentity()` for MCP tools, `actor-access.js` for the shared checks —
rather than per deck. An address with no `users` row resolves to a defined NULL,
and such an actor reaches only what being _a_ user grants (organization
visibility), never what being _the_ owner does.

### 4. Handing out and revoking a collaborator grant

`POST /api/presentations/:id/collaborators` (single email or up to 20):

1. Load the deck on the session's storage scope; `canManageCollaborators`.
2. Refuse self-invites, and refuse an email that is not a user of the
   organization (`user_not_found`) — collaborator invites are for people the
   instance already knows.
3. `addCollaborator` resolves the invitee's `users.id`, stamps the **deck's**
   organization (never the inviter's session organization), and either inserts
   or reactivates a revoked row.
4. Invalidate the permission cache for `(deck, email)`.
5. Fire the side effects: an in-app notification broadcast over SSE, an
   activity event, and an invite email (unless `sendInvitation: false`).

`DELETE …/collaborators/:email` soft-revokes with an optional message;
`PATCH …/collaborators/:email` re-levels. Both invalidate the cache. Neither
writes a notification or an activity event — an asymmetry with the invite path
that is a known open question, not a rule (TODO B44).

### 5. The permission cache

`getCollaboratorPermission(presentationId, userEmail)` is on the hot path of
every authorized request, so it is cached:

- Key: `perm:<presentationId>:<lowercased email>` — the same key as the row it
  caches. A presentation id is a globally unique uuid, so it already names one
  deck in one organization; keying on an organization as well would let one row
  be cached under two keys.
- Two tiers: Redis when available (`withRedis`), and an in-memory LRU behind it
  for single-instance deployments. A write goes to both; a read tries Redis
  first and falls through.
- `null` — "this person holds nothing on this deck" — is cached too, as the
  marker `__NULL__` in Redis, so a stranger's repeated requests do not re-query.
  `undefined` means "not cached".
- Invalidation is explicit and per `(deck, email)`: every collaborator write in
  `storage/collaborators.js` calls `invalidatePermission` before returning.
  Nothing else invalidates, so a permission change is visible instantly on the
  instance that made it, and within the TTL elsewhere when Redis is absent.

## Config & flags

| Variable                       | Effect                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERMISSION_CACHE_TTL_SECONDS` | Cache TTL, default `300`.                                                                                                                                                                |
| `PERMISSION_CACHE_MAX_SIZE`    | Max entries in the in-memory fallback, default `10000`.                                                                                                                                  |
| `REDIS_URL`                    | When set and reachable, permissions cache in Redis and invalidation is instance-wide. Absent → memory only (the same optional-Redis rule as [`jobs-and-queues.md`](jobs-and-queues.md)). |
| `AUTH_ENABLED=false`           | Produces the single `unrestricted` operator; every ownership-scoped check grants.                                                                                                        |
| `AUTH_DEV_BYPASS`              | Auto-login in development. The bypass user is not a database user, so it decides on the email fallback.                                                                                  |
| `MULTI_ORG_ENABLED`            | Turns `isSameOrganization` into a real comparison. Unset, it answers `true` from the flag without reading anything.                                                                      |
| `SANDBOX_MODE`                 | Organization decks become read-only for guests and every visibility transition is refused. See [`sandbox-mode.md`](sandbox-mode.md).                                                     |

## Authz & tenancy

The per-deck ladder is one of **three independent axes**, and confusing them is
the usual mistake:

1. **The organization axis** — which organization a request acts in. Enforced in
   storage, on every query, by `organization_id`. Rules R1–R3 and the edge
   decisions are in [`tenant-isolation.md`](tenant-isolation.md); do not restate
   them here. Its only appearance in this document is `isSameOrganization`,
   which gates the organization grant as defense in depth.
2. **The per-deck ladder** — this document.
3. **Instance and organization roles** — `isAdmin` (instance) and the
   organization role. These govern admin _screens_ and organization
   membership, and they deliberately do **not** grant deck read or write:
   an instance admin can change a deck's visibility and moderate its comments, but
   `canReadPresentation` never consults `isAdmin`. Organization roles are in
   `tenant-isolation.md` § _The organization UI_.

Two consequences worth stating explicitly:

- A collaborator row is addressed by `(presentation_id, user_email)` and its
  reads take no organization. That is not a gap: the caller has already settled
  whether the session may see the deck by loading it on an organization-scoped
  storage scope. A cross-organization collaborator therefore reaches the deck
  through every presentation-scoped endpoint — but does not appear in their own
  "shared with me" list, which is the one collaborator query that _is_
  organization-scoped. Whether that listing should be organization-scoped is an
  open product question (`tenant-isolation.md`, edge decision 5).
- A share link and a follow code authorize on the token alone, with no
  organization filter, because a globally unique token already names one deck.

## Implementation status

Normative target: **one ladder, one decider per question, keyed on
`users.id`.** Where the code stands against that, honestly, as of 2026-08-05:

- **The ladder itself is canonical.** Four levels, one definition
  (`shared/constants/permissions.js`), four predicates, and every decider goes
  through them. Share links use a subset of the same vocabulary rather than a
  parallel one.
- **Ownership decisions key on `users.id`** with the email as the defined
  fallback, on both sides of the wire, since T10 PR A/C (#638, #640). The
  client mirrors import the same module, so client and server cannot drift on
  who an owner is.
- **Collaborator grants still key on the email.** `user_id` exists on
  `presentation_collaborators` and is populated on every write (migration 062),
  but no read consults it: `getCollaboratorPermission`, the cache key, the
  unique constraint and both indexes are all on `user_email`. Moving the ACL
  reads onto the id is the remaining step of the identity epic; it changes the
  _keying_, not the ladder, so nothing in this document depends on it.
- **Comment authorship keys on the id** since migration 079 gave
  `presentation_comments` an `author_user_id` (and an `author_guest_id` for
  share-link guests, who have no user record and never will). Exactly one of
  the two is set on a comment written from here on; a legacy row whose address
  matched neither is unattributed and nobody can claim it. Comment
  _moderation_ (resolve, reopen, delete on your own deck) goes through the
  id-keyed ownership decider as before.
- **`presentation_collaborators.organization_id` is a denormalized copy** and a
  known R2 hazard. It drifted once — the write path stamped the inviter's
  session organization — and cannot any more: writes read the stamp off the
  presentation, migration 064 re-stamped the history, and
  `tests/collaborator-cross-org-endpoints.test.js` fails any call site that
  passes a scope back in. It survives only because "shared with me" needs it.
- **Revocation is asymmetric with invitation**: revoking or re-levelling writes
  no notification and no activity event, and `revocation_message` is stored but
  never delivered, while share links do surface theirs. Open, tracked as
  TODO B44 — an asymmetry, not a decision.

Pinned by `tests/authz-matrix-pin.test.js` (the whole matrix, unchanged across
the identity rebuild), `tests/authz-identity-key.test.js`,
`tests/authz-unrestricted.test.js`, `tests/collaborators-permission-model.test.js`,
`tests/authz-organization-scope.test.js` and its multi-org twin,
`tests/public-api-authz.test.js`, and on a real database by
`tests/pg/authz-read-user-id.pgtest.js` and
`tests/pg/collaborator-authz-resolution.pgtest.js`.

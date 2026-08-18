# Tenant isolation

How Deckyard keeps one customer's decks away from another's, and which
deployment shapes are supported. Verified against HEAD on 2026-07-23; hosting
shapes and roadmap updated 2026-07-25; the request-to-organization binding
updated 2026-07-25; the organization UI completed and written up 2026-07-31;
rewritten for one storage backend on 2026-08-03.

## The supported model: the tenant boundary is the infrastructure

Deckyard's hosting story has four shapes:

1. **Sandbox / playground** (`SANDBOX_MODE`, e.g. `sandbox.deckyard.eu`) —
   anonymous, throwaway, one shared instance. Isolation model below.
2. **Self-hosted** — one operator runs one instance for their own use.
3. **Dedicated customer instance** — a manually provisioned, per-customer
   deploy with its **own process and its own database**. Requested via the
   contact form or as an upgrade path from sandbox/self-host. Available as
   managed hosting: you run it, or we run it for you.
4. **Multiple organizations on one instance** (`MULTI_ORG_ENABLED`) —
   **in development**, see below. Isolation is enforced in code (every query is
   scoped by `organization_id`) rather than by infrastructure, which is what
   the PostgreSQL storage layer provides.

Shapes 1-3 run in the default **single-organization** mode
(`MULTI_ORG_ENABLED` unset). Their isolation guarantee is
**infrastructural**: each customer gets a separate deploy and a separate
database, not a code-level partition of one shared backend. That remains the
strongest isolation Deckyard offers, and it is the default recommendation.

### There is no shared multi-tenant SaaS, and none is planned

A fully automated, self-serve, **shared multi-tenant SaaS with billing** is
**not** on the roadmap — this is a decision (2026-07-25), not a deferral. There
are no subscriptions, no payment integration and no self-serve signup in this
codebase, and none are planned; that layer lives outside Deckyard. Do not
reintroduce it, and do not treat its absence as an unfinished gap.

Shape 4 is easy to confuse with that, so to be explicit: **multi-organization
support is a structuring feature, not a commercial one.** It exists so one
managed instance can serve several distinct organizations that each need their
own themes, members and decks. It carries no notion of plans, seats or payment.

### Why single-org is safe today

In single-org mode there is exactly one organization per instance
(`getDefaultOrganizationId()`, `00000000-0000-0000-0000-000000000001`). Every
authenticated user belongs to that one org, so there is no second tenant for a
deck to leak to. A cross-org gap — a read that does not check the organization —
only bites when a single backend serves **more than one** organization, which
single-org mode, by definition, never does.

Concretely, on a dedicated instance:

- All decks live under one org. `canReadPresentation` granting every
  authenticated user read access to `visibility: 'organization'` decks
  (`server/utils/presentation-authz/presentations.js`) is intended organization
  sharing, not a leak — the organization *is* the single tenant.
- Private decks stay owner-scoped (email-keyed ownership check in the same
  file), so users on the instance still can't read each other's private decks.

## The storage layer enforces the boundary

Putting **two organizations on one instance** (`MULTI_ORG_ENABLED`) only
holds if the storage layer partitions on the organization. PostgreSQL — the only
storage backend — does: every presentation query is scoped by `organization_id`
(`server/storage/presentations/index.js`), and in multi-organization
mode the org is resolved per request from the session, verified against
membership (`server/utils/context.js`, see below). A cross-org read returns
nothing. The session is the *only* resolution path: the hostname says nothing
about which organization a request acts in (see "Why not the hostname" below).

This used to be a real footgun. The old disk-JSON store (`STORAGE_MODE=file`) had
no org dimension at all — decks lived flat in one directory and listings never
consulted the org — so two tenants sharing one saw each other's organization decks.
The server **failed closed at boot** against that combination, in a
`multiOrganizationStorageError()` guard that lived in
`server/config/features.js`. The file
backend was removed in 1.x and the guard went with it: with one isolating
backend it had no case left to catch, and a guard that can never fire is a
claim the code no longer makes. `STORAGE_MODE` now accepts a single value, and
anything else stops the boot with an explanation (`storageModeError()` in
`server/config/database.js`).

Sandbox mode was exempt from that guard and is still single-org by construction
(see below), so there is no second tenant to leak to there either.

## Which domains partition on the organization

Decided 2026-08-04. Until then this choice was implicit in the comments of
migrations 058–061, which deliberately dropped `organization_id` from the
domains they moved to Postgres. Three rules now say which tables carry an
organization and which never will:

- **R1 — Content and content containers are organization-scoped, hard.**
  Presentations, slides, themes, slide libraries, collections, tags, comments:
  every query filters on the organization, and `server/storage/scope.js`
  refuses a call that states neither an organization nor a reason it cannot
  have one.
- **R2 — Content descendants inherit the organization through their FK chain
  and carry no organization column of their own.** The live stack
  (live-sessions, interactions, questions, feedback), analytics, the
  share-link access log and API usage all reach the organization via the row
  they hang off (`session_id` → `present_sessions.presentation_id` →
  `presentations.organization_id`; `api_key_id` → `api_keys.organization_id`).
  A second copy of the organization on those tables could only drift, so
  adding one is a defect, not diligence. A column that exists but is never
  filtered on is the same defect in another shape: it either becomes real
  (filled from the session, filtered everywhere) or it goes. Reads that cross
  organizations exist only on the token-authorized paths
  (`crossOrganizationScope`).
- **R3 — Instance machinery is instance-global, enumerated by name.** The
  closed list: `app_settings`, `user_settings` (keyed per person — one set of
  preferences however many organizations they join), `email_templates` and its
  settings row, the share-link TTL sweep, and the sandbox cleanup. A new
  domain must justify itself under one of these three rules; "the migration
  dropped the column" is not a rule.

Four edge decisions taken with the rules:

1. **`app_settings.defaultThemeId` / `enabledThemes` point at
   organization-scoped theme rows.** Accepted as instance policy for now;
   moving exactly these two keys to per-organization settings is a named
   leftover for when shape 4 goes GA.
2. **Email templates stay instance-global** — the operator sends the mail.
   Revisit at shape-4 GA together with 1.
3. **Follow codes share one instance-wide keyspace.** Accepted: a code is a
   short-lived public token (24h TTL), and the token is the authorization; it
   needs no organization column.
4. **The RSS/Atom/JSON feed has no organization source at all** and therefore
   serves the default organization. Under multi-organization that is wrong: the
   feed and its autodiscovery links are disabled (404 / omitted) while
   `MULTI_ORG_ENABLED` is set, until a per-organization or per-author
   feed is designed.
5. **`presentation_collaborators.organization_id` is a denormalized copy of the
   deck's organization, and no authorization read filters on it.** A
   collaborator row is addressed by `(presentation_id, user_email)` — unique
   since migration 010 — and a presentation id is a globally unique uuid, so
   the deck already *is* the scope; an organization in the filter cannot
   narrow the answer, only make it wrong when the two disagree. That is the R2
   "second copy could only drift" hazard, and it drifted: the write path
   stamped the *inviter's session* organization, so an invite sent from
   another organization produced an inert grant. The column is kept rather than
   dropped because the per-user listing (`listPresentationsSharedWithUser`,
   "shared with me") is scoped by person and has no deck to derive an
   organization from, and its index rests on the column. It cannot drift any
   more: `addCollaborator` reads the stamp off the presentation, migration 064
   re-stamped the history, and `tests/collaborator-cross-org-endpoints.test.js`
   fails any call site that passes a scope back in. **Open:** whether "shared
   with me" *should* be organization-scoped is a product question about what that
   list means across organizations, and is the only thing keeping this column
   from being removable outright.
6. **The share-link access log is addressed by the link, and takes no
   context.** `share_link_access_log` rows hang off one
   `presentation_share_links.id`, itself a globally unique uuid, so the link
   identifies the organization on its own — the same reasoning as decision 5.
   Both functions in `server/storage/share-links/access-log.js` used to accept
   a context parameter and ignore it, a check the signature promised and never
   performed; the parameter is gone rather than made real. Authorization sits
   with the caller, which is where it already was: the management route
   authorizes the presentation (`withPresentationAuth`) and then binds the link
   id to it through the organization-filtered `getShareLinkById`, before any
   viewer IP or user-agent is read.
7. **`view_sessions` carries no organization column, and GDPR self-service is
   scoped by person.** The column existed from migration 014 and was never
   trustworthy: the public tracking route stamped it from
   `body.organizationId` — an organization the viewer's browser claimed —
   while its only reader, the GDPR export/erasure pair, filtered on the
   authenticated caller's organization. Under multi-organization those never
   matched, so an erasure deleted nothing and still answered "Your analytics
   data has been deleted" (found in #627). R2 decides it: the session inherits
   its organization from `presentation_id`, so the column goes (migration 065),
   and with it the client-supplied field on `POST /api/track/session/start`.
   The export and erasure now match one email address across the whole
   instance — the data subject is the scope, the organization plays no part,
   consistent with `user_settings` being keyed per person under R3. The same
   route deliberately does **not** accept a `deviceId`: the full device id of
   every session is handed to anyone with read access to the deck
   (`GET /api/presentations/:id/analytics/sessions`), so it authorizes nothing,
   and accepting it would let a deck owner export or erase a viewer's
   cross-deck history. A viewer tracked only by device therefore has no
   self-service route until there is a proof-of-possession mechanism —
   tracked as its own item, not left implied by a dead parameter.

**Implementation status (2026-08-04):** the rules above are normative and the
code now matches them on every point the decision named. Remaining: the feed
gating from decision 4, and the product question left open in decision 5. One
consequence is tracked separately — with the client-claimed organization gone,
the tracking route has no server-known signal for "internal viewer", so
`view_sessions.is_internal` is always false and the internal/external filters
in the analytics dashboard have nothing to separate.

## Sandbox isolation (`sandbox.deckyard.eu`)

Sandbox mode is safe to expose publicly. Its isolation rests on four things:

- **Separate storage roots.** Data and uploads live under `SANDBOX_DATA_DIR` /
  `SANDBOX_UPLOADS_DIR` when set (`server/config/storage-paths.js`), keeping
  sandbox content off any real install's disk.
- **Per-guest unguessable identity.** Each visitor gets a random UUID in the
  `sb_sandbox` cookie, mapped to a synthetic email
  `guest-<uuid>@sandbox.local` (`server/auth/sandbox.js`). A guest's private
  decks are owned by that email, and the private-visibility authz check is
  email-keyed, so one guest cannot read another's private decks without knowing
  their random UUID.
- **Organization decks are intentionally shared, read-only seed content.** In
  sandbox mode `canWritePresentation` returns `false` for organization visibility and
  `canChangePresentationVisibility` blocks guest-to-guest sharing
  (`server/utils/presentation-authz/presentations.js`), so the shared surface
  is the curated demo decks only, and guests cannot mutate them or promote
  their own decks into the shared space.
- **TTL cleanup.** Non-organization (guest) decks are ephemeral and expire after
  `SANDBOX_TTL_HOURS` (`server/storage/presentations/sandbox.js`), so a guest's
  content does not accumulate or persist indefinitely.

No persistent cross-session leak was found: private decks are isolated by an
unguessable per-guest identity, and the only shared decks are the
read-only curated seed set.

## In development: shape 4 (multiple organizations on one instance)

*(This section replaced an "out of scope, parked" note on 2026-07-25. That note
said the identity and org-filtering work belonged to a future SaaS track. That is
no longer true: the work is active, and it is not for a SaaS.)*

Two pieces had to be built before one managed instance could serve several
organizations, and a UI on top of them. All three are in place; what is still
missing is listed under *What is not done yet* below.

- **Organisation-independent identity — done.** Authentication resolves a person
  by their globally unique `users.email`, with no organization filter, through
  `getUserByEmailGlobal()` in `server/storage/identity.js`. Which organization a
  session may act in is a separate question, answered by
  `resolveActiveOrganization()`: configuration only in single-organization mode
  (no database access), and membership-verified against `user_organizations` in
  multi-organization mode. A session whose organization membership was revoked
  falls back to the person's oldest remaining membership; someone with no
  membership at all is refused. `users.organization_id` survives as the *home*
  organization — where a person lands without a session organization, and where
  newly created rows go — not as the authority on where they may work.

  Lookups that ask "who is this?" are organization-independent; lookups that ask
  "who is in this organization?" (`server/storage/users.js`, the member lists,
  `created_by` resolution) keep their organization filter.
- **The request-to-organization binding — done.** `createStorageScope()`
  (`server/utils/context.js`) puts the session's resolved organization on the
  context, and every storage query that is given that context scopes on it via
  `getOrgId(ctx)`. So a request acts in the organization the person switched to:
  their own decks are visible, another organization's are not, and new decks
  are created where they are working.

  What may reach a query is only ever a membership-verified organization. The
  value comes from `getUserFromRequestAsync`, i.e. from
  `resolveActiveOrganization()`, not from the raw `orgId` claim in the cookie.
  The synchronous `getUserFromRequest` skips that verification by design and
  flags itself `_needsDbValidation`; such a user's organization is ignored when
  the context is built. Precedence is: explicit `options.organizationId` (used
  by the few callers that name an organization themselves) → the session's
  resolved organization → a last resort that depends on whether anyone is
  authenticated at all.

  That last resort is the difference between a stated absence and a lost value.
  A context built with **no user** — password reset, magic link, SSO, email
  templates — runs before there is a session to resolve, passes `null`
  explicitly, and takes the default organization. A context built **with** a
  user who nonetheless carries no verified organization (only the unverified
  synchronous path produces one) takes **nothing** once the instance holds more
  than one organization: handing it the default organization would let a session
  act in an organization it was never resolved to, so `getOrgId()` refuses the query
  instead. Single-organization installations keep the default in both branches,
  where it is the only organization and therefore not a guess.

  Single-organization installations are unaffected in behaviour and in cost:
  there `resolveActiveOrganization()` answers from configuration without
  touching the database, so the session's organization *is* the default one.
  Pinned by `tests/request-organization-binding.test.js` (single-organization,
  including query-log assertions that no extra lookup is issued) and
  `tests/request-organization-binding-multi-org.test.js` (two organizations on
  one instance, walking session cookie → context → Postgres adapter).

- **The organization-aware authorization layer — done.**
  `server/utils/presentation-authz/presentations.js` used to return `true` for
  `visibility: 'organization'` unconditionally, so as far as authorization was
  concerned every authenticated person was a member of every organization. The
  four organization grants (read, write, comment, effective permission) now pass
  through `isSameOrganization(user, pres)`: the session's membership-verified
  organization compared against the organization on the presentation, which
  `mapPresentationRow` carries off the row being read anyway.

  This is defense in depth, not a leak that was open: it narrows only the grant
  that rested on "we are in the same organization". Grants that rest on a relation
  to the deck itself — ownership, authorship, a collaborator row — fall through
  untouched, and the unrestricted operator of an auth-disabled install is
  unaffected. In multi-organization mode an organization that cannot be read on
  either side is refused rather than waved through.

  The collaborator lookup that feeds these checks takes no organization at all
  (edge decision 5 above): it answers "what does this email hold on this deck",
  while whether the session may see the deck is settled one layer up by
  `getPresentation` on an organization-carrying storage scope. A deck in
  another organization is therefore *absent* on every session path — 404, not 403
  — before a collaborator row is ever read, and no collaborator row can become
  a way around the organization filter.

  Single-organization installations are unaffected in behaviour and in cost:
  there is one organization, so `isSameOrganization()` answers `true` from the
  feature flag without reading anything, and the organization arrives on a row
  the query already fetched. Pinned by `tests/authz-organization-scope.test.js`
  (single-organization, including query-log assertions) and
  `tests/authz-organization-scope-multi-org.test.js` (two organizations; six of
  its assertions fail without the check).

  Machine-client surfaces now carry a real organization too: an API key row
  holds `organization_id`, so the public API and MCP-over-SSE act in the
  organization their key belongs to rather than the default one. An MCP session
  over stdio has no key and no organization — it is a trusted local process
  bound to the instance — so it takes the single organization and refuses to guess
  once an instance holds several.

  **The authorization check follows the same organization as the storage scope.**
  It did not, for a while: `checkActorAccess` built its actor with the
  organization read off *the presentation being checked*, which made the
  organization grant unconditional for machine clients — whatever organization a deck
  was in, the key appeared to be in it. Every entry point in
  `server/utils/presentation-authz/actor-access.js` now takes an **actor**
  (`{ email, organizationId }`) instead of a bare email, and both call sites
  supply the organization they already act in: the public API from
  `ctx.authedUser` (built from the key row), MCP from its own session scope. An
  actor that states no organization fails the organization grant closed under
  multi-organization, and is unaffected in a single-organization install, where
  `isSameOrganization()` answers yes from the feature flag. Grants that rest on
  a relation to the deck — ownership, a collaborator row — never consult the
  organization and are unchanged either way. Pinned in
  `tests/authz-organization-scope-multi-org.test.js` (the actor of another
  organization is refused, the deck's own organization still granted, no organization
  stated fails closed) and in the collaborator pgtest, where a collaborator
  signed into a foreign organization still gets in.

- **The storage layer has no default to fall back on — done.** The storage
  facades used to build their own context with a hardcoded
  `getDefaultOrganizationId()`, so every route that loads a deck before
  authorizing it read out of the default organization rather than the one the
  session was working in. The same defect sat in the seven smaller facades
  (`slide-library`, `slide-library-usage`, `published`, `tags`,
  `presentation-ydocs`, `collections`, `image-library`) — and in `tags` and the
  image favorites it was sharper still, because those functions took no scope
  argument at all, so a caller had no way to state an organization even if it
  wanted to. Every one of them now takes a **storage scope** as its first
  argument — which organization, and on whose behalf — and
  `server/storage/scope.js` refuses anything
  that states neither an organization nor a reason it cannot have one. There is
  no fallback left: a caller that gives nothing gets a `TypeError`, not a guess.

  Sessions get their scope from `createStorageScope()`, built once per request in
  `server/routes/api/index.js` and carried on the same parameter bag that already
  carried `repoRoot`, so route handlers pass the scope they were given.

  Three kinds of caller genuinely have no session, and each says so explicitly:

  - **A public token is the authorization.** A published deck, an embed, a share
    link, a follow-along audience and the public feed resolve a globally unique
    token first (`getPublishedById`, `getShareLinkByToken`, the follow code) and
    fetch the deck by the id that lookup yielded. Those declare
    `crossOrganizationScope(repoRoot, '<reason>')`, which skips the organization
    filter — necessary, because filtering them on an organization nobody stated
    would 404 every public link the moment an instance holds two organizations.
    The reason string is mandatory, so `grep -r crossOrganization` lists every
    deliberately unscoped read. **Reads only**: a scope with no organization
    cannot reach a write or a listing, because an unscoped write would land
    wherever the storage layer guessed.
  - **Queued work.** Export and translate jobs run detached from the request that
    queued them, so the organization travels in the job payload (`jobScope`).
  - **Instance-bound entry points.** The stdio MCP server and bulk export have no
    organization to belong to; `singleOrganizationScope()` answers with the configured
    organization in single-organization mode and throws in multi-organization mode,
    where "the default one" has stopped being an answer.

  Collaborative editing sits between the two: the Hocuspocus hooks run outside
  any request, so the document's organization is recorded when the connection is
  authorized (`authorizeDocument` has the deck in hand) and read back by the
  persistence hooks, which is what lets a collab store write into the deck's own
  organization.

  Where the check sits matters as much as the check. Every facade validates the
  scope in `toStorageContext()` **before** touching the adapter, so an
  un-migrated caller fails on the validation, not somewhere inside a query.

  Single-organization installations are unaffected in behaviour: there the
  session's organization *is* the default one, so every scoped call resolves to
  the value it did before. Pinned by `tests/storage-scope-contract.test.js` (the
  rule itself, for every facade function) and
  `tests/storage-scope-multi-org.test.js` (two organizations through the real
  facades; assertions verified to go red when the old `getStorageContext()` is
  restored).

#### Why not the hostname

Resolving the organization from the request hostname was half-built and is now
**removed rather than finished** (subdomain extraction, the lookups by subdomain
and custom domain, a second context builder, and the `subdomain` /
`custom_domain` columns on `organizations`).

The reason is a modelling one. A hostname identifies an **instance**; an
organization is a dimension **within** an instance. Shapes 1-3 give a customer
their own hostname by giving them their own deploy — DNS, a reverse proxy and
`BASE_URL`, none of which the application needs to know about. Shape 4 puts
several organizations behind one hostname, where a host header cannot
distinguish them at all. So the hostname is either redundant or insufficient,
and using it as a claim about ownership would conflate two things that are free
to differ.

Sessions carry the answer instead, re-verified against membership on every
request. `organizations.slug` remains the stable human-readable identifier.
Pinned by `tests/organization-host-independence.test.js`, which also fails if a
write path for the removed columns comes back.

None of these affects shapes 1-3, and none is a prerequisite for them: a
dedicated instance stays safe because its tenant boundary is the deploy itself.
External email leaks were closed separately (PR #214).

### The organization UI — done

There is a screen for every organization-level thing a person can do, and each
one draws the rule its route enforces rather than a wider or narrower one:

- **Switching** — the organizations you belong to sit in the user menu, with the
  active one marked. Switching writes the session cookie and reloads the page in
  full, because a cache that survives the switch is a cross-organization leak in
  the UI rather than a performance win. The section hides itself entirely below
  two organizations, and in single-organization mode it issues no request at all.
- **Who may see an admin screen** follows the role held in the *active*
  organization (`organizationRole` on `GET /api/auth/me`), not the instance-wide
  `isAdmin`. An admin in one organization who switches into another where they
  are a plain member loses the admin surfaces with the switch. The designer
  capability works the same way: the instance-admin short-circuit in
  `server/utils/designer.js` and `canManage()` applies only when multi-organization
  is off, so in multi-organization mode the membership decides.
- **Members** — the Users tab lists the members of the active organization with
  role, designer flag and join date, paged, and carries the mutations: change a
  role, remove someone, leave, hand the organization over. It is open to every
  member, read-only below admin — a plain member's own *Leave* button lives
  there, and gating the tab on admin put it out of reach of exactly the people
  who need it.
- **Inviting** — a modal above that list. The role choice exists only for the
  owner, because the route caps an admin at `member`; the report distinguishes
  *added* (the account existed) from *invited* (a setup link went out) from
  *created* (the account was made but no mail could be sent).
- **The organization profile** — name, display name, description and logo, with
  deletion for the owner. Readable by every member, writable by admin and owner,
  and deletion asks the owner to type the organization's name: `organizations`
  is the parent of nearly every table with `ON DELETE CASCADE`, so that one
  click takes the whole organization with it for everyone in it.

The admin Users routes act in the session's organization as well
(`routes/api/admin-users.js`); the last `getDefaultOrganizationId()` there, which
listed and wrote against the instance default no matter which organization the
admin had switched into, is gone. Pinned by
`tests/admin-users-organization-scope.test.js`.

### What is not done yet

- **Ownership and access control still key on email strings**, not on
  `users.id`. Every authorization decision in
  `server/utils/presentation-authz/` compares `pres.ownerEmail` / `pres.createdBy`
  against the session's email, and the collaborator, comment and lock tables do
  the same. That is a decoupling epic of its own, not organization work, and it
  is what stands between the current state and pointing two *unrelated*
  customers at one instance. The narrow leaks it started from were closed
  separately (PR #214).
- **`AUTH_DEV_BYPASS` and multi-organization do not mix.** The bypass pins
  `organizationId` on the default organization and ignores the session cookie
  (`server/auth/auth.js`), so there is no membership to read a role or a designer
  flag from. Every organization-dependent flow therefore needs a real login to
  verify locally; a bypass session in multi-organization mode sees the designer tabs
  disappear.

Shape 4 stays *in development* on those grounds, not on missing UI: the
isolation it offers is code-enforced, and the identity epic above is the
remaining structural gap. Shapes 1-3 are unaffected — their tenant boundary is
the deploy itself.

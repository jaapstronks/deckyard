# The storage call convention: one scope, first parameter

**Normative target (decided 2026-08-06).** Every exported function under
`server/storage/**` that touches storage takes a single authorization
envelope — a `StorageScope` — as its **first** parameter, named `scope`, and
validates it before doing anything else:

```js
import { toStorageContext } from './scope.js';

export async function listComments(scope, presentationId, opts = {}) {
  const context = toStorageContext(scope, 'listComments');
  // … adapter calls use `context`
}
```

That is the whole convention. The rest of this document says precisely what a
scope is, why the position is load-bearing, which six functions are exempt,
and where the convention's boundary lies.

## What a `StorageScope` is

`{ organizationId, actorEmail, repoRoot }` — built once per request by
`createStorageScope()` (`server/utils/context.js`) and passed down; defined
and validated in `server/storage/scope.js`. Entry points without a request
build one through the dedicated constructors: `jobScope()` for queue workers,
`singleOrganizationScope()` for MCP/stdio, `crossOrganizationScope()` for
operations that genuinely cannot be organization-scoped (next section).

## When a scope may be cross-organization

A function that validates with `allowCrossOrganization: true` accepts a
`crossOrganizationScope(repoRoot, reason)` — a scope that deliberately states
no organization. Five categories are legitimate; everything else needs an explicit
boundary decision:

1. **Token-authorized reads** — a globally unique token (publish id, share
   token, follow code) was already resolved, and the deck id came _out_ of
   that lookup.
2. **Session-capability audience interactions** — the live session id or
   follow code _is_ the authorization, and the rows are keyed by session, not
   organization. This covers the anonymous audience _writes_ too (Q&A
   submissions, poll/likert votes, feedback): the tables have no organization
   column, so an organization filter has nothing to bind to.
3. **Instance-level configuration** — `app_settings`, `user_settings` and
   `email_templates` are per-instance (keyed by nothing or by user email);
   jobs and pre-auth routes read them cross-organization because an
   organization never enters the query.
4. **Instance-wide aggregates for the instance admin** — the instance-health
   census (`server/storage/instance-census.js`, B516) reads organization-owned
   rows (`presentations`, `custom_slide_types`) across the instance and answers
   only counts per slide type, custom-type key or settings key: no row, no id,
   no organization and no value leaves the function. Only the route behind the
   instance-admin role (`users.role`, not a membership role) builds this scope.
   A read that hands back a row, or a count per organization, is not in this
   category.

5. **Global actor identity and explicit provisioning** — before a session has an organization, authentication resolves the instance-wide user and verifies the requested membership. The same global identity is used to name actors on already-authorized rows, including external collaborators. Operator consistency scans, organization creation and verified-login membership provisioning also need an explicit instance scope; the provisioning caller has already established operator authority or verified the login and target organization. Authentication audit rows have no organization column, so their writes and retention use a reasoned instance scope. These operations still take and validate `scope`; they are not scope-less token exceptions. An instance scope does not itself grant administrator authority.

The `reason` string is mandatory and shows up in errors — write it for the
reviewer who wonders why the call is exempt.

- `organizationId` — whose data this call may touch. Mandatory:
  `resolveScope()` throws a `TypeError` on a missing scope, a bare string, or
  a scope without an organization. It never fills in a default.
- `actorEmail` — who acts, for attribution and per-user reads.
- `repoRoot` — the repository path, carried for the few operations that also
  touch disk (uploads, thumbnails, theme files).

## Why the first position is the rule, not a style choice

Two call shapes used to coexist in the layer, and they carried **different
authorization doctrines**:

- Scope-first goes through `resolveScope()`, which _refuses_ a call without
  an organization — loudly, with a `TypeError` naming the convention.
- ctx-at-the-tail went through `getOrgId(ctx)`, which _guessed_: a missing or
  scope-less ctx silently fell back to the default organization and read
  from the wrong organization. (That fallback is gone — `getOrgId` refuses too
  now; see the boundary section below.)

A mandatory first parameter cannot be forgotten — leave it off and every
argument shifts, so `resolveScope` throws on the first request. A tail
parameter _can_ be forgotten, and back then the guessing dialect answered.
The parameter's position decides which dialect you get; that is why the
position is the contract. Reading order also follows the mental model: first
_where and on whose behalf_, then _what_.

`toStorageContext(scope, '<fnName>')` as the first statement is the safety
net for missed call sites: argument-shift bugs surface as a thrown `TypeError`
naming the function, not as an `undefined` deep inside a query.

## The six permanent exceptions

These take `repoRoot` first because they genuinely operate on a disk path —
they ask for a _path_, not a scope:

| Export                                                    | Why                                                |
| --------------------------------------------------------- | -------------------------------------------------- |
| `uploads.js :: writeUploadedFile`                         | writes uploaded bytes to disk                      |
| `uploads.js :: replaceUploadFromDataUrl`                  | rewrites an upload on disk                         |
| `boot-check.js :: strandedFileDataError`                  | migration guard inspecting `dataDir()` before boot |
| `scope.js :: crossOrganizationScope`                      | scope _builder_: repoRoot is its input             |
| `scope.js :: singleOrganizationScope`                     | scope _builder_: repoRoot is its input             |
| `presentations/crud/factory.js :: prepareNewPresentation` | reads theme files from disk via `loadThemeAssets`  |

Outside `server/storage/**`, `repoRoot` remains a perfectly legitimate
parameter (export pipeline, rendering, theme CSS, uploads); the convention's
scope is the storage layer only.

The _naming_ half of the convention reaches one layer further: a function in
`server/services/**` that carries a `StorageScope` names that parameter
`scope`, never `ctx` — a second name for the same envelope is exactly the seam
where a caller passes the wrong shape unnoticed (that mismatch is how #707
broke).

## The boundary: no organization means no answer

`getOrgId(ctx)` throws when the context carries no organization. It used to
fall back to `getDefaultOrganizationId()` — on a multi-organization instance
that turned a missing organization into a query against the _default_
organization, the tenant-isolation leak `resolveScope()` refuses in another
guise. The org-scoping fallback-sweep (#623) removed the fallback, and
`tests/get-org-id-refuses-empty-context.test.js` pins the refusal: a call
site that reaches `getOrgId` without an organization is a bug and fails
loudly, instead of silently scoping to the default organization.

That removal happened _outside_ this convention's migration, which stayed
behaviour-preserving throughout — the boundary decision (D5, 2026-08-06)
placed it there on purpose. The net result is one doctrine on both paths:
whether a call arrives scope-first through `resolveScope()` or reaches
`getOrgId()` directly, an absent organization is refused, never guessed.

## Instance telemetry takes no scope

Two tables are counters about the instance itself, keyed by nothing an
organization could own: `api_usage_daily` (quota per API key, rate limits)
and `instance_health` (which surfaces the install uses, D246 — no
organization, person or deck in the row). Their facades, `api-usage.js` and
`instance-health.js`, take **no** `StorageScope`. That is not an additional
cross-organization category: a cross-organization scope is for _reading_
organization-owned rows without a filter, and writes may never run
cross-organization outside the explicit provisioning and instance-auth-audit boundary above. Here there is no organization to state or to skip, so a
scope parameter would be ceremony that validates nothing. A new table joins
this pair only when it, too, has no organization column and no per-person
key; anything else takes a scope.

## Scope-less token operations (D331)

A globally unique presented token can be the authorization itself. The positive signature gate permits only individually registered token operations and instance telemetry, with a category and reason per export in `tests/helpers/storage-scope-exceptions.js`. There are no module-wide exemptions. Token issuance, its pre-auth abuse limits and expiry cleanup belong to the same token lifecycle. Account reads, membership selection, audit records and operations keyed by a share-link ID rather than a presented token still require a scope.

The registered token operations are API-key validation, analytics-report token lookup, anonymous view-session token lookup/update/end, password-reset and magic-link issuance/validation/consumption/expiry, public share-link validation/password checking, and guest session/email-verification token resolution. This does not remove a scope from token operations that already take one. `identity-verification.js` checks dual-key database consistency, despite its name; it is not a token-authorized identity-verification path and is not exempt.

## Enforcement and implementation status (2026-10-13)

The target above is not yet fully implemented. The current static census finds 361 DB-reaching defining exports, of which 54 still need a first parameter named `scope`. Cluster 1 renamed 67 existing scope-first DB parameters and the three pure helpers (`resolveScope`, `repoRootOf`, `toStorageContext`) from `storageScope` to `scope`, without shifting arguments or changing validation. No exported scope parameter retains the old spelling. There are 34 individually justified token/telemetry exceptions (B665). `tests/fixtures/storage-scope-inventory.json` preserves the initial census of 359 exports, signatures and direct static call sites. Scanner repairs exposed two additional lock-policy exports; `enforceSlideLocks(scope, opts)` and `enforceSlideWritePolicy(scope, opts)` now validate and forward the caller scope, with the old `opts.ctx` argument removed. These two exports add no debt to the frozen ceiling. Recount from the repository root with:

```sh
node scripts/storage-scope-inventory.js > .scratch/storage-scope-inventory.json
```

`tests/storage-call-convention.test.js` now positively requires `scope` first for DB-reaching exports, following private functions, callbacks, imported aliases, storage re-export barrels and literal lazy storage imports. The scanner recognizes query builders and database entry points; it does not prove runtime validation, organization filtering or authorization. Dynamic property dispatch and factory-returned functions are outside its static reach. Caller evidence covers the listed source roots and excludes vendor/fixture directories; it is not a census of external forks or dynamically dispatched calls. Literal lazy imports follow transitive named and export-star barrels, including cycles and database entrypoints; executable parameter initializers also contribute DB reachability. Caller collection recognizes static imports and `import('./rows.js').then(mod => mod.read())`, but does not trace bindings created by awaited imports such as `const {read} = await import('./rows.js'); read(scope)`. The enclosing storage function still counts as DB-reaching. Before migrating a signature, manually inspect awaited-import callers alongside the recorded call sites.

Existing signature debt lives in `tests/storage-call-convention-burndown.json`. Its scope-first entries must be a subset of the frozen initial census and must still name current violations: remove a row when it is fixed, never regenerate the initial fixture to accommodate new debt. The existing negative signature rules and mutation failure-shape rule (c) remain independent. The six disk-path exceptions apply only to the old `repoRoot` rule; they do not exempt DB-reaching operations from the positive gate. Infrastructure exports (database guard, lifecycle and boot checks) are recorded as debt pending a proper layer boundary, rather than receiving a new exception category.

The actor/organization/identity migration (B665 cluster 2) adds a first `scope` argument to 35 actor/organization/identity exports: eleven memberships, five organizations, five collaborators, three identity, two identity-resolver, two display-identity, one identity-verification, one login-membership and five password account/audit operations. Update direct fork calls by inserting the scope before every previous argument; no old signature or compatibility shim remains. Bootstrap scripts and authentication entry points build reasoned instance scopes before a session scope exists. Global user-id/display-name resolution remains instance-wide because a person can belong to several organizations; it does not grant access to an organization or deck.

Organization-bound membership operations require an organization scope and reject a different explicit organization argument. Membership-id-only changes filter their reads and writes by the scope organization. `listUserOrganizations` accepts an instance scope for organization selection or filters to a supplied organization. Organization reads filter to an organization scope, with explicit instance reads for operator lookup; creation requires an instance provisioning scope, while update/delete require the target organization scope. Active-membership selection, login provisioning and the instance consistency scan require explicit instance scopes. Token operations retain their individual exceptions.

Collaborator operations require the caller scope to match the parent deck's actual organization before reading a cache or collaborator row. Callers that already authorized a cross-organization collaborator derive this scope from the loaded deck; they do not reuse the visitor's active organization. Legacy collaborator organization stamps do not replace the parent deck check. A cached permission cannot authorize a wrong organization or a deleted parent deck. Existing member/collaborator permissions and authentication behavior remain subject to the caller's authorization checks.

The remaining migration clusters change signatures and callers together and require independent review (B665). The gate/inventory PR also migrates those two newly exposed lock-policy signatures and their callers; the remaining cluster migrations are separate. Outside the parameter convention, the deliberate scope homonyms remain `ownership: collection|owned|shared|all` for deck-list selection and `opts.shelf: personal|organization` for slide-library selection. During beta, obsolete signatures are removed rather than supported alongside the canonical form.

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
no organization. Four categories are legitimate; everything else is a
violation, not a fifth category waiting to be named:

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
`instance-health.js`, take **no** `StorageScope`. That is not a fourth
cross-organization category: a cross-organization scope is for _reading_
organization-owned rows without a filter, and writes may never run
cross-organization. Here there is no organization to state or to skip, so a
scope parameter would be ceremony that validates nothing. A new table joins
this pair only when it, too, has no organization column and no per-person
key; anything else takes a scope.

## Enforcement and implementation status (as of 2026-08-21)

The convention is enforced by `tests/storage-call-convention.test.js`, which
scans every export under `server/storage/**` and refuses (a) `repoRoot` as
first parameter and (b) `ctx`/`context` on any position other than 1. Existing
violations are carried in `tests/storage-call-convention-burndown.json`, an
allowlist that **only shrinks**: fixing an export deletes its line; adding a
new export in either old shape fails the suite.

**Honest status note (2026-08-13):** the migration is complete. The burndown
list is at zero (plus the six documented disk-path exceptions), the factory is
named `createStorageScope()`, route handlers pass the per-request scope down
instead of rebuilding it, and the naming pass has landed: no storage export
names its scope parameter `ctx` anymore, and the near-collision pair is now
`getThemeRecord()` (DB row, storage layer) vs `loadThemeAssets()` (theme
files, `utils/themes.js`). Two deliberate scope-homonyms remain outside the
layer's parameter convention: the MCP tool input `ownership: owned|shared|all`
(external contract) and the slide-library `opts.shelf: personal|organization`
(DB column). Nothing here promises compatibility with the old shapes: during beta
they are removed, not tolerated (`docs/reference/versioning.md` § the beta
stance).

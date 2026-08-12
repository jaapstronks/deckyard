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
`createRouteContext()` (`server/utils/context.js`) and passed down; defined
and validated in `server/storage/scope.js`. Entry points without a request
build one through the dedicated constructors: `jobScope()` for queue workers,
`singleOrganizationScope()` for MCP/stdio, `crossOrganizationScope()` for
operations that genuinely cannot be organization-scoped (next section).

## When a scope may be cross-organization

A function that validates with `allowCrossOrganization: true` accepts a
`crossOrganizationScope(repoRoot, reason)` — a scope that deliberately states
no organization. Three categories are legitimate; everything else is a
violation, not a fourth category waiting to be named:

1. **Token-authorized reads** — a globally unique token (publish id, share
   token, follow code) was already resolved, and the deck id came *out* of
   that lookup.
2. **Session-capability audience interactions** — the live session id or
   follow code *is* the authorization, and the rows are keyed by session, not
   organization. This covers the anonymous audience *writes* too (Q&A
   submissions, poll/likert votes, feedback): the tables have no organization
   column, so an organization filter has nothing to bind to.
3. **Instance-level configuration** — `app_settings`, `user_settings` and
   `email_templates` are per-instance (keyed by nothing or by user email);
   jobs and pre-auth routes read them cross-organization because an
   organization never enters the query.

The `reason` string is mandatory and shows up in errors — write it for the
reviewer who wonders why the call is exempt.

- `organizationId` — whose data this call may touch. Mandatory:
  `resolveScope()` throws a `TypeError` on a missing scope, a bare string, or
  a scope without an organization. It never fills in a default.
- `actorEmail` — who acts, for attribution and per-user reads.
- `repoRoot` — the repository path, carried for the few operations that also
  touch disk (uploads, thumbnails, theme files).

## Why the first position is the rule, not a style choice

Two call shapes used to coexist in the layer, and they carry **different
authorization doctrines**:

- Scope-first goes through `resolveScope()`, which *refuses* a call without
  an organization — loudly, with a `TypeError` naming the convention.
- ctx-at-the-tail goes through `getOrgId(ctx)`, which *guesses*: a missing or
  scope-less ctx silently falls back to the default organization and reads
  from the wrong workspace.

A mandatory first parameter cannot be forgotten — leave it off and every
argument shifts, so `resolveScope` throws on the first request. A tail
parameter *can* be forgotten, and then the guessing dialect answers. The
parameter's position decides which dialect you get; that is why the position
is the contract. Reading order also follows the mental model: first *where and
on whose behalf*, then *what*.

`toStorageContext(scope, '<fnName>')` as the first statement is the safety
net for missed call sites: argument-shift bugs surface as a thrown `TypeError`
naming the function, not as an `undefined` deep inside a query.

## The six permanent exceptions

These take `repoRoot` first because they genuinely operate on a disk path —
they ask for a *path*, not a scope:

| Export | Why |
| --- | --- |
| `uploads.js :: writeUploadedFile` | writes uploaded bytes to disk |
| `uploads.js :: replaceUploadFromDataUrl` | rewrites an upload on disk |
| `boot-check.js :: strandedFileDataError` | migration guard inspecting `dataDir()` before boot |
| `scope.js :: crossOrganizationScope` | scope *builder*: repoRoot is its input |
| `scope.js :: singleOrganizationScope` | scope *builder*: repoRoot is its input |
| `presentations/crud/factory.js :: prepareNewPresentation` | reads theme files from disk via `loadTheme` |

Outside `server/storage/**`, `repoRoot` remains a perfectly legitimate
parameter (export pipeline, rendering, theme CSS, uploads); the convention's
scope is the storage layer only.

## The boundary: the org fallback stays, for now

Inside the layer, `getOrgId(ctx)` still falls back to
`getDefaultOrganizationId()` when a scope states no organization. Removing
that fallback is a *behaviour* change that depends on the open A1 question of
which domains may be org-blind — it is explicitly **not** part of this
convention's migration, which is behaviour-preserving throughout. Until A1
lands, moving a function to scope-first changes its signature and adds the
type check, but `getOrgId` keeps answering inside.

## Enforcement and implementation status

The convention is enforced by `tests/storage-call-convention.test.js`, which
scans every export under `server/storage/**` and refuses (a) `repoRoot` as
first parameter and (b) `ctx`/`context` on any position other than 1. Existing
violations are carried in `tests/storage-call-convention-burndown.json`, an
allowlist that **only shrinks**: fixing an export deletes its line; adding a
new export in either old shape fails the suite.

**Honest status note (2026-08-12):** the layer is mid-migration. The burndown
list started at 163 lines (160 exports; three carry both violations). Exports
whose scope parameter is correctly positioned but still *named* `ctx` ride
along in the final naming pass, together with the rename
`createRouteContext` → `createStorageScope`. Nothing here promises
compatibility with the old shapes: during beta they are removed, not
tolerated (`docs/reference/versioning.md` § the beta stance).

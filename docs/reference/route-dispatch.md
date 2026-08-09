# Route dispatch: the `ROUTES` table

The canonical form for an `/api/*` route module is a declarative `ROUTES`
table dispatched through `dispatchRoutes(ROUTES, ctx)`
(`server/utils/router.js`). A module declares which method + path each handler
answers, and the shared dispatcher walks the table top to bottom. This replaces
the hand-rolled `if (url.pathname === … && req.method === …)` chains that grew
one per module.

> **Implementation status (2026-08).** The shared dispatcher and the two named
> context typedefs exist and are the norm (A7.19 C8, #674/#675). The per-module
> migration off the if-chains is in progress: `presentations.js` and `ai.js` are
> converted, the small modules are being migrated batch by batch, and a guard
> test that fails a hand-written path compare outside a `ROUTES` table is the
> closing gate (fase 3, not yet landed). Until that gate lands, both forms exist
> in the tree — the table is the target every touched module moves to, not a
> promise that every module already uses it.

## The `Route` shape

```js
/** @type {import('../../utils/router.js').Route[]} */
const ROUTES = [
  { method: 'GET', pattern: '/api/things', handler: handleThingList },
  { method: 'POST', pattern: '/api/things', handler: handleThingCreate },
  { pattern: /^\/api\/things\/([a-f0-9-]+)$/, handler: handleThingItem },
];

export function handleThings(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
```

- **`method`** (optional): the HTTP method this route requires. Omit it to match
  any method (see *405* below).
- **`pattern`**: either an exact pathname string (exact match, no prefix match)
  or a `RegExp`. A `RegExp`'s capture groups are passed to the handler as
  trailing positional arguments: `handler(ctx, ...match.slice(1))`.
- **`handler`**: `(ctx, ...params) => unknown`. Its return value is the
  dispatcher's return value; a truthy value means *handled*.

`dispatchRoutes` returns the matched handler's result, or `false` when nothing
matches — so the caller in `routes/api/index.js` can fall through to the next
mount.

## First-match semantics

The table is walked **in order**, and the first route whose method and pattern
both match wins. Order is therefore **behaviour, not layout**:

- `/api/things/search` must come **before** `/^\/api\/things\/([^/]+)$/`, or the
  `:id` pattern swallows `search`.
- A migration copies the previous if-chain's order **line for line**. Do not
  alphabetize, group by method, or "tidy" the order — a reordered table is
  silently wrong (the wrong endpoint answers with a `200`).

## A method mismatch falls through — it is not a 405

When a route carries a `method` and the request's method differs,
`dispatchRoutes` **continues to the next route**. It does not send a `405`. This
matches the matcher that grew inside `presentations.js`, and it is what makes
overlapping tables composable.

Many hand-written if-chains, though, *did* send a `405` for a matched path with
the wrong method (`if (pathname === X) { …; return methodNotAllowed(res, […]) }`).
That behaviour is part of the module's contract and **must be preserved** across
the migration. There are two faithful forms; pick per path based on what the
original did.

### Form A — method in the table (the original fell through)

If the original returned nothing / `false` on a method mismatch (the request
falls through to the next mount, ending in a `404`), declare one
method-bearing route per method and let `dispatchRoutes` fall through:

```js
const ROUTES = [
  { method: 'GET', pattern: '/api/tags', handler: handleTagList },
  { method: 'POST', pattern: '/api/tags', handler: handleTagCreate },
];
```

A `DELETE /api/tags` matches neither and falls through to `false`, exactly as
the original did.

### Form B — an explicit 405 route (the original returned 405)

If the original sent a `405` for that path, add an explicit catch-all route
(no `method`) **immediately after** that path's method-bearing routes. Because
`dispatchRoutes` walks in order, the method-bearing routes claim the methods
they serve and any other method reaches the catch-all:

```js
const ROUTES = [
  { method: 'GET', pattern: '/api/settings/app', handler: handleAppSettingsGet },
  { method: 'PUT', pattern: '/api/settings/app', handler: handleAppSettingsPut },
  { pattern: '/api/settings/app', handler: (ctx) => methodNotAllowed(ctx.res, ['GET', 'PUT']) },
];
```

The catch-all makes the `405` a **visible, greppable row** rather than an
implicit branch — and keeps the method column meaningful.

### When a guard runs *before* the method check

Some paths run an authorization/feature guard before deciding the method
(`if (!authedUser?.email) return unauthorized(res); if (req.method !== 'GET') …`).
A trailing catch-all `405` would answer such a request with a `405` where the
original answered `401`. For those paths, keep the whole path as a **single
no-method handler** that runs guard → method → `405` verbatim:

```js
{ pattern: '/api/settings/me', handler: handleMySettings }, // guard, then method, then 405 inside
```

This is a deliberate, documented exception to Form B — used only when a guard
legitimately precedes the method decision, not as a default.

## The prefix guard stays

A module that gated itself with a prefix check keeps that check — put it in the
entry function, before `dispatchRoutes`:

```js
export function handleDataSources(ctx) {
  if (!ctx.url.pathname.startsWith('/api/data-sources')) return false;
  if (!ctx.authedUser) return unauthorized(ctx.res);
  if (!isLiveDataEnabled()) return forbidden(ctx.res, '…') ?? true;
  return dispatchRoutes(ROUTES, ctx);
}
```

The prefix guard is not decoration: without it, every module's table is walked
on every `/api/*` request, and a stray pattern could claim a path another module
owns. Module-wide guards (prefix, auth, feature flag) that apply to **all** of a
module's paths belong in the entry function; per-path guards belong in Form B.

## Context: `PublicContext` before the gate, `AuthedContext` after

`routes/api/index.js` mounts modules in two phases around the authentication
gate. The two context shapes are named typedefs in `server/utils/context.js`:

- **`PublicContext`** — `{ repoRoot, req, res, url }`. Handed to modules mounted
  **before** the gate (login, password reset, magic link, SSO, and the public
  follow/share/analytics endpoints). There is no resolved user and no storage
  scope yet.
- **`AuthedContext`** — `PublicContext & { storageScope, authedUser }`. Handed
  to modules mounted **after** the gate. The gate resolves and capability-
  enriches the user once and builds the storage scope once.

**The rule (A7.19 C8, decision B3b): a handler mounted after the auth gate
receives an `AuthedContext` and never calls `getUserFromRequestAsync` itself.**
Re-resolving the user drops the enrichment the gate added (`isDesigner`,
`canEditCustomHtml`) and the `storageScope`, and costs an extra round-trip. Read
`authedUser` and `storageScope` off the context.

## Testing a migrated module

Each migration ships a dispatch test that exercises **every path in the table,
with the right method and a wrong one**, without invoking storage. The pattern
(see `tests/*-route-dispatch.test.js`):

1. The module exports its `ROUTES` table (a named export) so the test can assert
   routing directly.
2. A local `select(routes, method, pathname)` mirrors `dispatchRoutes`' matching
   and returns the matched route. For each expected endpoint, assert
   `select(ROUTES, method, path)?.handler` is the expected named handler — this
   pins method, pattern **and** first-match order in one assertion.
3. For a wrong method on each path, invoke the module's entry function and assert
   the documented outcome: `false` (Form A, falls through) or status `405`
   (Form B). Both are storage-free — a method mismatch never reaches the real
   handler, and the `405` branch returns before any storage call.
4. An unknown sub-path returns `false`.

## The closing gate (fase 3)

Once the modules are migrated, a guard test fails on any
`url.pathname === …` / `.match(…)` / `.startsWith(…)` in `server/routes/**`
outside a `ROUTES` table (with an allowlist for the deliberate exceptions —
notably the public follow-code check in `routes/api/index.js`, which is
security-sensitive and migrates under its own review). That gate is what keeps
the table the single dispatch form instead of one canonical form beside 232
hand-written compares.

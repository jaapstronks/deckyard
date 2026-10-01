/**
 * Shared first-match route dispatcher for the route modules under
 * `server/routes/`: `/api/*`, the public `/api/v1/*` and the static viewers.
 *
 * The canonical dispatch form (A7.19 C8, decision B3a): a module declares a
 * `ROUTES` table and calls {@link dispatchRoutes}, rather than hand-rolling its
 * own matcher loop. The table is the only shape that can later be checked
 * against `docs/openapi.yaml` and the MCP tool list programmatically.
 *
 * Extracted verbatim from the matcher that grew inside
 * `routes/api/presentations/index.js` — the behaviour is unchanged, only shared.
 */

import { isFeatureEnabled } from '../config/flags-snapshot.js';
import { countInstanceHealth } from '../storage/instance-health.js';
import { notFound } from './http.js';
import { isUuid } from './uuid.js';

/**
 * What one capture group of a route's pattern holds.
 *
 * - `'uuid'` — the segment names a row in a Postgres `uuid` column. The
 *   dispatcher shape-checks it and answers `not_found` when it cannot be a
 *   uuid; see {@link Route.captures}.
 * - `'text'` — anything the URL allows. The dispatcher does not check it; the
 *   handler owns its meaning (an e-mail address, a slide id, a locale).
 *
 * Two values, deliberately: the dispatcher's only question is whether the
 * segment may reach a `uuid` column. Everything finer belongs to the handler.
 *
 * @typedef {'uuid'|'text'} CaptureKind
 */

/**
 * A single declarative route.
 *
 * @typedef {object} Route
 * @property {string} [method] - HTTP method to require; omit to match any method.
 *   A method mismatch falls through to the next route (it is not a 405 here).
 * @property {string|RegExp} pattern - Exact pathname (string) or a pattern whose
 *   capture groups become trailing positional handler arguments.
 * @property {CaptureKind[]} [captures] - What each capture group of `pattern`
 *   holds, one entry per group, in the order the handler receives them
 *   (A7.19-C7h, B222/B360).
 *
 *   A row declares **what** it captures, not how many of its segments are
 *   checked: storage queries Postgres `uuid` columns with a captured id
 *   verbatim, so a non-uuid value leaves the uuid parser as a 22P02 — a 500 —
 *   before any reason mapping. A value that cannot be a uuid cannot name a
 *   row, so the honest answer is `not_found`, given here once per route
 *   rather than re-checked inside every handler.
 *
 *   The gate is per capture, not per row: `/comments/:commentId` carries two
 *   uuids, `/collaborators/:email` and `/slides/:slideId` carry a uuid and a
 *   `text` (slide ids are author-chosen strings — migration 051). Declaring
 *   the `text` ones is the point: an undeclared row is invisible, a declared
 *   one says out loud that nothing checks that segment.
 *
 *   The list is checked against the pattern on every dispatch — a wrong length
 *   throws rather than silently gating the wrong segment.
 * @property {string} [id] - The row's operation name: its `operationId` in
 *   `docs/openapi.yaml` (B515, D247). Only an operation carries one — a row
 *   with a `method` on a measured surface — and a matched row with an `id` is
 *   counted on that surface's axis (`options.axis`). A method-less row (a 405
 *   answer) is not an operation and carries none. An `id` on a surface that
 *   declares no axis throws: a name that nothing counts is a mistake, not a
 *   silent default.
 * @property {(ctx: object, ...params: string[]) => unknown} handler
 * @property {string} [feature] - The installation cluster this row belongs to
 *   (D257): `'ai'` for a row that spends LLM tokens, and so on. With that
 *   cluster off (`isFeatureEnabled(feature)` — for `'ai'`: `AI_ENABLED=false`,
 *   demo mode, sandbox) the row is not mounted: a match answers 404 in the
 *   surface's own envelope before the handler runs, whatever the method — the
 *   same answer a whole module gives when its {@link Mount} carries the
 *   feature. Declare it here rather than re-checking the flag in the handler,
 *   so no entry can open its stream or call a vendor first. A row's feature
 *   can sit on top of its mount's (a Notion import needs `notion` and `ai`),
 *   never beside it as a second spelling.
 */

/**
 * Does every capture declared `'uuid'` actually hold one?
 *
 * @param {import('./router.js').CaptureKind[]} captures - The row's declaration.
 * @param {string[]} params - The capture groups this match produced.
 * @param {RegExp|string} pattern - Only for the error message.
 * @returns {boolean}
 */
function capturesSatisfyDeclaration(captures, params, pattern) {
  if (captures.length !== params.length) {
    throw new TypeError(
      `route ${pattern} declares ${captures.length} captures but matched ${params.length}`,
    );
  }
  return captures.every(
    (kind, index) => kind !== 'uuid' || isUuid(params[index]),
  );
}

/**
 * Dispatch a request through the first matching route in a declarative table.
 *
 * First-match semantics, identical to the hand-written `if`-chains this
 * replaces:
 *   - `method`, when present, must equal `req.method`; a mismatch falls through
 *     to the next route rather than being rejected here.
 *   - A string `pattern` is an exact pathname match.
 *   - A RegExp `pattern` is tested against the pathname; its capture groups are
 *     passed to the handler as trailing positional arguments.
 *   - A matched row whose `feature` is off answers 404 instead.
 *   - A matched row whose `captures` declaration is not satisfied answers 404
 *     instead: a segment declared `'uuid'` that cannot be one names no row.
 *   - A matched row with an `id` that passes both gates is counted once on
 *     `options.axis` (`countInstanceHealth`, fire-and-forget) before its
 *     handler runs — what the handler then answers does not change the count.
 *
 * **Order is significant** for RegExp/overlapping tables (`/search` before
 * `/:id`): the table author owns the order, and this walks it top to bottom.
 *
 * Returns the matched handler's result (truthy = handled), or `false` when no
 * route matches — so the caller can fall through to the next mount.
 *
 * @param {Route[]} routes - The route table, walked in order.
 * @param {import('./context.js').PublicContext|import('./context.js').AuthedContext} ctx
 *   - The request context; must carry `req` and `url`. Forwarded verbatim to the
 *   matched handler as its first argument.
 * @param {object} [options]
 * @param {(res: import('node:http').ServerResponse) => unknown} [options.notFound]
 *   - How this surface answers the dispatcher's own 404 (a row whose `feature`
 *   is off, an unsatisfied `captures`). Defaults to the internal `/api`
 *   envelope; the public v1 API passes its own, so one table form serves
 *   both wire contracts.
 * @param {string} [options.axis] - The instance-health axis this surface's
 *   operations are counted on (`'api_v1'` for the public API). Required as
 *   soon as a row carries an `id`.
 * @returns {Promise<unknown>|unknown} The handler's result, or `false`.
 */
export function dispatchRoutes(
  routes,
  ctx,
  { notFound: answerNotFound = notFound, axis } = {},
) {
  const { req, url } = ctx;

  for (const route of routes) {
    if (route.method && req.method !== route.method) continue;

    let params;
    if (typeof route.pattern === 'string') {
      if (url.pathname !== route.pattern) continue;
      params = [];
    } else {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      params = match.slice(1);
    }

    if (route.feature && !isFeatureEnabled(route.feature))
      return answerNotFound(ctx.res);
    if (
      route.captures &&
      !capturesSatisfyDeclaration(route.captures, params, route.pattern)
    )
      return answerNotFound(ctx.res);
    if (route.id) {
      if (!axis) {
        throw new TypeError(
          `route ${route.pattern} carries id '${route.id}' but its surface declares no axis`,
        );
      }
      countInstanceHealth([{ axis, key: route.id }]);
    }
    return route.handler(ctx, ...params);
  }

  return false;
}

/**
 * One module in a surface's mount chain (D257).
 *
 * @typedef {object} Mount
 * @property {(ctx: object) => unknown} handle - The module's entry: truthy once
 *   it answered, falsy to let the next mount try.
 * @property {string} [feature] - The installation cluster the whole module
 *   belongs to. With it off the mount is skipped, so its paths reach the
 *   surface's own 404 — the module does not exist on this installation.
 */

/**
 * Walk a mount table in order until one module answers.
 *
 * The mount-level twin of {@link dispatchRoutes}: `server/routes/api/index.js`,
 * the public v1 router and the static router each declare their chain as a
 * table and hand it here, so "this module is off" is a `feature` on its row and
 * never a `flags.x &&` branch in a chain.
 *
 * @param {Mount[]} mounts - The chain, walked top to bottom.
 * @param {object} ctx - Forwarded verbatim to each `handle`.
 * @returns {Promise<boolean>} true once a mount answered, false when none did.
 */
export async function dispatchMounts(mounts, ctx) {
  for (const { handle, feature } of mounts) {
    if (feature && !isFeatureEnabled(feature)) continue;
    if (await handle(ctx)) return true;
  }
  return false;
}

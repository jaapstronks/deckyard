/**
 * Shared first-match route dispatcher for `/api/*` route modules.
 *
 * The canonical dispatch form (A7.19 C8, decision B3a): a module declares a
 * `ROUTES` table and calls {@link dispatchRoutes}, rather than hand-rolling its
 * own matcher loop. The table is the only shape that can later be checked
 * against `docs/openapi.yaml` and the MCP tool list programmatically.
 *
 * Extracted verbatim from the matcher that grew inside
 * `routes/api/presentations/index.js` — the behaviour is unchanged, only shared.
 */

/**
 * A single declarative route.
 *
 * @typedef {object} Route
 * @property {string} [method] - HTTP method to require; omit to match any method.
 *   A method mismatch falls through to the next route (it is not a 405 here).
 * @property {string|RegExp} pattern - Exact pathname (string) or a pattern whose
 *   capture groups become trailing positional handler arguments.
 * @property {(ctx: object, ...params: string[]) => unknown} handler
 */

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
 * @returns {Promise<unknown>|unknown} The handler's result, or `false`.
 */
export function dispatchRoutes(routes, ctx) {
  const { req, url } = ctx;

  for (const route of routes) {
    if (route.method && req.method !== route.method) continue;

    if (typeof route.pattern === 'string') {
      if (url.pathname !== route.pattern) continue;
      return route.handler(ctx);
    }

    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    return route.handler(ctx, ...match.slice(1));
  }

  return false;
}

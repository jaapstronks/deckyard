/**
 * The SPA router — and the one module that reads and writes the current URL.
 *
 * The pathname half has always lived here (`route()` matches on it, `nav()`
 * pushes it). The query half did not: fifteen modules each did their own
 * `new URL(location.href)` to reach a param, in four spellings of the same
 * write (`history.state` vs `null` vs `{}` as the state argument, whole-query
 * strip vs targeted delete). B183 gave the querystring the same single owner
 * the pathname already had — `queryParam()` / `queryString()` to read,
 * `setQueryParams()` to write, `urlWithQuery()` to build a destination.
 *
 * Query writes go through `history.replaceState`, never `pushState`: the
 * router matches on pathname only, so a query-only write must not create a
 * history entry the back button re-enters on the same view. A query change
 * that *should* be navigable is `nav(urlWithQuery(...))`, which is a
 * navigation and re-routes like any other.
 */

let renderFn = () => {};

export function setRenderer(fn) {
  renderFn = fn;
}

export function startRouter() {
  // Deliberately document-long: the router is a boot-time singleton that lives
  // for the whole page, so this listener has no teardown by design. Called
  // exactly once from bootstrap() — do not call it per view.
  window.addEventListener('popstate', () => renderFn());
}

export function nav(to) {
  let dest = String(to || '/');
  history.pushState(null, '', dest);
  renderFn();
}

/**
 * The live location as a `URL`. The only place in the client that parses
 * `location.href`; `null` where there is no location at all (a module imported
 * into a bare Node test).
 * @returns {URL|null}
 */
function liveUrl() {
  try {
    return new URL(location.href);
  } catch {
    return null;
  }
}

/**
 * Apply a query patch to a `URL` in place: a `null`/`undefined` value deletes
 * the param, anything else sets it (stringified).
 * @param {URL} url
 * @param {Record<string, string|number|null|undefined>} patch
 */
function applyQueryPatch(url, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
}

/** An app-relative URL string for `url`: path + query + hash. */
function relativeUrl(url) {
  return url ? `${url.pathname}${url.search}${url.hash}` : '/';
}

/**
 * The current query string including its leading `?`, or `''` when there is
 * none. Pass this where a helper wants a raw query string to parse.
 * @returns {string}
 */
export function queryString() {
  return liveUrl()?.search || '';
}

/**
 * Read one query param off the current URL.
 * @param {string} key
 * @returns {string|null} The value, or `null` when the param is absent.
 */
export function queryParam(key) {
  return liveUrl()?.searchParams.get(key) ?? null;
}

/**
 * The current location as an app-relative URL (path + query + hash) — what
 * `nav()` needs to re-enter this exact page.
 * @returns {string}
 */
export function currentUrl() {
  return relativeUrl(liveUrl());
}

/**
 * The current app-relative URL with `patch` applied to its query params.
 * Builds a destination without navigating to it; a `null`/`undefined` value
 * drops the param.
 * @param {Record<string, string|number|null|undefined>} patch
 * @returns {string}
 */
export function urlWithQuery(patch) {
  const url = liveUrl();
  if (url) applyQueryPatch(url, patch);
  return relativeUrl(url);
}

/**
 * Write query params onto the current URL, keeping path, hash and history
 * state. Uses `replaceState`, so no history entry is created and no re-route
 * is triggered — see the module comment on why a query write is not a
 * navigation.
 * @param {Record<string, string|number|null|undefined>} patch
 */
export function setQueryParams(patch) {
  try {
    history.replaceState(history.state, '', urlWithQuery(patch));
    /* eslint-disable-next-line no-restricted-syntax -- Nothing to record with: the debug logger reads `?debugLog=` through `queryString()` below, so importing it here would be a cycle. A history-less environment is a bare test or a sandboxed embed; the caller's state change stands either way and only the address bar lags. */
  } catch {
    // See the disable above.
  }
}

export function route() {
  const url = liveUrl();
  const p = url?.pathname || '/';
  if (p === '/' || p === '/app') return { name: 'list' };
  if (p === '/login') return { name: 'login' };
  if (p === '/forgot-password') return { name: 'forgotPassword' };
  if (p === '/reset-password') return { name: 'resetPassword' };
  if (p === '/magic-login') return { name: 'magicLogin' };
  if (p === '/settings') return { name: 'settings' };
  if (p === '/insights') return { name: 'insights' };
  // Slide library permalink: /app/slide-library/:shelf/:id
  const slm = p.match(
    /^\/app\/slide-library\/(organization|personal)\/([^/]+)$/,
  );
  if (slm) return { name: 'slideLibrary', shelf: slm[1], slideId: slm[2] };
  const m = p.match(/^\/app\/([^/]+)$/);
  if (m) return { name: 'edit', id: m[1] };
  const pwm = p.match(/^\/present\/([^/]+)\/window$/);
  if (pwm) return { name: 'presentWindow', id: pwm[1] };
  const pm = p.match(/^\/present\/([^/]+)$/);
  if (pm) return { name: 'present', id: pm[1] };
  const nm = p.match(/^\/notes\/([^/]+)$/);
  if (nm) return { name: 'notes', sessionId: nm[1] };
  const jm = p.match(/^\/notes-join\/([^/]+)$/);
  if (jm) return { name: 'notesJoin', sessionId: jm[1] };
  const fm = p.match(/^\/follow\/([^/]+)$/);
  if (fm) return { name: 'follow', presentationId: fm[1] };
  const sm = p.match(/^\/s\/([^/]+)$/);
  if (sm) return { name: 'share', token: sm[1] };
  const am = p.match(/^\/analytics\/([^/]+)$/);
  if (am) return { name: 'analytics', presentationId: am[1] };
  const rm = p.match(/^\/reports\/([^/]+)$/);
  if (rm) return { name: 'report', token: rm[1] };
  return { name: 'list' };
}

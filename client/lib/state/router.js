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
 * navigation and re-routes like any other — unless the mounted view claims
 * the keys with `claimQuery()`, which makes a step between them a history
 * step inside the view instead of a re-route (B804).
 */

let renderFn = () => {};

/**
 * Path + query of the last URL the router rendered or wrote. A history step
 * that only changes the hash keeps it, and the view that owns the hash
 * (settings) follows through its own `hashchange` listener instead of being
 * torn down and re-mounted with its unsaved form state.
 */
let documentKey = null;

/**
 * The query keys the mounted view claims (`claimQuery`), or `null`. Claimed
 * keys are not part of `documentKey`, so a history step that only changes
 * them keeps the view mounted.
 * @type {{ navigable: string[], sticky: string[], onStep: Function }|null}
 */
let queryClaim = null;

/** Query params of the last URL the router rendered or wrote. */
let documentParams = null;

export function setRenderer(fn) {
  renderFn = fn;
}

export function startRouter() {
  rememberDocument();
  // Deliberately document-long: the router is a boot-time singleton that lives
  // for the whole page, so this listener has no teardown by design. Called
  // exactly once from bootstrap() — do not call it per view.
  window.addEventListener('popstate', () => {
    const key = locationKey();
    if (key === documentKey) {
      stepWithinClaim();
      return;
    }
    rememberDocument();
    renderFn();
  });
}

/**
 * Path + query of the live location, without the claimed query keys; `null`
 * where there is no location.
 */
function locationKey() {
  const url = liveUrl();
  if (!url) return null;
  if (queryClaim) {
    for (const key of [...queryClaim.navigable, ...queryClaim.sticky]) {
      url.searchParams.delete(key);
    }
  }
  return `${url.pathname}${url.search}`;
}

/** Record the live location as the one the view now shows. */
function rememberDocument() {
  documentKey = locationKey();
  documentParams = liveUrl()?.searchParams ?? null;
}

/**
 * A history step that changed only claimed keys. Sticky keys describe state
 * the view keeps across the step (the selected slide), so the entry gets the
 * values the view showed; the navigable keys are the step itself and go to
 * the view's `onStep`.
 */
function stepWithinClaim() {
  const claim = queryClaim;
  const before = documentParams;
  if (claim && before) {
    const patch = {};
    for (const key of claim.sticky) patch[key] = before.get(key);
    if (Object.keys(patch).length) writeUrl(urlWithQuery(patch));
  }
  rememberDocument();
  if (!claim) return;
  const values = {};
  for (const key of claim.navigable) values[key] = queryParam(key);
  claim.onStep(values);
}

/**
 * Let the mounted view own a set of query keys, so Back and Forward between
 * entries that differ only in those keys step inside the view instead of
 * re-routing it. One claim at a time; a new claim replaces the old.
 *
 * - `navigable` keys are history state: the view writes them with
 *   `pushQueryParams` and follows a step through `onStep(values)`.
 * - `sticky` keys belong to the view but not to history (the view replaces
 *   them as it goes): a step keeps the value the view showed.
 *
 * @param {{ navigable?: string[], sticky?: string[], onStep: (values: Record<string, string|null>) => void }} claim
 * @returns {() => void} release — call it when the view unmounts
 */
export function claimQuery({ navigable = [], sticky = [], onStep }) {
  const claim = { navigable, sticky, onStep };
  queryClaim = claim;
  rememberDocument();
  return () => {
    if (queryClaim !== claim) return;
    queryClaim = null;
    rememberDocument();
  };
}

export function nav(to) {
  writeUrl(String(to || '/'), { push: true });
  renderFn();
}

/**
 * Render the current URL again, as a fresh mount of its view, without a
 * history entry: for a view whose stored state changed under it (the editor
 * after a theme change rewrote the deck on the server).
 */
export function reenterRoute() {
  rememberDocument();
  renderFn();
}

/** The slide library's own address; the bare form is the library itself. */
const SLIDE_LIBRARY_PATH = '/app/slide-library';

/**
 * The address of the slide library, or of one slide in it (the permalink
 * `route()` answers with `{ name: 'slideLibrary', shelf, slideId }`).
 * @param {'organization'|'personal'} [shelf]
 * @param {string} [slideId]
 * @returns {string}
 */
export function slideLibraryPath(shelf, slideId) {
  if (!shelf || !slideId) return SLIDE_LIBRARY_PATH;
  return `${SLIDE_LIBRARY_PATH}/${shelf}/${encodeURIComponent(slideId)}`;
}

/**
 * Point the address bar at `path` for a state the view already shows: a
 * library tab, an opened slide. Unlike `nav()` it does not re-route, because
 * nothing needs rendering; query and hash stay. A no-op when the path is
 * already current.
 * @param {string} path
 * @param {{ push?: boolean }} [opts] - `push` adds a history entry the back
 *   button returns from (opening a slide); the default replaces (switching a
 *   tab, closing the slide)
 */
function writePath(path, { push = false } = {}) {
  const url = liveUrl();
  if (!url || url.pathname === path) return;
  url.pathname = path;
  writeUrl(relativeUrl(url), { push });
}

/**
 * Write `dest` to the address bar: the one place in the client that calls
 * `history.pushState`/`replaceState` (guarded in
 * `tests/router-query-ownership.test.js`). A replace keeps `history.state`.
 * @param {string} dest - a relative URL (path, query, hash)
 * @param {{ push?: boolean }} [opts]
 */
function writeUrl(dest, { push = false } = {}) {
  try {
    if (push) history.pushState(null, '', dest);
    else history.replaceState(history.state, '', dest);
    rememberDocument();
    /* eslint-disable-next-line no-restricted-syntax -- Nothing to record with: the debug logger reads `?debugLog=` through `queryString()` below, so importing it here would be a cycle. A history-less environment is a bare test or a sandboxed embed; the view already shows the state and only the address bar lags. */
  } catch {
    // See the disable above.
  }
}

/**
 * Push `path` as a new history entry without re-routing (see `writePath`).
 * @param {string} path
 */
export function pushPath(path) {
  writePath(path, { push: true });
}

/**
 * Replace the current path without a history entry or re-route (see
 * `writePath`).
 * @param {string} path
 */
export function replacePath(path) {
  writePath(path);
}

/**
 * Replace the current hash (without `#`; empty clears it) without a history
 * entry or re-route. A no-op when the hash is already current. Settings uses
 * it to correct an unknown or unreachable section to its default.
 * @param {string} hash
 */
export function replaceHash(hash) {
  writeHash(hash, { push: false });
}

/**
 * Push the hash (without `#`) as a new history entry without re-routing, so
 * Back returns to the previous one. A no-op when the hash is already current.
 * Settings keeps its section here.
 * @param {string} hash
 */
export function pushHash(hash) {
  writeHash(hash, { push: true });
}

/**
 * The current hash without its leading `#`; `''` when there is none.
 * @returns {string}
 */
export function currentHash() {
  return (liveUrl()?.hash || '').slice(1);
}

/**
 * @param {string} hash
 * @param {{ push: boolean }} opts
 */
function writeHash(hash, { push }) {
  const url = liveUrl();
  const next = hash ? `#${hash}` : '';
  if (!url || url.hash === next) return;
  url.hash = next;
  writeUrl(relativeUrl(url), { push });
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
  writeUrl(urlWithQuery(patch));
}

/**
 * Write query params as a new history entry without re-routing, so Back
 * returns to the URL before them. Only for keys the mounted view claimed as
 * navigable (`claimQuery`); anything else would re-route on that Back.
 * @param {Record<string, string|number|null|undefined>} patch
 */
export function pushQueryParams(patch) {
  const dest = urlWithQuery(patch);
  if (dest === currentUrl()) return;
  writeUrl(dest, { push: true });
}

/** Step one entry back in the session history, as the browser's Back does. */
export function historyBack() {
  try {
    history.back();
    /* eslint-disable-next-line no-restricted-syntax -- Same as writeUrl: a history-less environment has nothing to step back to, and the view has already closed what Back would close. */
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
  // The slide library, and a slide in it: /app/slide-library[/:shelf/:id].
  // Matched before `/app/:id`, or the bare library would open as a deck.
  if (p === SLIDE_LIBRARY_PATH) return { name: 'slideLibrary' };
  const slm = p.match(
    /^\/app\/slide-library\/(organization|personal)\/([^/]+)$/,
  );
  if (slm) {
    let slideId = slm[2];
    try {
      slideId = decodeURIComponent(slideId);
      /* eslint-disable-next-line no-restricted-syntax -- A malformed escape is a hand-mangled link: keep the raw segment, the library then reports the slide as not found. */
    } catch {
      // See the disable above.
    }
    return { name: 'slideLibrary', shelf: slm[1], slideId };
  }
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

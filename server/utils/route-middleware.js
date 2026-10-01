/**
 * Route middleware utilities for common authorization patterns.
 *
 * These are *direct* helpers: a handler calls them and branches on the result.
 * There is deliberately no wrapper/composition family here — one existed
 * alongside them for months with zero call sites, and it was removed rather
 * than adopted (A7.19 C2, decision B1, 2026-08-05). Adding a second dispatch
 * form to serve one route is what that decision rules out; the dispatch norm
 * itself is the route table, see `docs/reference/`.
 */

import { serveJson } from './http.js';
import { ForbiddenError, isAppError } from './errors.js';
import { loadPresentationForActor } from '../services/presentations.js';
import { isMultiOrgEnabled } from '../config/features.js';
import { getGuestBySessionToken } from '../storage/share-links/index.js';
import { parseCookies } from './cookies.js';
import { envStr, envList } from '../config/utils.js';

// ============================================================
// SIMPLE AUTHORIZATION HELPERS
// ============================================================

/**
 * Check if an authenticated user has designer or admin capability.
 * Used by custom-slide-types and font-families routes.
 *
 * `isDesigner` is resolved per request from the membership in the *active*
 * organization (routes/api/index.js), so in multi-organization mode it is the
 * whole answer: falling back to the instance-wide flag here would reopen
 * exactly what resolveDesignerCapability() closes, and an instance admin would
 * keep managing slide types and fonts in an organization where they are a plain
 * member. The fallback stays for single-organization mode, where it is what holds
 * the designer surfaces up in the modes that have no membership row at all
 * (auth disabled, dev bypass, sandbox) and where resolution failing open must
 * not lock the only admin out.
 *
 * @param {Object} authedUser
 * @returns {boolean}
 */
export function canManage(authedUser) {
  if (authedUser?.isDesigner === true) return true;
  return !isMultiOrgEnabled() && authedUser?.isAdmin === true;
}

/**
 * Emails explicitly allowed to author raw HTML/CSS (custom-html-slide), from the
 * CUSTOM_HTML_EDITOR_EMAILS env var (comma-separated, case-insensitive).
 * @returns {string[]}
 */
function customHtmlEditorEmails() {
  return envList('CUSTOM_HTML_EDITOR_EMAILS');
}

/**
 * Whether an email may author raw HTML/CSS custom-html slides. Admins (incl.
 * AUTH_ADMIN_EMAIL) always qualify; otherwise the email must be allowlisted via
 * CUSTOM_HTML_EDITOR_EMAILS. Used on paths where only an email is available
 * (e.g. the public API key owner). When nothing is configured, no non-admin
 * qualifies, so the feature degrades gracefully (view-only) for OSS installs.
 *
 * @param {string} email
 * @param {{ isAdmin?: boolean }} [opts]
 * @returns {boolean}
 */
export function emailCanEditCustomHtml(email, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return false;
  const adminEmail = envStr('AUTH_ADMIN_EMAIL').toLowerCase();
  if (adminEmail && e === adminEmail) return true;
  return customHtmlEditorEmails().includes(e);
}

/**
 * Whether an authenticated user may author raw HTML/CSS custom-html slides.
 * Narrow, explicit capability (not general admin) so the dangerous surface is
 * opt-in; enforced server-side on every slide write path.
 * @param {Object} authedUser
 * @returns {boolean}
 */
export function canEditCustomHtml(authedUser) {
  if (!authedUser) return false;
  return emailCanEditCustomHtml(authedUser.email, {
    isAdmin: authedUser.isAdmin === true,
  });
}

/**
 * Detect an unauthorized raw-HTML/CSS edit. Returns an error message if a
 * non-capable actor would create or change the `html` or `css` of any
 * custom-html-slide in `nextSlides` relative to `prevSlides`; otherwise null.
 *
 * Non-capable users may still keep, reorder, and edit non-markup fields (a11y,
 * background) of an existing custom-html-slide — only the markup is frozen.
 *
 * @param {Array} prevSlides - Slides as currently stored
 * @param {Array} nextSlides - Slides being written (may be a partial set)
 * @param {boolean} allowed - Whether the actor holds the capability
 * @returns {string|null}
 */
export function customHtmlEditViolation(prevSlides, nextSlides, allowed) {
  if (allowed) return null;
  const prevById = new Map(
    (Array.isArray(prevSlides) ? prevSlides : []).map((s) => [s?.id, s]),
  );
  for (const slide of Array.isArray(nextSlides) ? nextSlides : []) {
    if (!slide || slide.type !== 'custom-html-slide') continue;
    const next = slide.content || {};
    const prev = prevById.get(slide.id);
    const prevContent =
      prev && prev.type === 'custom-html-slide' ? prev.content || {} : {};
    for (const key of ['html', 'css']) {
      const nv = typeof next[key] === 'string' ? next[key] : '';
      const pv = typeof prevContent[key] === 'string' ? prevContent[key] : '';
      if (nv !== pv) {
        return `Editing raw HTML/CSS on a custom-html-slide requires the canEditCustomHtml capability (slide ${slide.id || '?'})`;
      }
    }
  }
  return null;
}

/**
 * Load a presentation and check authorization in one call — the internal
 * contract's adapter over {@link loadPresentationForActor}
 * (`server/services/presentations.js`, B519). The service loads and decides;
 * this renders a refusal in the internal envelope (404 absent, 403 not allowed,
 * D255) and hands the route `null`, so the route only branches.
 *
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.storageScope - The request's storage scope
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @param {'read'|'write'|'delete'|'manage'|'comment'} [options.permission='read'] - Required permission
 * @returns {Promise<Object|null>} The presentation if authorized, null if error response was sent
 *
 * @example
 * const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
 * if (!pres) return true; // Response already sent
 * // Continue with handler logic...
 */
export async function withPresentationAuth({
  storageScope,
  id,
  authedUser,
  res,
  permission = 'read',
}) {
  try {
    return await loadPresentationForActor(
      storageScope,
      { actor: authedUser },
      id,
      { access: permission },
    );
  } catch (err) {
    return sendRefusal(res, err);
  }
}

/**
 * Answer a service refusal in the internal envelope; rethrow anything else.
 * @param {Object} res
 * @param {unknown} err
 * @returns {null}
 */
function sendRefusal(res, err) {
  if (!isAppError(err)) throw err;
  serveJson(res, err.statusCode, err.toJSON());
  return null;
}

/**
 * Get guest info from request cookies if available.
 * @param {Object} req - HTTP request
 * @returns {Promise<{guest: Object, shareLink: Object}|null>}
 */
export async function getGuestFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const sessionToken = cookies.share_guest_session;
  if (!sessionToken) return null;
  return getGuestBySessionToken(sessionToken);
}

/**
 * Load a presentation for reading, by the signed-in user or — when they may
 * not read it — by the share-link guest session on this request.
 *
 * The account comes first, the guest session is the fallback (D287 (2)): the
 * service decides each identity on its own, never both at once (D253). A
 * refusal is answered in the internal envelope, as in
 * {@link withPresentationAuth}.
 *
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.storageScope - The request's storage scope
 * @param {Object} options.req - HTTP request object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @returns {Promise<{pres: Object|null, guestInfo: Object|null}>}
 *
 * @example
 * const { pres, guestInfo } = await withPresentationReadAuth({ storageScope, req, id, authedUser, res });
 * if (!pres) return true; // Response already sent
 */
export async function withPresentationReadAuth({
  storageScope,
  req,
  id,
  authedUser,
  res,
}) {
  try {
    const pres = await loadPresentationForActor(
      storageScope,
      { actor: authedUser },
      id,
    );
    return { pres, guestInfo: null };
  } catch (err) {
    if (!(err instanceof ForbiddenError)) {
      return { pres: sendRefusal(res, err), guestInfo: null };
    }
    const guestInfo = await getGuestFromRequest(req);
    if (!guestInfo) return { pres: sendRefusal(res, err), guestInfo: null };
    try {
      const pres = await loadPresentationForActor(storageScope, guestInfo, id);
      return { pres, guestInfo };
    } catch (guestErr) {
      return { pres: sendRefusal(res, guestErr), guestInfo: null };
    }
  }
}

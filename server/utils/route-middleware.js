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

import { getPresentation } from '../storage/presentations/index.js';
import { getCollaboratorPermission } from '../storage/collaborators.js';
import { notFound, unauthorized, badRequest } from './http.js';
import {
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canManageCollaborators,
  canCommentOnPresentation,
} from './presentation-authz/index.js';
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
 * Check if a request has read access to a presentation.
 * Checks both authenticated user and guest session.
 * Also fetches collaborator permission for private presentations.
 *
 * @param {Object} options
 * @param {Object} options.req - HTTP request
 * @param {Object|null} options.authedUser - Authenticated user (may be null)
 * @param {Object} options.pres - Presentation object
 * @returns {Promise<{canRead: boolean, guestInfo: Object|null, collaboratorPermission: string|null}>}
 *
 * @example
 * const { canRead, guestInfo } = await checkPresentationReadAccess({ req, authedUser, pres });
 * if (!canRead) return unauthorized(res);
 */
export async function checkPresentationReadAccess({ req, authedUser, pres }) {
  // Fetch collaborator permission if the user is authenticated
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(
      pres.id,
      authedUser.email,
    );
  }

  // Check authenticated user first (with collaborator permission)
  if (canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return { canRead: true, guestInfo: null, collaboratorPermission };
  }

  // Fall back to guest session
  const guestInfo = await getGuestFromRequest(req);
  if (guestInfo && guestInfo.shareLink.presentationId === pres.id) {
    return { canRead: true, guestInfo, collaboratorPermission: null };
  }

  return { canRead: false, guestInfo: null, collaboratorPermission: null };
}

/**
 * Check if a request has comment access to a presentation.
 * Checks both authenticated user and guest session.
 *
 * @param {Object} options
 * @param {Object} options.req - HTTP request
 * @param {Object|null} options.authedUser - Authenticated user (may be null)
 * @param {Object} options.pres - Presentation object
 * @returns {Promise<{canComment: boolean, guestInfo: Object|null, collaboratorPermission: string|null}>}
 */
export async function checkPresentationCommentAccess({
  req,
  authedUser,
  pres,
}) {
  // Fetch collaborator permission if the user is authenticated
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(
      pres.id,
      authedUser.email,
    );
  }

  // Check authenticated user first (with collaborator permission)
  if (
    canCommentOnPresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return { canComment: true, guestInfo: null, collaboratorPermission };
  }

  // Fall back to guest session (handled separately in comments routes)
  const guestInfo = await getGuestFromRequest(req);
  if (guestInfo && guestInfo.shareLink.presentationId === pres.id) {
    // Guest comment permission is checked via canGuestComment in the routes
    return { canComment: true, guestInfo, collaboratorPermission: null };
  }

  return { canComment: false, guestInfo: null, collaboratorPermission: null };
}

/**
 * Permission check function map.
 * Maps permission names to their corresponding check functions.
 */
const PERMISSION_CHECKS = {
  read: canReadPresentation,
  write: canWritePresentation,
  delete: canDeletePresentation,
  manage: canManageCollaborators,
};

/**
 * Load a presentation and check authorization in one call.
 * Sends appropriate error response if the check fails.
 *
 * This is the canonical way a presentation route authorizes: load and check in
 * one call, then branch on the result. Not a stopgap — there is no wrapper
 * form to migrate to (see the file header).
 *
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.storageScope - The request's storage scope
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @param {'read'|'write'|'delete'|'manage'} [options.permission='read'] - Required permission
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
  const pres = await getPresentation(storageScope, id);
  if (!pres) {
    notFound(res);
    return null;
  }

  const checkFn = PERMISSION_CHECKS[permission];
  if (!checkFn) {
    badRequest(res, `Invalid permission type: ${permission}`);
    return null;
  }

  // For read/write permissions, check collaborator permission as well
  let collaboratorPermission = null;
  if ((permission === 'read' || permission === 'write') && authedUser?.email) {
    collaboratorPermission = await getCollaboratorPermission(
      id,
      authedUser.email,
    );
  }

  if (!checkFn({ user: authedUser, pres, collaboratorPermission })) {
    unauthorized(res);
    return null;
  }

  return pres;
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
 * Load a presentation and check read authorization (including guest access).
 * Sends appropriate error response if the check fails.
 *
 * Unlike withPresentationAuth, this helper also checks for guest session access
 * via share links, making it suitable for endpoints that allow guest viewers.
 *
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.storageScope - The request's storage scope
 * @param {Object} options.req - HTTP request object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @returns {Promise<{pres: Object|null, guestInfo: Object|null, collaboratorPermission: string|null}>}
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
  const pres = await getPresentation(storageScope, id);
  if (!pres) {
    notFound(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  const { canRead, guestInfo, collaboratorPermission } =
    await checkPresentationReadAccess({ req, authedUser, pres });
  if (!canRead) {
    unauthorized(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  return { pres, guestInfo, collaboratorPermission };
}

/**
 * Load a presentation and check comment authorization (including guest access).
 * Sends appropriate error response if the check fails.
 *
 * Suitable for endpoints that allow guest commenters via share links.
 *
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.storageScope - The request's storage scope
 * @param {Object} options.req - HTTP request object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @returns {Promise<{pres: Object|null, guestInfo: Object|null, collaboratorPermission: string|null}>}
 */
export async function withPresentationCommentAuth({
  storageScope,
  req,
  id,
  authedUser,
  res,
}) {
  const pres = await getPresentation(storageScope, id);
  if (!pres) {
    notFound(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  const { canComment, guestInfo, collaboratorPermission } =
    await checkPresentationCommentAccess({ req, authedUser, pres });
  if (!canComment) {
    unauthorized(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  return { pres, guestInfo, collaboratorPermission };
}

/**
 * Route middleware utilities for common authorization patterns.
 * Reduces boilerplate in route handlers by providing composable wrappers.
 */

import { getPresentation } from '../storage/presentations.js';
import { getCollaboratorPermission } from '../storage/collaborators.js';
import {
  notFound,
  unauthorized,
  methodNotAllowed,
  badRequest,
} from './http.js';
import {
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canManageCollaborators,
  canForceLockRelease,
  canCommentOnPresentation,
} from './presentation-authz.js';
import { createRouteContext } from './context.js';
import { getGuestBySessionToken } from '../storage/share-links.js';
import { parseCookies } from './cookies.js';

// ============================================================
// SIMPLE AUTHORIZATION HELPERS
// ============================================================

/**
 * Check if an authenticated user has designer or admin capability.
 * Used by custom-slide-types and font-families routes.
 * @param {Object} authedUser
 * @returns {boolean}
 */
export function canManage(authedUser) {
  return authedUser?.isDesigner === true || authedUser?.isAdmin === true;
}

/**
 * Emails explicitly allowed to author raw HTML/CSS (custom-html-slide), from the
 * CUSTOM_HTML_EDITOR_EMAILS env var (comma-separated, case-insensitive).
 * @returns {string[]}
 */
function customHtmlEditorEmails() {
  return String(process.env.CUSTOM_HTML_EDITOR_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const adminEmail = String(process.env.AUTH_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
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
    (Array.isArray(prevSlides) ? prevSlides : []).map((s) => [s?.id, s])
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
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, {});
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
export async function checkPresentationCommentAccess({ req, authedUser, pres }) {
  // Fetch collaborator permission if the user is authenticated
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, {});
  }

  // Check authenticated user first (with collaborator permission)
  if (canCommentOnPresentation({ user: authedUser, pres, collaboratorPermission })) {
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
  forceLock: canForceLockRelease,
};

/**
 * Load a presentation and check authorization in one call.
 * Sends appropriate error response if the check fails.
 *
 * This is a simpler alternative to the composition middleware pattern,
 * useful for gradual refactoring of existing route handlers.
 *
 * @param {Object} options
 * @param {string} options.repoRoot - Repository root path
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @param {'read'|'write'|'delete'|'manage'|'forceLock'} [options.permission='read'] - Required permission
 * @returns {Promise<Object|null>} The presentation if authorized, null if error response was sent
 *
 * @example
 * const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
 * if (!pres) return true; // Response already sent
 * // Continue with handler logic...
 */
export async function withPresentationAuth({ repoRoot, id, authedUser, res, permission = 'read' }) {
  const pres = await getPresentation(repoRoot, id);
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
    collaboratorPermission = await getCollaboratorPermission(id, authedUser.email, {});
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
  return getGuestBySessionToken(sessionToken, {});
}

/**
 * Load a presentation and check read authorization (including guest access).
 * Sends appropriate error response if the check fails.
 *
 * Unlike withPresentationAuth, this helper also checks for guest session access
 * via share links, making it suitable for endpoints that allow guest viewers.
 *
 * @param {Object} options
 * @param {string} options.repoRoot - Repository root path
 * @param {Object} options.req - HTTP request object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @returns {Promise<{pres: Object|null, guestInfo: Object|null, collaboratorPermission: string|null}>}
 *
 * @example
 * const { pres, guestInfo } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
 * if (!pres) return true; // Response already sent
 */
export async function withPresentationReadAuth({ repoRoot, req, id, authedUser, res }) {
  const pres = await getPresentation(repoRoot, id);
  if (!pres) {
    notFound(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  const { canRead, guestInfo, collaboratorPermission } = await checkPresentationReadAccess({ req, authedUser, pres });
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
 * @param {string} options.repoRoot - Repository root path
 * @param {Object} options.req - HTTP request object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.authedUser - Authenticated user object
 * @param {Object} options.res - HTTP response object
 * @returns {Promise<{pres: Object|null, guestInfo: Object|null, collaboratorPermission: string|null}>}
 */
export async function withPresentationCommentAuth({ repoRoot, req, id, authedUser, res }) {
  const pres = await getPresentation(repoRoot, id);
  if (!pres) {
    notFound(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  const { canComment, guestInfo, collaboratorPermission } = await checkPresentationCommentAccess({ req, authedUser, pres });
  if (!canComment) {
    unauthorized(res);
    return { pres: null, guestInfo: null, collaboratorPermission: null };
  }

  return { pres, guestInfo, collaboratorPermission };
}

/**
 * Create a handler wrapper that requires specific HTTP methods.
 * @param {string[]} allowedMethods - Array of allowed HTTP methods
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requireMethod(allowedMethods, handler) {
  return async (params) => {
    const { req, res } = params;
    if (!allowedMethods.includes(req.method)) {
      return methodNotAllowed(res, allowedMethods);
    }
    return handler(params);
  };
}

/**
 * Create a handler wrapper that loads a presentation and requires it to exist.
 * Adds `pres` to the params object.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function withPresentation(handler) {
  return async (params, presentationId) => {
    const { repoRoot, res } = params;
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    return handler({ ...params, pres }, presentationId);
  };
}

/**
 * Create a handler wrapper that requires read permission on a presentation.
 * Must be used after withPresentation (expects params.pres to exist).
 * Also checks for guest access via share links.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresRead(handler) {
  return async (params, ...args) => {
    const { req, res, authedUser, pres } = params;

    // Check authenticated user permission
    let canRead = canReadPresentation({ user: authedUser, pres });

    // If not authorized as user, check for guest session
    if (!canRead) {
      const guestInfo = await getGuestFromRequest(req);
      if (guestInfo && guestInfo.shareLink.presentationId === pres.id) {
        canRead = true;
        params.guestInfo = guestInfo;
      }
    }

    if (!canRead) return unauthorized(res);
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires write permission on a presentation.
 * Must be used after withPresentation (expects params.pres to exist).
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresWrite(handler) {
  return async (params, ...args) => {
    const { res, authedUser, pres } = params;
    if (!canWritePresentation({ user: authedUser, pres })) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires delete permission on a presentation.
 * Must be used after withPresentation (expects params.pres to exist).
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresDelete(handler) {
  return async (params, ...args) => {
    const { res, authedUser, pres } = params;
    if (!canDeletePresentation({ user: authedUser, pres })) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires collaborator management permission.
 * Must be used after withPresentation (expects params.pres to exist).
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresManageCollaborators(handler) {
  return async (params, ...args) => {
    const { res, authedUser, pres } = params;
    if (!canManageCollaborators({ user: authedUser, pres })) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires force lock release permission.
 * Must be used after withPresentation (expects params.pres to exist).
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresForceLockRelease(handler) {
  return async (params, ...args) => {
    const { res, authedUser, pres } = params;
    if (!canForceLockRelease({ user: authedUser, pres })) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that adds route context to params.
 * Adds `ctx` to the params object.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function withContext(handler) {
  return async (params, ...args) => {
    const { authedUser } = params;
    const ctx = createRouteContext(authedUser);
    return handler({ ...params, ctx }, ...args);
  };
}

/**
 * Create a handler wrapper that requires admin permission.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresAdmin(handler) {
  return async (params, ...args) => {
    const { res, authedUser } = params;
    if (!authedUser?.isAdmin) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires authentication.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresAuth(handler) {
  return async (params, ...args) => {
    const { res, authedUser } = params;
    if (!authedUser?.email) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Create a handler wrapper that requires designer capability.
 * Checks isDesigner flag on the authedUser object.
 * @param {Function} handler - The handler function to wrap
 * @returns {Function} Wrapped handler
 */
export function requiresDesigner(handler) {
  return async (params, ...args) => {
    const { res, authedUser } = params;
    if (!authedUser?.isDesigner) {
      return unauthorized(res);
    }
    return handler(params, ...args);
  };
}

/**
 * Compose multiple middleware wrappers into a single wrapper.
 * Middleware is applied from left to right (first middleware is outermost).
 *
 * @example
 * const handler = compose(
 *   requireMethod(['GET']),
 *   withPresentation,
 *   requiresRead,
 *   withContext
 * )(async ({ pres, ctx, res }) => {
 *   // Handler logic here
 * });
 *
 * @param {...Function} middlewares - Middleware functions to compose
 * @returns {Function} A function that takes a handler and returns a wrapped handler
 */
export function compose(...middlewares) {
  return (handler) => {
    return middlewares.reduceRight((acc, middleware) => middleware(acc), handler);
  };
}

/**
 * Create a presentation route handler with common patterns pre-applied.
 * This is a convenience function for the most common pattern:
 * - Load presentation (404 if not found)
 * - Check read/write permission
 * - Create context
 *
 * @param {Object} options
 * @param {string[]} options.methods - Allowed HTTP methods
 * @param {'read'|'write'|'delete'|'manage'|'forceLock'} options.permission - Required permission
 * @param {Function} handler - The handler function
 * @returns {Function} Wrapped handler
 */
export function presentationRoute({ methods, permission }, handler) {
  const middlewares = [withPresentation];

  if (permission === 'read') {
    middlewares.push(requiresRead);
  } else if (permission === 'write') {
    middlewares.push(requiresWrite);
  } else if (permission === 'delete') {
    middlewares.push(requiresDelete);
  } else if (permission === 'manage') {
    middlewares.push(requiresManageCollaborators);
  } else if (permission === 'forceLock') {
    middlewares.push(requiresForceLockRelease);
  }

  middlewares.push(withContext);

  if (methods) {
    middlewares.unshift((h) => requireMethod(methods, h));
  }

  return compose(...middlewares)(handler);
}
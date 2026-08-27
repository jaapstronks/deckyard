import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  requireJsonBody,
  withErrorHandler,
  forbidden,
} from '../../utils/http.js';
import { getStringArray } from '../../utils/request-validators.js';
import {
  getAppSettings,
  getUserSettings,
  writeAppSettings,
  writeUserSettings,
} from '../../storage/settings.js';
import {
  getOrganizationById,
  updateOrganization,
  getMembershipByEmail,
} from '../../storage/user-organizations/index.js';
import { hasOrganizationRole } from '../../../shared/organization-role.js';
import { getOrgSettings } from '../../utils/org-settings.js';
import { canManage } from '../../utils/route-middleware.js';
import { isMultiOrgEnabled } from '../../config/features.js';
import { dispatchRoutes } from '../../utils/router.js';

/**
 * Whether this user may write the organization-level admin settings keys.
 *
 * Instance admin is necessary in both modes. In multi-organization mode being
 * admin or owner of the organization being written is necessary too, so the
 * instance role can only ever be narrowed by the membership, never widened by
 * it — the same shape as `isOrganizationAdmin()` on the client and `canManage()`
 * for the designer capability.
 *
 * @param {Object} [authedUser] - Authenticated user
 * @param {string} organizationId - Organization the settings belong to
 * @returns {Promise<boolean>}
 */
async function canWriteOrgAdminKeys(authedUser, organizationId) {
  if (!authedUser?.isAdmin) return false;
  if (!isMultiOrgEnabled()) return true;
  if (!authedUser?.email || !organizationId) return false;

  const membership = await getMembershipByEmail(
    authedUser.email,
    organizationId,
  );
  return hasOrganizationRole(membership?.role, 'admin');
}

// Global (app-wide) settings:
// - readable by any authenticated user (so the editor can respect supported languages)
// - writable by admins only

// GET /api/settings/app
async function handleAppSettingsGet({ storageScope, res, authedUser }) {
  const settings = await getAppSettings(storageScope);
  // Webhook URLs are admin-only; keep them out of non-admin clients.
  if (!authedUser?.isAdmin) {
    try {
      delete settings.webhooks;
    } catch {
      // ignore
    }
  }
  serveJson(res, 200, { settings });
  return true;
}

// PUT /api/settings/app (admin only)
async function handleAppSettingsPut({ storageScope, req, res, authedUser }) {
  if (!authedUser?.isAdmin) return forbidden(res);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const settings = await writeAppSettings(storageScope, body);
  serveJson(res, 200, { settings });
  return true;
}

// Organization settings:
// - adminsAreDesigners toggle
// - Other org-level settings
// Admin-only, works in both single and multi-organization modes

// GET /api/settings/organization — available to any authenticated user
// (the picker needs disabledSlideTypes)
async function handleOrgSettingsGet({ res, authedUser }) {
  const orgId = authedUser?.organizationId;
  try {
    const org = await getOrganizationById(orgId);
    const settings = getOrgSettings(org);
    serveJson(res, 200, { settings });
  } catch {
    serveJson(res, 200, { settings: {} });
  }
  return true;
}

// PATCH /api/settings/organization — disabledSlideTypes by designers, other keys admin
async function handleOrgSettingsPatch({ req, res, authedUser }) {
  const orgId = authedUser?.organizationId;
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const hasDesignerKeys = 'disabledSlideTypes' in body;
  const hasAdminKeys = Object.keys(body).some(
    (k) => k !== 'disabledSlideTypes',
  );
  // Third copy of the designer gate, and it carried the same `|| isAdmin`
  // that canManage() and canManageThemes() did — so scoping only those two
  // left `disabledSlideTypes` on the *active* organization writable by an
  // instance admin who is a plain member of it. Same function, same rule.
  const isDesigner = canManage(authedUser);

  // The admin keys (`adminsAreDesigners`, `rss`) used to hang on the
  // instance-wide flag alone, so an instance admin who is a plain member of
  // the organization they had switched into could still write its settings.
  // The rule is the conjunction the UI already applies through
  // `isOrganizationAdmin()`: instance admin *and*, in multi-organization mode,
  // admin or owner of the active organization. Single-organization is
  // unchanged — there is no membership to read and none is asked for.
  if (hasAdminKeys && !(await canWriteOrgAdminKeys(authedUser, orgId))) {
    return forbidden(res);
  }
  if (hasDesignerKeys && !isDesigner) return forbidden(res);

  const org = await getOrganizationById(orgId);
  const currentSettings = getOrgSettings(org);

  // Merge only allowed keys
  const allowedKeys = ['adminsAreDesigners', 'disabledSlideTypes', 'rss'];
  const merged = { ...currentSettings };
  for (const key of allowedKeys) {
    if (key in body) {
      if (key === 'adminsAreDesigners') {
        merged[key] = body[key] === true;
      } else if (key === 'disabledSlideTypes') {
        merged[key] = getStringArray(body, key, { trim: true });
      } else if (key === 'rss') {
        const rss = body[key];
        if (rss && typeof rss === 'object') {
          merged[key] = {
            enabled: rss.enabled === true,
            title: String(rss.title || '').slice(0, 200),
            description: String(rss.description || '').slice(0, 500),
            language:
              typeof rss.language === 'string'
                ? rss.language.slice(0, 10)
                : 'en',
            maxItems: Math.max(1, Math.min(100, Number(rss.maxItems) || 50)),
            copyright: String(rss.copyright || '').slice(0, 200),
            authorName: String(rss.authorName || '').slice(0, 100),
            customFeedUrl: String(rss.customFeedUrl || '').slice(0, 500),
          };
        }
      } else {
        merged[key] = body[key];
      }
    }
  }

  await updateOrganization(orgId, { settings: merged });
  serveJson(res, 200, { settings: merged });
  return true;
}

// Per-user settings (profile display name, UI language / language mode).
// The email guard runs before the method check, so this stays a single
// no-method handler (see docs/reference/route-dispatch.md, Form B guard note).
async function handleMySettings({ storageScope, req, res, authedUser }) {
  const email = String(authedUser?.email || '').trim();
  if (!email) return unauthorized(res);

  if (req.method === 'GET') {
    const settings = await getUserSettings(storageScope, email);
    serveJson(res, 200, { settings });
    return true;
  }
  if (req.method === 'PUT') {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const settings = await writeUserSettings(storageScope, email, body);
    serveJson(res, 200, { settings });
    return true;
  }
  return methodNotAllowed(res, ['GET', 'PUT']);
}

/**
 * Declarative route table for `/api/settings/*` (A7.19 C8). Order matches the
 * previous if-chain: app, organization, me. The app and organization paths sent
 * an explicit 405 for other methods, preserved here as trailing catch-all rows;
 * `/me` keeps its email-guard-then-method shape as a single no-method handler.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/settings/app',
    handler: handleAppSettingsGet,
  },
  {
    method: 'PUT',
    pattern: '/api/settings/app',
    handler: handleAppSettingsPut,
  },
  {
    pattern: '/api/settings/app',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT']),
  },
  {
    method: 'GET',
    pattern: '/api/settings/organization',
    handler: handleOrgSettingsGet,
  },
  {
    method: 'PATCH',
    pattern: '/api/settings/organization',
    handler: handleOrgSettingsPatch,
  },
  {
    pattern: '/api/settings/organization',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH']),
  },
  { pattern: '/api/settings/me', handler: handleMySettings },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleSettings = withErrorHandler('settings', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);

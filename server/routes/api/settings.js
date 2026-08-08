import { methodNotAllowed, serveJson, unauthorized, serverError, requireJsonBody } from '../../utils/http.js';
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
  hasOrganizationRole,
} from '../../storage/user-organizations/index.js';
import { getOrgSettings } from '../../utils/org-settings.js';
import { canManage } from '../../utils/route-middleware.js';
import { isMultiOrgEnabled } from '../../config/features.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('settings');

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

  const membership = await getMembershipByEmail(authedUser.email, organizationId);
  return hasOrganizationRole(membership?.role, 'admin');
}

export async function handleSettings({ repoRoot, req, res, url, authedUser }) {
  // Global (app-wide) settings:
  // - readable by any authenticated user (so the editor can respect supported languages)
  // - writable by admins only
  if (url.pathname === '/api/settings/app') {
    if (req.method === 'GET') {
      const settings = await getAppSettings(repoRoot);
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
    if (req.method === 'PUT') {
      if (!authedUser?.isAdmin) return unauthorized(res);
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const settings = await writeAppSettings(repoRoot, body);
      serveJson(res, 200, { settings });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  // Organization settings:
  // - adminsAreDesigners toggle
  // - Other org-level settings
  // Admin-only, works in both single and multi-organization modes
  if (url.pathname === '/api/settings/organization') {
    // GET is available to any authenticated user (picker needs disabledSlideTypes)
    // PATCH requires admin
    const orgId = authedUser?.organizationId;

    if (req.method === 'GET') {
      try {
        const org = await getOrganizationById(orgId);
        const settings = getOrgSettings(org);
        serveJson(res, 200, { settings });
      } catch {
        serveJson(res, 200, { settings: {} });
      }
      return true;
    }
    if (req.method === 'PATCH') {
      // disabledSlideTypes can be updated by designers, other keys require admin
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;

      const hasDesignerKeys = 'disabledSlideTypes' in body;
      const hasAdminKeys = Object.keys(body).some(k => k !== 'disabledSlideTypes');
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
        return unauthorized(res);
      }
      if (hasDesignerKeys && !isDesigner) return unauthorized(res);

      try {
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
                  language: typeof rss.language === 'string' ? rss.language.slice(0, 10) : 'en',
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
      } catch (err) {
        log.error('[settings] Failed to update organization settings:', err);
        serverError(res, 'Failed to update settings');
      }
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PATCH']);
  }

  // Per-user settings:
  // - profile (display name)
  // - UI language / language mode preference
  if (url.pathname === '/api/settings/me') {
    const email = String(authedUser?.email || '').trim();
    if (!email) return unauthorized(res);

    if (req.method === 'GET') {
      const settings = await getUserSettings(repoRoot, email);
      serveJson(res, 200, { settings });
      return true;
    }
    if (req.method === 'PUT') {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const settings = await writeUserSettings(repoRoot, email, body);
      serveJson(res, 200, { settings });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  return false;
}

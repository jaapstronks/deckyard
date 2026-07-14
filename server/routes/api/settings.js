import {
  badRequest,
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import {
  readAppSettings,
  readUserSettings,
  writeAppSettings,
  writeUserSettings,
} from '../../storage/settings.js';
import { getDefaultOrganizationId } from '../../config/database.js';
import { getOrganizationById, updateOrganization } from '../../storage/user-organizations.js';
import { getOrgSettings } from '../../utils/org-settings.js';

export async function handleSettings({ repoRoot, req, res, url, authedUser }) {
  // Global (app-wide) settings:
  // - readable by any authenticated user (so the editor can respect supported languages)
  // - writable by admins only
  if (url.pathname === '/api/settings/app') {
    if (req.method === 'GET') {
      const settings = await readAppSettings(repoRoot);
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
      const body = await json(req);
      if (!body || typeof body !== 'object')
        return badRequest(res, 'Missing JSON body');
      const settings = await writeAppSettings(repoRoot, body);
      serveJson(res, 200, { settings });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  // Organization settings:
  // - adminsAreDesigners toggle
  // - Other org-level settings
  // Admin-only, works in both single and multi-workspace modes
  if (url.pathname === '/api/settings/organization') {
    // GET is available to any authenticated user (picker needs disabledSlideTypes)
    // PATCH requires admin
    const orgId = authedUser?.organizationId || getDefaultOrganizationId();

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
      let body;
      try {
        body = await json(req);
      } catch {
        return badRequest(res, 'Invalid JSON body');
      }
      if (!body || typeof body !== 'object') {
        return badRequest(res, 'Missing JSON body');
      }

      const hasDesignerKeys = 'disabledSlideTypes' in body;
      const hasAdminKeys = Object.keys(body).some(k => k !== 'disabledSlideTypes');
      const isDesigner = authedUser?.isDesigner || authedUser?.isAdmin;

      if (hasAdminKeys && !authedUser?.isAdmin) return unauthorized(res);
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
              merged[key] = Array.isArray(body[key])
                ? body[key].filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
                : [];
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
        console.error('[settings] Failed to update organization settings:', err);
        serveJson(res, 500, { error: 'Failed to update settings' });
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
      const settings = await readUserSettings(repoRoot, email);
      serveJson(res, 200, { settings });
      return true;
    }
    if (req.method === 'PUT') {
      const body = await json(req);
      if (!body || typeof body !== 'object')
        return badRequest(res, 'Missing JSON body');
      const settings = await writeUserSettings(repoRoot, email, body);
      serveJson(res, 200, { settings });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  return false;
}

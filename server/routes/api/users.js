/**
 * API routes for user search and profile lookup.
 *
 * Authenticated endpoints:
 *   GET /api/users/search?q=<query>&limit=10&exclude=email1,email2
 *   GET /api/users/profiles?emails=a@x.com,b@x.com - Batch profile lookup
 */

import { searchUsers } from '../../storage/users.js';
import { readUserSettings } from '../../storage/settings.js';
import { createRouteContext } from '../../utils/context.js';
import { serveJson, badRequest, methodNotAllowed, unauthorized } from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';

/**
 * Handle user-related API endpoints.
 */
export async function handleUsers({ repoRoot, req, res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);

  // GET /api/users/search - Search users in organization
  const searchMatch = url.pathname === '/api/users/search';
  if (searchMatch && req.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const { limit } = parsePaginationParams(url.searchParams, { defaultLimit: 10 });
    const excludeParam = url.searchParams.get('exclude') || '';
    const exclude = excludeParam
      ? excludeParam.split(',').map((e) => e.trim()).filter(Boolean)
      : [];

    if (!query.trim()) {
      return serveJson(res, 200, { users: [] });
    }

    const users = await searchUsers(query, { limit, exclude }, ctx);

    serveJson(res, 200, { users });
    return true;
  }

  // GET /api/users/profiles - Batch profile lookup for avatars
  // Requires authentication to prevent user enumeration
  if (url.pathname === '/api/users/profiles') {
    if (!authedUser?.email) {
      return unauthorized(res, 'Authentication required');
    }

    if (req.method !== 'GET') {
      return methodNotAllowed(res, ['GET']);
    }

    const emailsParam = url.searchParams.get('emails') || '';
    const emails = emailsParam
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50); // Limit to 50 emails per request

    if (!emails.length) {
      return serveJson(res, 200, { profiles: {} });
    }

    // Fetch profiles for all emails in parallel
    const profileEntries = await Promise.all(
      emails.map(async (email) => {
        try {
          const settings = await readUserSettings(repoRoot, email);
          return [
            email,
            {
              name: settings?.profile?.name || '',
              imageUrl: settings?.profile?.imageUrl || '',
            },
          ];
        } catch {
          // Return empty profile on error
          return [email, { name: '', imageUrl: '' }];
        }
      })
    );

    const profiles = Object.fromEntries(profileEntries);
    serveJson(res, 200, { profiles });
    return true;
  }

  return false;
}
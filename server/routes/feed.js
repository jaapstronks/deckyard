/**
 * Public RSS/Atom/JSON feed route handler.
 * Serves feed content for published presentations (no authentication required).
 */

import { getDefaultOrganizationId } from '../config/database.js';
import { getOrganizationById } from '../storage/user-organizations.js';
import { getOrgSettings } from '../utils/org-settings.js';
import { listPublishedForFeed } from '../storage/published.js';
import { buildFeed } from '../utils/rss-feed.js';
import { isRssFeedEnabled } from '../config/features.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('feed');

const CONTENT_TYPES = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
};

const ROUTES = {
  '/feed/rss.xml': 'rss',
  '/feed/atom.xml': 'atom',
  '/feed/feed.json': 'json',
};

/**
 * Handle feed requests. Returns true if the request was handled, false otherwise.
 */
export async function handleFeed({ repoRoot, req, res, url }) {
  const format = ROUTES[url.pathname];
  if (!format) return false;

  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return true;
  }

  // Feature flag kill switch
  if (!isRssFeedEnabled()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  // Determine organization
  const orgId = getDefaultOrganizationId();
  let org;
  try {
    org = await getOrganizationById(orgId);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  const settings = getOrgSettings(org);
  if (!settings.rss?.enabled) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  // Build base URL from request
  const proto =
    (req.headers['x-forwarded-proto'] &&
      String(req.headers['x-forwarded-proto']).split(',')[0].trim()) ||
    'http';
  const host = req.headers.host || 'localhost';
  const baseUrl = settings.rss.customFeedUrl
    ? settings.rss.customFeedUrl.replace(/\/+$/, '')
    : `${proto}://${host}`;

  const maxItems = Math.max(1, Math.min(100, Number(settings.rss.maxItems) || 50));
  const presentations = await listPublishedForFeed(repoRoot, { limit: maxItems });

  // Compute ETag from latest modified timestamp
  const latestModified =
    presentations.length > 0
      ? presentations.reduce((max, p) => {
          const t = new Date(p.modified || 0).getTime();
          return t > max ? t : max;
        }, 0)
      : 0;
  const etag = `"feed-${format}-${latestModified}"`;

  // Support conditional requests
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === etag) {
    res.writeHead(304);
    res.end();
    return true;
  }

  let content;
  try {
    content = buildFeed({ org, presentations, baseUrl, format });
  } catch (err) {
    log.error('[feed] buildFeed error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Feed generation error');
    return true;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[format],
    'Cache-Control': 'public, max-age=300',
    ETag: etag,
  });
  res.end(content);
  return true;
}

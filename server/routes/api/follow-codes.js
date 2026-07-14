import { createFollowCode, resolveFollowCode } from '../../storage/follow-codes.js';
import { badRequest, methodNotAllowed, serveJson, unauthorized } from '../../utils/http.js';
import { getClientIp } from '../../utils/context.js';

// ============================================================
// RATE LIMITING
// In-memory rate limiting for follow codes
// ============================================================

const RATE_LIMIT_CREATE_PER_IP = 10; // per hour
const RATE_LIMIT_RESOLVE_PER_IP = 60; // per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Map of IP -> { count, resetAt }
const createRateLimits = new Map();
const resolveRateLimits = new Map();

/**
 * Check and update rate limit for an IP address.
 * @param {Map} limitMap - The rate limit map
 * @param {string} ip - Client IP address
 * @param {number} maxRequests - Maximum requests per window
 * @returns {boolean} - True if rate limited
 */
function checkRateLimit(limitMap, ip, maxRequests) {
  const now = Date.now();
  const entry = limitMap.get(ip);

  // Clean up expired entries periodically
  if (limitMap.size > 10000) {
    for (const [key, val] of limitMap) {
      if (val.resetAt < now) limitMap.delete(key);
    }
  }

  if (!entry || entry.resetAt < now) {
    // New window
    limitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true;
  }

  entry.count++;
  return false;
}

export async function handleFollowCodes({ repoRoot, req, res, url, authedUser }) {
  if (url.pathname.startsWith('/api/follow-codes')) {
    console.log(`[Follow Codes] Handler called: ${req.method} ${url.pathname}`);
  }

  const clientIp = getClientIp(req) || 'unknown';

  // POST /api/follow-codes - Create a new 4-letter code for a follow URL
  // Requires authentication to prevent abuse
  if (url.pathname === '/api/follow-codes' && req.method === 'POST') {
    // Require authentication
    if (!authedUser?.email) {
      return unauthorized(res, 'Authentication required');
    }

    // Rate limit by IP
    if (checkRateLimit(createRateLimits, clientIp, RATE_LIMIT_CREATE_PER_IP)) {
      serveJson(res, 429, { error: 'Too many requests. Please try again later.' });
      return true;
    }

    try {
      const body = JSON.parse(await readRequestBody(req));
      const { followUrl } = body;

      if (typeof followUrl !== 'string' || !followUrl.trim()) {
        badRequest(res, 'followUrl is required');
        return true;
      }

      // Validate that it's a follow URL
      if (!followUrl.startsWith('/follow/')) {
        badRequest(res, 'Invalid follow URL format');
        return true;
      }

      const code = await createFollowCode(repoRoot, followUrl.trim());
      serveJson(res, 200, { code });
      return true;
    } catch (error) {
      badRequest(res, `Failed to create code: ${error.message}`);
      return true;
    }
  }

  // GET /api/follow-codes/:code - Resolve a 4-letter code to a follow URL
  const resolveMatch = url.pathname.match(/^\/api\/follow-codes\/([A-Z]{4})$/i);
  if (resolveMatch && req.method === 'GET') {
    // Rate limit resolution to prevent brute-force enumeration
    if (checkRateLimit(resolveRateLimits, clientIp, RATE_LIMIT_RESOLVE_PER_IP)) {
      serveJson(res, 429, { error: 'Too many requests. Please try again later.' });
      return true;
    }

    const code = resolveMatch[1].toUpperCase();
    console.log(`[Follow Codes] Resolving code: ${code}`);

    try {
      const followUrl = await resolveFollowCode(repoRoot, code);

      if (!followUrl) {
        console.log(`[Follow Codes] Code not found: ${code}`);
        badRequest(res, 'Code not found or expired');
        return true;
      }

      console.log(`[Follow Codes] Resolved ${code} -> ${followUrl}`);
      serveJson(res, 200, { followUrl });
      return true;
    } catch (error) {
      console.error(`[Follow Codes] Error resolving ${code}:`, error);
      badRequest(res, `Failed to resolve code: ${error.message}`);
      return true;
    }
  }

  if (url.pathname.startsWith('/api/follow-codes')) {
    methodNotAllowed(res, ['GET', 'POST']);
    return true;
  }

  return false;
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

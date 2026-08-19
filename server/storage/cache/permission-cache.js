/**
 * Permission caching layer.
 * Caches collaborator permissions to reduce database queries.
 *
 * Uses Redis when available for distributed caching,
 * falls back to in-memory LRU cache for single-instance deployments.
 *
 * Configuration:
 * - PERMISSION_CACHE_TTL_SECONDS: Cache TTL (default: 300 = 5 minutes)
 * - PERMISSION_CACHE_MAX_SIZE: Max in-memory cache entries (default: 10000)
 */

import { withRedis, isRedisAvailable } from '../../utils/redis-client.js';
import { envInt } from '../../config/utils.js';

const CACHE_PREFIX = 'perm:';
const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_MAX_SIZE = 10000;

// In-memory LRU cache for fallback
const memoryCache = new Map();
const cacheAccessOrder = [];

/**
 * Get cache configuration from environment.
 * @returns {Object} Cache configuration
 */
function getConfig() {
  return {
    ttlSeconds: envInt('PERMISSION_CACHE_TTL_SECONDS', DEFAULT_TTL_SECONDS, {
      min: 1,
    }),
    maxSize: envInt('PERMISSION_CACHE_MAX_SIZE', DEFAULT_MAX_SIZE, { min: 1 }),
  };
}

/**
 * Generate cache key for a permission lookup.
 *
 * `(presentation, email)` is the whole key, matching the row it caches: a
 * presentation id is a globally unique uuid, so it already names one deck in
 * one organization (see the header of storage/collaborators.js). Keying on an
 * organization as well would let the same row be cached under two keys — one
 * per caller's idea of the scope — which is the drift this layer must not
 * reintroduce.
 *
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @returns {string} Cache key
 */
function makeCacheKey(presentationId, userEmail) {
  // Normalize to avoid case issues
  const email = (userEmail || '').toLowerCase().trim();
  return `${presentationId}:${email}`;
}

/**
 * Evict oldest entries from memory cache when it exceeds max size.
 */
function evictOldest() {
  const config = getConfig();
  while (memoryCache.size > config.maxSize && cacheAccessOrder.length > 0) {
    const oldestKey = cacheAccessOrder.shift();
    memoryCache.delete(oldestKey);
  }
}

/**
 * Update access order for LRU eviction.
 * @param {string} key - Cache key
 */
function touchMemoryCache(key) {
  const idx = cacheAccessOrder.indexOf(key);
  if (idx !== -1) {
    cacheAccessOrder.splice(idx, 1);
  }
  cacheAccessOrder.push(key);
}

/**
 * Get cached permission from Redis.
 * @param {string} key - Cache key
 * @returns {Promise<string|null|undefined>} Permission or undefined if not cached
 */
async function getFromRedis(key) {
  return withRedis(async (redis) => {
    const value = await redis.get(`${CACHE_PREFIX}${key}`);
    if (value === null) {
      return undefined; // Not in cache
    }
    // We store 'null' as string '__NULL__' to distinguish from missing
    if (value === '__NULL__') {
      return null;
    }
    return value;
  }, undefined);
}

/**
 * Set cached permission in Redis.
 * @param {string} key - Cache key
 * @param {string|null} permission - Permission to cache
 * @returns {Promise<void>}
 */
async function setInRedis(key, permission) {
  const config = getConfig();
  return withRedis(async (redis) => {
    // Store null as special marker
    const value = permission === null ? '__NULL__' : permission;
    await redis.setex(`${CACHE_PREFIX}${key}`, config.ttlSeconds, value);
  }, undefined);
}

/**
 * Delete cached permission from Redis.
 * @param {string} key - Cache key
 * @returns {Promise<void>}
 */
async function deleteFromRedis(key) {
  return withRedis(async (redis) => {
    await redis.del(`${CACHE_PREFIX}${key}`);
  }, undefined);
}

/**
 * Get cached permission.
 * Tries Redis first, then falls back to memory cache.
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @returns {Promise<string|null|undefined>} Permission, null (no permission), or undefined (not cached)
 */
export async function getCachedPermission(presentationId, userEmail) {
  const key = makeCacheKey(presentationId, userEmail);

  // Try Redis first
  if (isRedisAvailable()) {
    const redisResult = await getFromRedis(key);
    if (redisResult !== undefined) {
      return redisResult;
    }
  }

  // Fall back to memory cache
  const entry = memoryCache.get(key);
  if (entry) {
    // Check if expired
    if (Date.now() < entry.expiresAt) {
      touchMemoryCache(key);
      return entry.permission;
    }
    // Expired, remove it
    memoryCache.delete(key);
  }

  return undefined;
}

/**
 * Set cached permission.
 * Stores in both Redis (if available) and memory cache.
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @param {string|null} permission - Permission to cache
 * @returns {Promise<void>}
 */
export async function setCachedPermission(
  presentationId,
  userEmail,
  permission,
) {
  const key = makeCacheKey(presentationId, userEmail);
  const config = getConfig();

  // Store in Redis
  if (isRedisAvailable()) {
    await setInRedis(key, permission);
  }

  // Also store in memory cache for local reads
  evictOldest();
  memoryCache.set(key, {
    permission,
    expiresAt: Date.now() + config.ttlSeconds * 1000,
  });
  touchMemoryCache(key);
}

/**
 * Invalidate cached permission for a specific user on a presentation.
 * Call this when permission changes.
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @returns {Promise<void>}
 */
export async function invalidatePermission(presentationId, userEmail) {
  const key = makeCacheKey(presentationId, userEmail);

  // Remove from Redis
  if (isRedisAvailable()) {
    await deleteFromRedis(key);
  }

  // Remove from memory cache
  memoryCache.delete(key);
  const idx = cacheAccessOrder.indexOf(key);
  if (idx !== -1) {
    cacheAccessOrder.splice(idx, 1);
  }
}

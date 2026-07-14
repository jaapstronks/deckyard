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
    ttlSeconds: Number(process.env.PERMISSION_CACHE_TTL_SECONDS) || DEFAULT_TTL_SECONDS,
    maxSize: Number(process.env.PERMISSION_CACHE_MAX_SIZE) || DEFAULT_MAX_SIZE,
  };
}

/**
 * Generate cache key for a permission lookup.
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @param {string} orgId - Organization ID
 * @returns {string} Cache key
 */
function makeCacheKey(presentationId, userEmail, orgId) {
  // Normalize to avoid case issues
  const email = (userEmail || '').toLowerCase().trim();
  return `${orgId}:${presentationId}:${email}`;
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
 * Delete all cached permissions for a presentation (wildcard delete).
 * @param {string} presentationId - Presentation ID
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
async function deleteByPresentationRedis(presentationId, orgId) {
  return withRedis(async (redis) => {
    const pattern = `${CACHE_PREFIX}${orgId}:${presentationId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }, undefined);
}

/**
 * Get cached permission.
 * Tries Redis first, then falls back to memory cache.
 * @param {string} presentationId - Presentation ID
 * @param {string} userEmail - User email
 * @param {string} orgId - Organization ID
 * @returns {Promise<string|null|undefined>} Permission, null (no permission), or undefined (not cached)
 */
export async function getCachedPermission(presentationId, userEmail, orgId) {
  const key = makeCacheKey(presentationId, userEmail, orgId);

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
 * @param {string} orgId - Organization ID
 * @param {string|null} permission - Permission to cache
 * @returns {Promise<void>}
 */
export async function setCachedPermission(presentationId, userEmail, orgId, permission) {
  const key = makeCacheKey(presentationId, userEmail, orgId);
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
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
export async function invalidatePermission(presentationId, userEmail, orgId) {
  const key = makeCacheKey(presentationId, userEmail, orgId);

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

/**
 * Invalidate all cached permissions for a presentation.
 * Call this when presentation permissions are bulk-changed.
 * @param {string} presentationId - Presentation ID
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
export async function invalidatePresentationPermissions(presentationId, orgId) {
  // Invalidate in Redis
  if (isRedisAvailable()) {
    await deleteByPresentationRedis(presentationId, orgId);
  }

  // Invalidate in memory cache (scan for matching keys)
  const prefix = `${orgId}:${presentationId}:`;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
      const idx = cacheAccessOrder.indexOf(key);
      if (idx !== -1) {
        cacheAccessOrder.splice(idx, 1);
      }
    }
  }
}

/**
 * Clear all cached permissions.
 * Useful for testing or when cache becomes stale.
 * @returns {Promise<void>}
 */
export async function clearAllPermissionCache() {
  // Clear Redis
  if (isRedisAvailable()) {
    await withRedis(async (redis) => {
      const keys = await redis.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }, undefined);
  }

  // Clear memory cache
  memoryCache.clear();
  cacheAccessOrder.length = 0;
}

/**
 * Get cache statistics.
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
  return {
    memorySize: memoryCache.size,
    maxSize: getConfig().maxSize,
    ttlSeconds: getConfig().ttlSeconds,
    redisAvailable: isRedisAvailable(),
  };
}

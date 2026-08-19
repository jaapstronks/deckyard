/**
 * Client-side cache layer for user profiles.
 *
 * Provides efficient access to user profile data (name, imageUrl)
 * with caching and batch fetching.
 *
 * **Keyed on the stable `users.id`, not on an address.** Responses that name a
 * person carry `{ id, displayName }` since D22 — the display name arrives with
 * the payload, so the only thing still worth fetching is the avatar image, and
 * the id is the key the client has for it. See shared/display-name.js and
 * server/storage/display-identity.js.
 */

import { api } from '../api.js';

// Cache storage
const profileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Pending batch requests
let pendingIds = new Set();
let batchTimer = null;
const BATCH_DELAY_MS = 50; // Debounce batch requests

/**
 * Get a user profile from cache.
 * @param {string} userId - Stable user id
 * @returns {Object|null} Profile object or null if not cached
 */
function getFromCache(userId) {
  const key = String(userId || '').trim();
  if (!key) return null;

  const entry = profileCache.get(key);
  if (!entry) return null;

  // Check if cache entry has expired
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    profileCache.delete(key);
    return null;
  }

  return entry.profile;
}

/**
 * Store a user profile in cache.
 * @param {string} userId - Stable user id
 * @param {Object} profile - Profile object { name, imageUrl }
 */
function setInCache(userId, profile) {
  const key = String(userId || '').trim();
  if (!key) return;

  profileCache.set(key, {
    profile: profile || { name: '', imageUrl: '' },
    timestamp: Date.now(),
  });
}

/**
 * Fetch profiles from the server.
 * @param {string[]} userIds - Array of stable user ids
 * @returns {Promise<Object>} Map of user id -> profile
 */
async function fetchProfilesFromServer(userIds) {
  if (!userIds.length) return {};

  try {
    const idParam = userIds.join(',');
    const resp = await api(
      `/api/users/profiles?ids=${encodeURIComponent(idParam)}`,
    );
    return resp?.profiles || {};
  } catch (err) {
    console.error('[user-profiles] Fetch failed:', err);
    return {};
  }
}

/**
 * Process pending batch requests.
 */
async function processBatch() {
  if (!pendingIds.size) return;

  // Get ids that aren't already cached
  const idsToFetch = Array.from(pendingIds).filter((id) => !getFromCache(id));
  pendingIds.clear();
  batchTimer = null;

  if (!idsToFetch.length) return;

  const profiles = await fetchProfilesFromServer(idsToFetch);

  // Cache the results
  for (const id of idsToFetch) {
    setInCache(id, profiles[id] || { name: '', imageUrl: '' });
  }
}

/**
 * Schedule a batch fetch for the given user id.
 * @param {string} userId - User id to fetch
 */
function scheduleBatchFetch(userId) {
  const key = String(userId || '').trim();
  if (!key) return;

  pendingIds.add(key);

  if (!batchTimer) {
    batchTimer = setTimeout(processBatch, BATCH_DELAY_MS);
  }
}

/**
 * Get a single user profile.
 *
 * Returns cached data immediately if available.
 * Otherwise, schedules a batch fetch and returns null.
 *
 * @param {string} userId - Stable user id
 * @returns {Object|null} Profile object { name, imageUrl } or null
 */
export function getUserProfile(userId) {
  const cached = getFromCache(userId);
  if (cached) return cached;

  // Schedule fetch but return null for now
  scheduleBatchFetch(userId);
  return null;
}

/**
 * Get a single user profile, waiting for fetch if needed.
 *
 * @param {string} userId - Stable user id
 * @returns {Promise<Object>} Profile object { name, imageUrl }
 */
export async function getUserProfileAsync(userId) {
  const key = String(userId || '').trim();
  if (!key) return { name: '', imageUrl: '' };

  // Check cache first
  const cached = getFromCache(key);
  if (cached) return cached;

  // Fetch directly (bypass batch for single async request)
  const profiles = await fetchProfilesFromServer([key]);
  const profile = profiles[key] || { name: '', imageUrl: '' };
  setInCache(key, profile);

  return profile;
}

/**
 * Prefetch profiles for a list of user ids.
 * Useful for warming the cache before rendering.
 *
 * @param {string[]} userIds - Array of stable user ids
 */
export function prefetchProfiles(userIds) {
  if (!Array.isArray(userIds)) return;

  for (const userId of userIds) {
    const key = String(userId || '').trim();
    if (key && !getFromCache(key)) {
      scheduleBatchFetch(key);
    }
  }
}

/**
 * Invalidate a cached profile (e.g., after update).
 *
 * @param {string} userId - User id to invalidate
 */
export function invalidateProfile(userId) {
  const key = String(userId || '').trim();
  if (key) {
    profileCache.delete(key);
  }
}

/**
 * Client-side cache layer for user profiles.
 *
 * Provides efficient access to user profile data (name, imageUrl)
 * with caching and batch fetching.
 */

import { api } from './api.js';

// Cache storage
const profileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Pending batch requests
let pendingEmails = new Set();
let batchTimer = null;
const BATCH_DELAY_MS = 50; // Debounce batch requests

/**
 * Get a user profile from cache.
 * @param {string} email - User email
 * @returns {Object|null} Profile object or null if not cached
 */
function getFromCache(email) {
  const key = String(email || '').toLowerCase().trim();
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
 * @param {string} email - User email
 * @param {Object} profile - Profile object { name, imageUrl }
 */
function setInCache(email, profile) {
  const key = String(email || '').toLowerCase().trim();
  if (!key) return;

  profileCache.set(key, {
    profile: profile || { name: '', imageUrl: '' },
    timestamp: Date.now(),
  });
}

/**
 * Fetch profiles from the server.
 * @param {string[]} emails - Array of email addresses
 * @returns {Promise<Object>} Map of email -> profile
 */
async function fetchProfilesFromServer(emails) {
  if (!emails.length) return {};

  try {
    const emailParam = emails.join(',');
    const resp = await api(`/api/users/profiles?emails=${encodeURIComponent(emailParam)}`);
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
  if (!pendingEmails.size) return;

  // Get emails that aren't already cached
  const emailsToFetch = Array.from(pendingEmails).filter(
    (email) => !getFromCache(email)
  );
  pendingEmails.clear();
  batchTimer = null;

  if (!emailsToFetch.length) return;

  const profiles = await fetchProfilesFromServer(emailsToFetch);

  // Cache the results
  for (const email of emailsToFetch) {
    const profile = profiles[email.toLowerCase()] || { name: '', imageUrl: '' };
    setInCache(email, profile);
  }
}

/**
 * Schedule a batch fetch for the given email.
 * @param {string} email - Email to fetch
 */
function scheduleBatchFetch(email) {
  const key = String(email || '').toLowerCase().trim();
  if (!key) return;

  pendingEmails.add(key);

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
 * @param {string} email - User email
 * @returns {Object|null} Profile object { name, imageUrl } or null
 */
export function getUserProfile(email) {
  const cached = getFromCache(email);
  if (cached) return cached;

  // Schedule fetch but return null for now
  scheduleBatchFetch(email);
  return null;
}

/**
 * Get a single user profile, waiting for fetch if needed.
 *
 * @param {string} email - User email
 * @returns {Promise<Object>} Profile object { name, imageUrl }
 */
export async function getUserProfileAsync(email) {
  const key = String(email || '').toLowerCase().trim();
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
 * Get multiple user profiles, fetching any not in cache.
 *
 * @param {string[]} emails - Array of email addresses
 * @returns {Promise<Object>} Map of email -> profile
 */
export async function getUserProfiles(emails) {
  if (!Array.isArray(emails) || !emails.length) return {};

  const normalizedEmails = emails
    .map((e) => String(e || '').toLowerCase().trim())
    .filter(Boolean);

  // Separate cached and uncached
  const result = {};
  const toFetch = [];

  for (const email of normalizedEmails) {
    const cached = getFromCache(email);
    if (cached) {
      result[email] = cached;
    } else {
      toFetch.push(email);
    }
  }

  // Fetch uncached profiles
  if (toFetch.length) {
    const fetched = await fetchProfilesFromServer(toFetch);

    for (const email of toFetch) {
      const profile = fetched[email] || { name: '', imageUrl: '' };
      setInCache(email, profile);
      result[email] = profile;
    }
  }

  return result;
}

/**
 * Prefetch profiles for a list of emails.
 * Useful for warming the cache before rendering.
 *
 * @param {string[]} emails - Array of email addresses
 */
export function prefetchProfiles(emails) {
  if (!Array.isArray(emails)) return;

  for (const email of emails) {
    const key = String(email || '').toLowerCase().trim();
    if (key && !getFromCache(key)) {
      scheduleBatchFetch(key);
    }
  }
}

/**
 * Invalidate a cached profile (e.g., after update).
 *
 * @param {string} email - Email to invalidate
 */
export function invalidateProfile(email) {
  const key = String(email || '').toLowerCase().trim();
  if (key) {
    profileCache.delete(key);
  }
}

/**
 * Clear all cached profiles.
 */
export function clearProfileCache() {
  profileCache.clear();
  pendingEmails.clear();
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
}
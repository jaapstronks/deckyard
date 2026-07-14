/**
 * Redis client manager.
 * Provides a lazy-loaded, singleton Redis connection.
 * Falls back gracefully when Redis is unavailable.
 *
 * Configuration via environment variables:
 * - REDIS_URL: Full Redis connection URL (e.g., redis://localhost:6379)
 * - REDIS_HOST: Redis host (default: localhost)
 * - REDIS_PORT: Redis port (default: 6379)
 * - REDIS_PASSWORD: Redis password (optional)
 * - REDIS_DB: Redis database number (default: 0)
 * - REDIS_ENABLED: Set to 'false' to explicitly disable Redis (default: true if URL/host configured)
 */

let redisClient = null;
let redisAvailable = null; // null = unknown, true = connected, false = unavailable
let connectionPromise = null;

/**
 * Check if Redis is configured and enabled.
 * @returns {boolean}
 */
export function isRedisConfigured() {
  const enabled = process.env.REDIS_ENABLED;
  if (enabled === 'false' || enabled === '0') {
    return false;
  }
  return !!(process.env.REDIS_URL || process.env.REDIS_HOST);
}

/**
 * Get the Redis connection URL from environment.
 * @returns {string|null}
 */
function getRedisUrl() {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;
  const db = process.env.REDIS_DB || '0';

  if (password) {
    return `redis://:${password}@${host}:${port}/${db}`;
  }
  return `redis://${host}:${port}/${db}`;
}

/**
 * Initialize the Redis client connection.
 * Uses lazy loading to avoid requiring ioredis when Redis is not configured.
 * @returns {Promise<Object|null>} Redis client or null if unavailable
 */
async function initializeRedis() {
  if (!isRedisConfigured()) {
    redisAvailable = false;
    return null;
  }

  try {
    // Dynamic import to avoid requiring ioredis when not needed
    const { default: Redis } = await import('ioredis');

    const url = getRedisUrl();
    const client = new Redis(url, {
      // Connection options
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 5000,
      commandTimeout: 3000,

      // Reconnection options
      retryStrategy(times) {
        if (times > 10) {
          console.warn('[redis] Max reconnection attempts reached, giving up');
          return null; // Stop retrying
        }
        // Exponential backoff: 50ms, 100ms, 200ms, ... max 3s
        return Math.min(times * 50, 3000);
      },

      // Don't log everything
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log('[redis] Connected successfully');
    redisAvailable = true;
    redisClient = client;

    // Handle connection events
    client.on('error', (err) => {
      console.warn('[redis] Connection error:', err.message);
      redisAvailable = false;
    });

    client.on('reconnecting', () => {
      console.log('[redis] Reconnecting...');
    });

    client.on('ready', () => {
      console.log('[redis] Connection restored');
      redisAvailable = true;
    });

    client.on('end', () => {
      console.log('[redis] Connection closed');
      redisAvailable = false;
      redisClient = null;
    });

    return client;
  } catch (err) {
    console.warn('[redis] Failed to connect:', err.message);
    console.warn('[redis] Falling back to in-memory operations');
    redisAvailable = false;
    return null;
  }
}

/**
 * Get the Redis client instance.
 * Initializes connection on first call if Redis is configured.
 * @returns {Promise<Object|null>} Redis client or null if unavailable
 */
export async function getRedisClient() {
  // Already initialized
  if (redisClient !== null || redisAvailable === false) {
    return redisClient;
  }

  // Initialization in progress
  if (connectionPromise) {
    return connectionPromise;
  }

  // Start initialization
  connectionPromise = initializeRedis();
  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

/**
 * Check if Redis is currently available.
 * Returns cached status without attempting to connect.
 * @returns {boolean}
 */
export function isRedisAvailable() {
  return redisAvailable === true;
}

/**
 * Check if Redis might be available.
 * Returns true if configured and not known to be unavailable.
 * @returns {boolean}
 */
export function mightRedisBeAvailable() {
  if (redisAvailable === false) return false;
  return isRedisConfigured();
}

/**
 * Close the Redis connection.
 * Call this during graceful shutdown.
 */
export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('[redis] Connection closed gracefully');
    } catch (err) {
      console.warn('[redis] Error during close:', err.message);
    }
    redisClient = null;
    redisAvailable = false;
  }
}

/**
 * Execute a Redis command with automatic fallback.
 * If Redis is unavailable, returns the fallback value.
 * @param {Function} fn - Async function that receives the Redis client
 * @param {*} fallback - Value to return if Redis is unavailable
 * @returns {Promise<*>} Result of fn or fallback
 */
export async function withRedis(fn, fallback) {
  const client = await getRedisClient();
  if (!client) {
    return fallback;
  }

  try {
    return await fn(client);
  } catch (err) {
    console.warn('[redis] Command failed:', err.message);
    return fallback;
  }
}

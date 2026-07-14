/**
 * BullMQ job queue connection manager.
 * Provides shared Redis connection for all queues and workers.
 *
 * Uses the same Redis configuration as the rate limiter.
 * Falls back to synchronous execution when Redis is unavailable.
 *
 * Queue names:
 * - export: PDF, PPTX, PNG, and other export jobs
 * - translate: AI translation jobs
 * - heavy: Other CPU-intensive operations
 */

import { isRedisConfigured, getRedisClient } from '../../utils/redis-client.js';

let queues = null;
let workers = [];
let isInitialized = false;
let initPromise = null;

/**
 * Queue configuration.
 */
export const QUEUE_NAMES = {
  EXPORT: 'export',
  TRANSLATE: 'translate',
  HEAVY: 'heavy',
};

/**
 * Default job options per queue.
 */
export const DEFAULT_JOB_OPTIONS = {
  export: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 }, // Keep completed jobs for 1 hour
    removeOnFail: { age: 86400 }, // Keep failed jobs for 1 day
  },
  translate: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
  heavy: {
    attempts: 1,
    removeOnComplete: { age: 1800 },
    removeOnFail: { age: 86400 },
  },
};

/**
 * Check if the job queue is available.
 * @returns {boolean}
 */
export function isQueueAvailable() {
  return isInitialized && queues !== null;
}

/**
 * Check if the queue might be available.
 * @returns {boolean}
 */
export function mightQueueBeAvailable() {
  return isRedisConfigured();
}

/**
 * Get Redis connection options for BullMQ.
 * @returns {Object} Connection options
 */
function getConnectionOptions() {
  const url = process.env.REDIS_URL;
  if (url) {
    return { url };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
  };
}

/**
 * Initialize the job queue system.
 * Call this during server startup.
 * @returns {Promise<boolean>} True if queues are available
 */
export async function initializeQueues() {
  if (isInitialized) return isQueueAvailable();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isRedisConfigured()) {
      console.log('[queue] Redis not configured, using synchronous fallback');
      isInitialized = true;
      return false;
    }

    try {
      // Ensure Redis connection is established first
      const redis = await getRedisClient();
      if (!redis) {
        console.log('[queue] Redis unavailable, using synchronous fallback');
        isInitialized = true;
        return false;
      }

      // Dynamic import BullMQ
      const { Queue } = await import('bullmq');

      const connection = getConnectionOptions();

      queues = {
        [QUEUE_NAMES.EXPORT]: new Queue(QUEUE_NAMES.EXPORT, { connection }),
        [QUEUE_NAMES.TRANSLATE]: new Queue(QUEUE_NAMES.TRANSLATE, { connection }),
        [QUEUE_NAMES.HEAVY]: new Queue(QUEUE_NAMES.HEAVY, { connection }),
      };

      console.log('[queue] Job queues initialized');
      isInitialized = true;
      return true;
    } catch (err) {
      console.warn('[queue] Failed to initialize:', err.message);
      console.log('[queue] Using synchronous fallback');
      isInitialized = true;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Get a queue by name.
 * @param {string} name - Queue name
 * @returns {Object|null} Queue instance or null
 */
export function getQueue(name) {
  if (!queues) return null;
  return queues[name] || null;
}

/**
 * Add a job to a queue.
 * Falls back to synchronous execution if queue is unavailable.
 * @param {string} queueName - Queue name
 * @param {string} jobName - Job type name
 * @param {Object} data - Job data
 * @param {Object} [options] - Job options
 * @returns {Promise<{jobId: string, queued: boolean}>}
 */
export async function addJob(queueName, jobName, data, options = {}) {
  const queue = getQueue(queueName);

  if (!queue) {
    // Synchronous fallback - return special ID
    return {
      jobId: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queued: false,
      data,
    };
  }

  const jobOptions = {
    ...DEFAULT_JOB_OPTIONS[queueName],
    ...options,
  };

  const job = await queue.add(jobName, data, jobOptions);

  return {
    jobId: job.id,
    queued: true,
  };
}

/**
 * Get job status.
 * @param {string} queueName - Queue name
 * @param {string} jobId - Job ID
 * @returns {Promise<Object|null>} Job status or null if not found
 */
export async function getJobStatus(queueName, jobId) {
  const queue = getQueue(queueName);
  if (!queue) return null;

  try {
    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress;

    return {
      id: job.id,
      name: job.name,
      state, // 'waiting', 'active', 'completed', 'failed', 'delayed'
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
    };
  } catch (err) {
    console.warn('[queue] Error getting job status:', err.message);
    return null;
  }
}

/**
 * Register a worker for processing jobs.
 * @param {string} queueName - Queue name
 * @param {Function} processor - Job processor function
 * @param {Object} [options] - Worker options
 * @returns {Promise<Object|null>} Worker instance or null
 */
export async function registerWorker(queueName, processor, options = {}) {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const { Worker } = await import('bullmq');
    const connection = getConnectionOptions();

    const worker = new Worker(queueName, processor, {
      connection,
      concurrency: options.concurrency || 2,
      ...options,
    });

    worker.on('completed', (job) => {
      console.log(`[worker:${queueName}] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[worker:${queueName}] Job ${job?.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`[worker:${queueName}] Worker error:`, err.message);
    });

    workers.push(worker);
    console.log(`[worker:${queueName}] Worker registered`);

    return worker;
  } catch (err) {
    console.warn('[queue] Failed to register worker:', err.message);
    return null;
  }
}

/**
 * Close all queues and workers.
 * Call this during graceful shutdown.
 */
export async function closeQueues() {
  // Close workers first
  for (const worker of workers) {
    try {
      await worker.close();
    } catch (err) {
      console.warn('[queue] Error closing worker:', err.message);
    }
  }
  workers = [];

  // Close queues
  if (queues) {
    for (const queue of Object.values(queues)) {
      try {
        await queue.close();
      } catch (err) {
        console.warn('[queue] Error closing queue:', err.message);
      }
    }
    queues = null;
  }

  isInitialized = false;
  initPromise = null;
  console.log('[queue] Queues closed');
}

/**
 * Get queue statistics.
 * @param {string} queueName - Queue name
 * @returns {Promise<Object|null>} Queue statistics
 */
export async function getQueueStats(queueName) {
  const queue = getQueue(queueName);
  if (!queue) return null;

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed,
    };
  } catch (err) {
    console.warn('[queue] Error getting queue stats:', err.message);
    return null;
  }
}

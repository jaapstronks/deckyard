/**
 * Shared helpers for PostgreSQL storage adapters.
 */

import { getDb, sql } from '../../../db/client.js';
import { getOrgId } from '../../../utils/context.js';

export { getDb, sql, getOrgId };

/**
 * Helper to properly serialize JSONB values for PostgreSQL.
 * @param {any} value
 * @returns {any}
 */
export function jsonb(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

/**
 * Get current ISO timestamp.
 * @returns {string}
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Default pagination options.
 */
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

/**
 * Normalize pagination options.
 * @param {object} opts - Options object
 * @param {number} [opts.limit] - Max items to return
 * @param {number} [opts.offset] - Items to skip
 * @returns {{ limit: number, offset: number }}
 */
export function normalizePagination(opts = {}) {
  let limit = opts?.limit;
  let offset = opts?.offset || 0;

  // Apply defaults and limits
  if (typeof limit !== 'number' || limit < 1) {
    limit = DEFAULT_LIMIT;
  }
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }
  if (typeof offset !== 'number' || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

/**
 * Apply pagination to a query.
 * @param {object} query - Kysely query builder
 * @param {object} opts - Pagination options
 * @returns {object} Query with pagination applied
 */
export function applyPagination(query, opts = {}) {
  const { limit, offset } = normalizePagination(opts);

  let q = query.limit(limit);
  if (offset > 0) {
    q = q.offset(offset);
  }
  return q;
}
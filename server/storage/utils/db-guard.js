/**
 * Database availability guard utilities.
 * Helps reduce repetitive `if (!isDatabaseAvailable()) return fallback;` patterns.
 */

import { getDb, isDatabaseAvailable } from '../../db/client.js';

/**
 * Execute a function only if the database is available.
 * Returns the fallback value if database is unavailable.
 *
 * @param {*} fallback - Value to return if database is unavailable
 * @param {Function} fn - Async function to execute, receives db instance as first argument
 * @returns {Promise<*>} Result of fn() or fallback
 *
 * @example
 * // Before:
 * export async function listItems(ctx) {
 *   if (!isDatabaseAvailable()) return [];
 *   const db = getDb();
 *   // ... rest of function
 * }
 *
 * // After:
 * export async function listItems(ctx) {
 *   return withDbGuard([], async (db) => {
 *     // ... rest of function
 *   });
 * }
 */
export async function withDbGuard(fallback, fn) {
  if (!isDatabaseAvailable()) return fallback;
  const db = getDb();
  return fn(db);
}

/**
 * Synchronous version of withDbGuard for non-async functions.
 *
 * @param {*} fallback - Value to return if database is unavailable
 * @param {Function} fn - Function to execute, receives db instance as first argument
 * @returns {*} Result of fn() or fallback
 */
export function withDbGuardSync(fallback, fn) {
  if (!isDatabaseAvailable()) return fallback;
  const db = getDb();
  return fn(db);
}

/**
 * Check if database is unavailable and return a fallback.
 * Useful when you need to keep existing function structure but reduce boilerplate.
 *
 * @param {*} fallback - Value to return if database is unavailable
 * @returns {{ unavailable: boolean, fallback: * }} Object with unavailable flag and fallback value
 *
 * @example
 * export async function getItem(id, ctx) {
 *   const guard = dbGuard(null);
 *   if (guard.unavailable) return guard.fallback;
 *   const db = getDb();
 *   // ... rest of function
 * }
 */
export function dbGuard(fallback) {
  return {
    unavailable: !isDatabaseAvailable(),
    fallback,
  };
}
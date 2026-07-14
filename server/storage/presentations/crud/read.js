/**
 * CRUD read operations.
 */

import { readPresentation } from '../io.js';
import {
  cleanupExpiredSandboxPresentation,
  isSandboxExpiredPresentation,
} from '../sandbox.js';
import { normalizeMeta } from './helpers.js';

/**
 * Get a presentation by ID.
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @returns {Promise<Object|null>} Normalized presentation or null
 */
export async function getPresentation(repoRoot, id) {
  const pres = await readPresentation(repoRoot, id);
  if (pres && isSandboxExpiredPresentation(pres)) {
    await cleanupExpiredSandboxPresentation(repoRoot, pres);
    return null;
  }
  return normalizeMeta(pres);
}

/**
 * Batch-fetch first slides for multiple presentations.
 * More efficient than calling getPresentation N times.
 * @param {string} repoRoot - Repository root path
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(repoRoot, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  // Read all requested presentations in parallel
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const pres = await readPresentation(repoRoot, id);
        if (!pres) return [id, null];

        // Extract first slide from dominant language version if available
        const dominant = pres?.i18n?.dominant;
        let slides = pres.slides;
        if (
          dominant &&
          pres?.i18n?.versions?.[dominant] &&
          Array.isArray(pres.i18n.versions[dominant].slides)
        ) {
          slides = pres.i18n.versions[dominant].slides;
        }

        const first = slides?.[0];
        if (!first || typeof first !== 'object') return [id, null];

        return [
          id,
          {
            id: first.id,
            type: first.type,
            content: first.content || {},
          },
        ];
      } catch {
        return [id, null];
      }
    })
  );

  return new Map(results);
}

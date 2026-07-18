/**
 * Prompt versioning.
 *
 * `claude-opus-4-8` takes no temperature, so a run is reproducible only up to
 * model + effort + the prompts themselves. Hashing the prompt-bearing source
 * files gives every run a version that ties its scores to the exact prompts
 * that produced them -- which is what makes the phase 4 iteration loop
 * auditable.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PROMPT_SOURCE_FILES, REPO_ROOT } from './config.js';

/**
 * Hash the prompt-bearing source files.
 *
 * @returns {Promise<{hash: string, files: Record<string, string>}>} Combined
 *   short hash plus a per-file hash map, so a diff between two runs can point
 *   at which prompt file actually moved.
 */
export async function computePromptVersion() {
  const files = {};
  const combined = crypto.createHash('sha256');

  for (const relative of [...PROMPT_SOURCE_FILES].sort()) {
    let content = '';
    try {
      content = await fs.readFile(path.join(REPO_ROOT, relative), 'utf8');
    } catch {
      // A renamed or removed prompt file is itself a meaningful change; record
      // it as absent rather than failing the run.
      content = '\0missing';
    }
    const fileHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    files[relative] = fileHash;
    combined.update(`${relative}:${fileHash}\n`);
  }

  return { hash: combined.digest('hex').slice(0, 12), files };
}

/**
 * List the prompt files that differ between two prompt versions.
 *
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 * @returns {string[]} Relative paths that changed
 */
export function changedPromptFiles(before = {}, after = {}) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

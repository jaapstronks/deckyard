/**
 * File-based storage for presentation tags.
 *
 * The Postgres adapter keeps tags in dedicated `tags` / `presentation_tags`
 * tables; the file adapter mirrors that shape in a single `tags.json` store so
 * the default (file storage) install has a working tag feature instead of a
 * 500. The store keeps a flat tag list plus a presentationId → tagId link map,
 * which survives normal deck edits (deck JSON never carries tag state).
 *
 * Tag IDs are synthesised from the normalized name (`tag_<lowercased-name>`),
 * so the same name always resolves to the same id and the API shape
 * (`{ id, name }` / `{ id, name, count }`) matches the Postgres adapter.
 */

import path from 'node:path';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';

const MAX_TAG_LEN = 100;

function storePath(repoRoot) {
  return path.join(dataDir(repoRoot), 'tags.json');
}

async function readStore(p) {
  const parsed = await readJsonIfExists(p);
  const tags =
    parsed && typeof parsed === 'object' && Array.isArray(parsed.tags)
      ? parsed.tags
      : [];
  const links =
    parsed && typeof parsed === 'object' && parsed.links && typeof parsed.links === 'object'
      ? parsed.links
      : {};
  return { v: 1, tags, links };
}

async function writeStore(p, store) {
  await writeJsonAtomic(p, { v: 1, tags: store.tags, links: store.links });
}

/**
 * Normalize a tag name: trim and clamp length. Returns '' for invalid input.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeName(raw) {
  const name = String(raw || '').trim();
  if (!name || name.length > MAX_TAG_LEN) return '';
  return name;
}

/**
 * Deterministic tag id from a name (case-insensitive), matching the Postgres
 * adapter's "one tag per name" invariant.
 * @param {string} name
 * @returns {string}
 */
function tagIdFor(name) {
  return `tag_${name.toLowerCase()}`;
}

/**
 * Find a tag by name (case-insensitive) in the store, or null.
 */
function findTagByName(store, name) {
  const lower = name.toLowerCase();
  return store.tags.find((t) => String(t?.name || '').toLowerCase() === lower) || null;
}

/**
 * Ensure a tag exists in the store, returning its `{ id, name }`. Mutates
 * `store` in place; caller persists.
 */
function ensureTag(store, name) {
  const existing = findTagByName(store, name);
  if (existing) return { id: existing.id, name: existing.name };
  const tag = { id: tagIdFor(name), name };
  store.tags.push(tag);
  return { id: tag.id, name: tag.name };
}

/**
 * Count how many presentations reference each tag id.
 * @returns {Map<string, number>}
 */
function countByTagId(store) {
  const counts = new Map();
  for (const ids of Object.values(store.links)) {
    if (!Array.isArray(ids)) continue;
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

/**
 * List all tags with usage counts, sorted by name.
 * @param {string} repoRoot
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags(repoRoot) {
  const store = await readStore(storePath(repoRoot));
  const counts = countByTagId(store);
  return store.tags
    .map((t) => ({ id: t.id, name: t.name, count: counts.get(t.id) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get tags for a single presentation, sorted by name.
 * @param {string} repoRoot
 * @param {string} presentationId
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(repoRoot, presentationId) {
  const store = await readStore(storePath(repoRoot));
  const ids = store.links[String(presentationId)] || [];
  const byId = new Map(store.tags.map((t) => [t.id, t]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get tags for many presentations at once (list views).
 * @param {string} repoRoot
 * @param {string[]} presentationIds
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(repoRoot, presentationIds) {
  const result = new Map();
  if (!Array.isArray(presentationIds) || presentationIds.length === 0) return result;
  const store = await readStore(storePath(repoRoot));
  const byId = new Map(store.tags.map((t) => [t.id, t]));
  for (const pid of presentationIds) {
    const ids = store.links[String(pid)] || [];
    const tags = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (tags.length) result.set(String(pid), tags);
  }
  return result;
}

/**
 * Replace the tags for a presentation. Creates tags as needed and prunes the
 * link entry when empty.
 * @param {string} repoRoot
 * @param {string} presentationId
 * @param {string[]} tagNames
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function setTagsForPresentation(repoRoot, presentationId, tagNames) {
  const p = storePath(repoRoot);
  const store = await readStore(p);

  const seen = new Set();
  const resolved = [];
  for (const raw of Array.isArray(tagNames) ? tagNames : []) {
    const name = normalizeName(raw);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    resolved.push(ensureTag(store, name));
  }

  const pid = String(presentationId);
  if (resolved.length === 0) {
    delete store.links[pid];
  } else {
    store.links[pid] = resolved.map((t) => t.id);
  }
  await writeStore(p, store);
  return resolved.map((t) => ({ id: t.id, name: t.name }));
}

/**
 * Create a tag if it doesn't exist (case-insensitive).
 * @param {string} repoRoot
 * @param {string} name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createTag(repoRoot, name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    const err = new Error('Invalid tag name');
    err.statusCode = 400;
    throw err;
  }
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const tag = ensureTag(store, normalized);
  await writeStore(p, store);
  return tag;
}

/**
 * Delete a tag and remove it from every presentation link.
 * @param {string} repoRoot
 * @param {string} tagId
 * @returns {Promise<boolean>}
 */
export async function deleteTag(repoRoot, tagId) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const before = store.tags.length;
  store.tags = store.tags.filter((t) => t.id !== tagId);
  if (store.tags.length === before) return false;
  for (const pid of Object.keys(store.links)) {
    const ids = (store.links[pid] || []).filter((id) => id !== tagId);
    if (ids.length) store.links[pid] = ids;
    else delete store.links[pid];
  }
  await writeStore(p, store);
  return true;
}

/**
 * Search tags by name prefix (autocomplete), sorted by name.
 * @param {string} repoRoot
 * @param {string} prefix
 * @param {number} [limit=10]
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(repoRoot, prefix, limit = 10) {
  const all = await listTags(repoRoot);
  const term = String(prefix || '').trim().toLowerCase();
  const matched = term
    ? all.filter((t) => t.name.toLowerCase().startsWith(term))
    : all;
  return matched.slice(0, Math.max(0, Number(limit) || 10));
}

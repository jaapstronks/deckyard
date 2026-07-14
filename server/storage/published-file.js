/**
 * File-based published presentations storage.
 * Original implementation preserved for fallback and OSS mode.
 */

import path from 'node:path';
import { safeSlug } from '../utils/slug.js';
import { dataDir } from '../config/storage-paths.js';
import { nowIso } from '../utils/normalize.js';
import { readJsonIfExists, writeJsonAtomic } from './io.js';

function publishedDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'published');
}

function indexPath(repoRoot) {
  return path.join(publishedDir(repoRoot), 'index.json');
}

export async function getPublishedIndex(repoRoot) {
  const idx = await readJsonIfExists(indexPath(repoRoot));
  if (!idx || typeof idx !== 'object') return {};
  return idx;
}

export async function getPublishedById(repoRoot, publishId) {
  const id = String(publishId || '').trim();
  if (!id) return null;
  const idx = await getPublishedIndex(repoRoot);
  const entry = idx?.[id];
  if (!entry || typeof entry !== 'object') return null;
  return {
    publishId: id,
    presentationId: entry.presentationId || null,
    slug: entry.slug || '',
    ogImageUrl: entry.ogImageUrl || '',
    modified: entry.modified || null,
    created: entry.created || null,
  };
}

export async function upsertPublishedEntry(
  repoRoot,
  { publishId, presentationId, title, ogImageUrl }
) {
  const id = String(publishId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!id) throw new Error('publishId is required');
  if (!pid) throw new Error('presentationId is required');

  const now = nowIso();
  const idx = await getPublishedIndex(repoRoot);
  const existing = idx?.[id];
  const created =
    existing &&
    typeof existing === 'object' &&
    existing.created
      ? existing.created
      : now;

  const slug = safeSlug(
    title || existing?.title || 'presentation'
  );
  idx[id] = {
    publishId: id,
    presentationId: pid,
    title: String(title || ''),
    slug,
    ogImageUrl:
      typeof ogImageUrl === 'string' ? ogImageUrl : '',
    created,
    modified: now,
  };
  await writeJsonAtomic(indexPath(repoRoot), idx);
  return idx[id];
}

export async function removePublishedEntry(repoRoot, publishId) {
  const id = String(publishId || '').trim();
  if (!id) return false;
  const idx = await getPublishedIndex(repoRoot);
  if (!idx?.[id]) return false;
  delete idx[id];
  await writeJsonAtomic(indexPath(repoRoot), idx);
  return true;
}

export async function updatePublishedSlug(repoRoot, publishId, nextSlug) {
  const id = String(publishId || '').trim();
  if (!id) throw new Error('publishId is required');
  const idx = await getPublishedIndex(repoRoot);
  const existing = idx?.[id];
  if (!existing || typeof existing !== 'object')
    throw new Error('Published entry not found');

  const now = nowIso();
  const slug = safeSlug(nextSlug);
  idx[id] = {
    ...existing,
    slug,
    modified: now,
  };
  await writeJsonAtomic(indexPath(repoRoot), idx);
  return idx[id];
}
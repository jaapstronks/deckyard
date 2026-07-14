import fs from 'node:fs/promises';
import path from 'node:path';
import { presDir } from './presentations/paths.js';
import { readJsonIfExists } from './presentations/io.js';
import { getPublishedIndex } from './published.js';

function pickTitle(pres) {
  const dominant =
    pres?.i18n?.dominant === 'nl' || pres?.i18n?.dominant === 'en-GB'
      ? pres.i18n.dominant
      : null;
  if (
    dominant &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[dominant] &&
    typeof pres.i18n.versions[dominant] === 'object' &&
    typeof pres.i18n.versions[dominant].title === 'string' &&
    pres.i18n.versions[dominant].title.trim()
  ) {
    return pres.i18n.versions[dominant].title.trim();
  }
  return typeof pres?.title === 'string' ? pres.title : '';
}

function containsUrl(val, url, depth = 0) {
  if (depth > 6) return false;
  if (typeof val === 'string') return val.trim() === url;
  if (Array.isArray(val)) {
    for (const it of val) if (containsUrl(it, url, depth + 1)) return true;
    return false;
  }
  if (val && typeof val === 'object') {
    for (const v of Object.values(val))
      if (containsUrl(v, url, depth + 1)) return true;
  }
  return false;
}

function presUsesUrl(pres, url) {
  if (!pres || typeof pres !== 'object') return false;
  if (Array.isArray(pres?.slides)) {
    for (const s of pres.slides) {
      if (!s || typeof s !== 'object') continue;
      if (containsUrl(s?.content, url)) return true;
    }
  }
  const versions =
    pres?.i18n?.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : null;
  if (versions) {
    for (const v of Object.values(versions)) {
      const slides = Array.isArray(v?.slides) ? v.slides : null;
      if (!slides) continue;
      for (const s of slides) {
        if (!s || typeof s !== 'object') continue;
        if (containsUrl(s?.content, url)) return true;
      }
    }
  }
  return false;
}

export async function getImageLibraryUsage(repoRoot, url) {
  const u = String(url || '').trim();
  if (!u) return [];

  const idx = await getPublishedIndex(repoRoot);
  const publishedByPresId = new Map();
  for (const [publishId, entry] of Object.entries(idx || {})) {
    const pid = String(entry?.presentationId || '').trim();
    if (!pid) continue;
    const arr = publishedByPresId.get(pid) || [];
    arr.push({
      publishId,
      slug: entry?.slug || '',
      modified: entry?.modified || null,
      created: entry?.created || null,
    });
    publishedByPresId.set(pid, arr);
  }

  const dir = presDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    const pres = await readJsonIfExists(full);
    if (!presUsesUrl(pres, u)) continue;
    const id = String(pres?.id || '').trim();
    out.push({
      id,
      title: pickTitle(pres),
      modified: typeof pres?.modified === 'string' ? pres.modified : null,
      published: publishedByPresId.get(id) || [],
    });
  }
  out.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return out;
}

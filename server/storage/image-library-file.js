import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../config/storage-paths.js';
import { nowIso } from '../utils/normalize.js';
import { cleanStr } from '../../shared/string-utils.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import { readJsonIfExists } from './io.js';

function libraryPath(repoRoot) {
  return path.join(dataDir(repoRoot), 'image-library.json');
}

async function readLibrary(repoRoot) {
  const p = libraryPath(repoRoot);
  const parsed = await readJsonIfExists(p);
  // We keep storage canonical and migrate old formats in-place to avoid carrying
  // long-term back-compat clutter in the rest of the code.
  const lib = Array.isArray(parsed)
    ? { items: parsed }
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.items)
      ? { items: parsed.items }
      : { items: [] };
  const migrated = migrateLibraryIfNeeded(lib);
  if (migrated.changed) {
    await writeLibrary(repoRoot, migrated.lib);
  }
  return migrated.lib;
}

async function writeLibrary(repoRoot, lib) {
  const p = libraryPath(repoRoot);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = path.join(
    path.dirname(p),
    `image-library.${crypto.randomUUID()}.tmp`
  );
  await fs.writeFile(tmp, JSON.stringify(lib, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

function normalizeTags(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const v of arr) {
    const t = cleanStr(v, { max: 40 }).toLowerCase();
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

function normalizeAlts(input) {
  // Canonical shape: { nl: string, 'en-GB': string }
  const out = { nl: '', 'en-GB': '' };
  const src = input && typeof input === 'object' ? input : {};
  for (const [k, v] of Object.entries(src)) {
    const lang = normalizeLang(k);
    if (!lang) continue;
    out[lang] = cleanStr(v, { max: 220 });
  }
  return out;
}

function migrateLibraryIfNeeded(lib) {
  const items = Array.isArray(lib?.items) ? lib.items : [];
  let changed = false;

  const nextItems = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const id = cleanStr(raw.id, { max: 80 });
    const url = cleanStr(raw.url, { max: 500 });
    if (!id || !url) continue;

    // Migration from old shapes:
    // - title -> description
    // - altNl/altEn -> alts
    const description =
      cleanStr(raw.description, { max: 200 }) ||
      cleanStr(raw.title, { max: 200 });
    const photographer = cleanStr(raw.photographer, { max: 120 });
    const tags = normalizeTags(raw.tags);
    const alts =
      raw.alts && typeof raw.alts === 'object'
        ? normalizeAlts(raw.alts)
        : normalizeAlts({ nl: raw.altNl, 'en-GB': raw.altEn });

    const created =
      typeof raw.created === 'string' && raw.created.trim()
        ? raw.created
        : '';
    const modified =
      typeof raw.modified === 'string' && raw.modified.trim()
        ? raw.modified
        : '';

    // Detect if we're dropping legacy keys or normalizing shape.
    if (
      raw.title != null ||
      raw.altNl != null ||
      raw.altEn != null ||
      typeof raw.description !== 'string' ||
      !raw.alts ||
      !Array.isArray(raw.tags) ||
      // Drop experimental rights metadata if it ever existed in storage.
      raw.rights != null ||
      raw.license != null ||
      raw.attribution != null
    ) {
      changed = true;
    }

    // Preserve source attribution for stock media
    const source = cleanStr(raw.source, { max: 40 });
    const sourceUrl = cleanStr(raw.sourceUrl, { max: 500 });

    nextItems.push({
      id,
      url,
      description,
      photographer,
      tags,
      alts,
      created,
      modified,
      ...(source ? { source } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }

  // Ensure top-level structure is canonical too.
  const nextLib = { items: nextItems };
  if (!changed) {
    // If parsed was an array or had other top-level props, normalize.
    if (!lib || typeof lib !== 'object' || Object.keys(lib).length !== 1)
      changed = true;
  }

  return { lib: nextLib, changed };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanStr(raw.id, { max: 80 });
  const url = cleanStr(raw.url, { max: 500 });
  if (!id || !url) return null;

  const description = cleanStr(raw.description, { max: 200 });
  const photographer = cleanStr(raw.photographer, { max: 120 });
  const tags = normalizeTags(raw.tags);
  const alts =
    raw.alts && typeof raw.alts === 'object'
      ? normalizeAlts(raw.alts)
      : normalizeAlts({});

  const created =
    typeof raw.created === 'string' && raw.created.trim()
      ? raw.created
      : '';
  const modified =
    typeof raw.modified === 'string' && raw.modified.trim()
      ? raw.modified
      : '';

  // Stock media attribution
  const source = cleanStr(raw.source, { max: 40 });
  const sourceUrl = cleanStr(raw.sourceUrl, { max: 500 });

  return {
    id,
    url,
    description,
    photographer,
    tags,
    alts,
    created,
    modified,
    ...(source ? { source } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export async function listImageLibrary(repoRoot) {
  const lib = await readLibrary(repoRoot);
  const items = Array.isArray(lib.items) ? lib.items : [];
  // Sort by description (stable), then newest first.
  return items
    .slice()
    .map(normalizeItem)
    .filter(Boolean)
    .sort((a, b) => {
      const at = String(a?.description || '').toLowerCase();
      const bt = String(b?.description || '').toLowerCase();
      if (at !== bt) return at.localeCompare(bt);
      return String(b?.created || '').localeCompare(String(a?.created || ''));
    });
}

export async function getImageLibraryItem(repoRoot, id) {
  const lib = await readLibrary(repoRoot);
  const items = Array.isArray(lib.items) ? lib.items : [];
  const found =
    items.find((x) => x && typeof x === 'object' && x.id === id) || null;
  return normalizeItem(found);
}

export async function createImageLibraryItem(repoRoot, input) {
  const url = cleanStr(input?.url, { max: 500 });
  if (!url) {
    const err = new Error('url is required');
    err.statusCode = 400;
    throw err;
  }

  const now = nowIso();
  const source = cleanStr(input?.source, { max: 40 });
  const sourceUrl = cleanStr(input?.sourceUrl, { max: 500 });

  const item = {
    id: crypto.randomUUID(),
    url,
    description: cleanStr(input?.description, { max: 200 }),
    photographer: cleanStr(input?.photographer, { max: 120 }),
    tags: normalizeTags(input?.tags),
    alts: normalizeAlts(input?.alts),
    created: now,
    modified: now,
    ...(source ? { source } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };

  const lib = await readLibrary(repoRoot);
  lib.items = Array.isArray(lib.items) ? lib.items : [];
  lib.items.push(item);
  await writeLibrary(repoRoot, lib);
  return normalizeItem(item);
}

export async function updateImageLibraryItem(repoRoot, id, patch) {
  const lib = await readLibrary(repoRoot);
  lib.items = Array.isArray(lib.items) ? lib.items : [];
  const idx = lib.items.findIndex((x) => x?.id === id);
  if (idx < 0) return null;

  const cur = lib.items[idx] || {};
  const curNorm = normalizeItem(cur) || {};
  const next = {
    ...cur,
    url: cleanStr(patch?.url, { max: 500 }) || curNorm.url || cur.url,
    description:
      cleanStr(patch?.description, { max: 200 }) ||
      curNorm.description ||
      cur.description ||
      '',
    photographer: cleanStr(patch?.photographer, { max: 120 }) || curNorm.photographer || cur.photographer || '',
    tags:
      patch?.tags != null ? normalizeTags(patch.tags) : curNorm.tags || cur.tags || [],
    alts:
      patch?.alts && typeof patch.alts === 'object'
        ? normalizeAlts(patch.alts)
        : curNorm.alts || cur.alts || normalizeAlts({}),
    modified: nowIso(),
  };

  // Preserve created/id
  next.id = cur.id;
  next.created = cur.created;

  lib.items[idx] = next;
  await writeLibrary(repoRoot, lib);
  return normalizeItem(next);
}

export async function deleteImageLibraryItem(repoRoot, id) {
  const lib = await readLibrary(repoRoot);
  lib.items = Array.isArray(lib.items) ? lib.items : [];
  const before = lib.items.length;
  lib.items = lib.items.filter((x) => x?.id !== id);
  if (lib.items.length === before) return false;
  await writeLibrary(repoRoot, lib);
  return true;
}

// ============================================================
// Bulk get/save helpers for file-adapter compatibility
// ============================================================

export async function getImageLibrary(repoRoot) {
  return readLibrary(repoRoot);
}

export async function saveImageLibrary(repoRoot, lib) {
  return writeLibrary(repoRoot, lib);
}

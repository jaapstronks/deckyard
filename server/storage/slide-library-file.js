import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { cleanStr } from '../../shared/string-utils.js';
import { normalizeLang } from '../../shared/i18n-utils.js';

function nowIso() {
  return new Date().toISOString();
}

function cleanThemeId(v) {
  const s = cleanStr(v, { max: 80 });
  return s || '';
}

function userKeyFromEmail(email) {
  const e = cleanStr(email, { max: 200 }).toLowerCase();
  if (!e) return 'anon';
  return crypto.createHash('sha256').update(e).digest('hex').slice(0, 24);
}

function storageBaseDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'slide-library');
}

function personalPath(repoRoot, userEmail) {
  const userKey = userKeyFromEmail(userEmail);
  return path.join(storageBaseDir(repoRoot), 'personal', `${userKey}.json`);
}

function teamPath(repoRoot) {
  // "Workspace" == this server instance for now. If/when we add real workspaces,
  // move to slide-library/team/<workspaceId>.json and keep migration here.
  return path.join(storageBaseDir(repoRoot), 'team.json');
}

async function readStore(p) {
  const parsed = await readJsonIfExists(p);
  const store =
    parsed && typeof parsed === 'object' && Array.isArray(parsed.items)
      ? parsed
      : { v: 1, items: [] };
  return {
    v: Number(store.v) || 1,
    items: Array.isArray(store.items) ? store.items : [],
  };
}

async function writeStore(p, store) {
  await writeJsonAtomic(p, store);
}

function normalizeSlideContent(content) {
  // Keep it JSON-serializable and avoid prototype surprises.
  if (!content || typeof content !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(content));
  } catch {
    return {};
  }
}

const SUPPORTED_LANGS = ['nl', 'en-GB'];

function normalizeI18n(input) {
  if (!input || typeof input !== 'object') return null;
  const dominant = normalizeLang(input.dominant) || 'nl';
  const versions = {};
  if (input.versions && typeof input.versions === 'object') {
    for (const lang of SUPPORTED_LANGS) {
      const v = input.versions[lang];
      if (v && typeof v === 'object') {
        versions[lang] = {
          content: normalizeSlideContent(v.content),
        };
      }
    }
  }
  // Only return i18n if there are versions
  if (Object.keys(versions).length === 0) return null;
  return { dominant, versions };
}

function normalizeItemBase(input) {
  const name = cleanStr(input?.name, { max: 120 });
  const slideType = cleanStr(input?.slideType || input?.type, { max: 80 });
  const themeId = cleanThemeId(input?.themeId);
  const content = normalizeSlideContent(input?.content);
  const i18n = normalizeI18n(input?.i18n);
  return { name, slideType, themeId, content, i18n };
}

function stripInternalTeamFields(item, { userKey } = {}) {
  const fav = Array.isArray(item?.favorites) ? item.favorites : [];
  const isFavorite = userKey ? fav.includes(userKey) : false;
  const result = {
    id: String(item?.id || ''),
    name: String(item?.name || ''),
    slideType: String(item?.slideType || ''),
    themeId: String(item?.themeId || ''),
    content: item?.content && typeof item.content === 'object' ? item.content : {},
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || ''),
    createdBy: String(item?.createdBy || ''),
    updatedBy: String(item?.updatedBy || ''),
    trashedAt: String(item?.trashedAt || ''),
    trashedBy: String(item?.trashedBy || ''),
    isTrashed: !!item?.trashedAt,
    isFavorite,
    favoriteCount: fav.length,
  };
  // Include i18n if present
  if (item?.i18n && typeof item.i18n === 'object') {
    result.i18n = item.i18n;
  }
  return result;
}

function stripInternalPersonalFields(item) {
  const result = {
    id: String(item?.id || ''),
    name: String(item?.name || ''),
    slideType: String(item?.slideType || ''),
    themeId: String(item?.themeId || ''),
    content: item?.content && typeof item.content === 'object' ? item.content : {},
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || ''),
    createdBy: String(item?.createdBy || ''),
    updatedBy: String(item?.updatedBy || ''),
    trashedAt: String(item?.trashedAt || ''),
    trashedBy: String(item?.trashedBy || ''),
    isTrashed: !!item?.trashedAt,
    favorite: !!item?.favorite,
  };
  // Include i18n if present
  if (item?.i18n && typeof item.i18n === 'object') {
    result.i18n = item.i18n;
  }
  return result;
}

export async function listPersonalLibrary(repoRoot, userEmail, { themeId = '' } = {}) {
  const p = personalPath(repoRoot, userEmail);
  const store = await readStore(p);
  const t = cleanThemeId(themeId);
  const items = store.items
    .filter((x) => x && typeof x === 'object')
    .filter((x) => !t || String(x.themeId || '') === t)
    .map(stripInternalPersonalFields);
  return { items };
}

export async function createPersonalLibraryItem(
  repoRoot,
  userEmail,
  input,
  { actorEmail } = {}
) {
  const p = personalPath(repoRoot, userEmail);
  const store = await readStore(p);
  const { name, slideType, themeId, content, i18n } = normalizeItemBase(input);
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slideType_required' };

  const ts = nowIso();
  const item = {
    id: crypto.randomUUID(),
    name,
    slideType,
    themeId,
    content,
    favorite: !!input?.favorite,
    trashedAt: '',
    trashedBy: '',
    createdAt: ts,
    updatedAt: ts,
    createdBy: cleanStr(actorEmail, { max: 200 }),
    updatedBy: cleanStr(actorEmail, { max: 200 }),
  };
  // Include i18n if present
  if (i18n) {
    item.i18n = i18n;
  }
  store.items = [item, ...store.items];
  await writeStore(p, store);
  return { ok: true, item: stripInternalPersonalFields(item) };
}

export async function updatePersonalLibraryItem(
  repoRoot,
  userEmail,
  id,
  patch,
  { actorEmail } = {}
) {
  const p = personalPath(repoRoot, userEmail);
  const store = await readStore(p);
  const idx = store.items.findIndex((x) => String(x?.id || '') === String(id || ''));
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const prev = store.items[idx];
  const next = { ...prev };

  if (patch && typeof patch === 'object') {
    if ('name' in patch) next.name = cleanStr(patch.name, { max: 120 }) || next.name;
    if ('favorite' in patch) next.favorite = !!patch.favorite;
    if ('content' in patch) next.content = normalizeSlideContent(patch.content);
    if ('slideType' in patch) next.slideType = cleanStr(patch.slideType, { max: 80 }) || next.slideType;
    if ('themeId' in patch) next.themeId = cleanThemeId(patch.themeId);
    if ('trashed' in patch) {
      const trashed = !!patch.trashed;
      next.trashedAt = trashed ? nowIso() : '';
      next.trashedBy = trashed ? cleanStr(actorEmail, { max: 200 }) : '';
    }
  }
  next.updatedAt = nowIso();
  next.updatedBy = cleanStr(actorEmail, { max: 200 });
  store.items[idx] = next;
  await writeStore(p, store);
  return { ok: true, item: stripInternalPersonalFields(next) };
}

export async function deletePersonalLibraryItem(repoRoot, userEmail, id) {
  // Hard delete (kept for admins/ops). UI should use soft-delete via { trashed: true }.
  const p = personalPath(repoRoot, userEmail);
  const store = await readStore(p);
  const before = store.items.length;
  store.items = store.items.filter((x) => String(x?.id || '') !== String(id || ''));
  if (store.items.length === before) return { ok: false, reason: 'not_found' };
  await writeStore(p, store);
  return { ok: true };
}

export async function listTeamLibrary(repoRoot, { themeId = '', userEmail = '' } = {}) {
  const p = teamPath(repoRoot);
  const store = await readStore(p);
  const t = cleanThemeId(themeId);
  const userKey = userKeyFromEmail(userEmail);
  const items = store.items
    .filter((x) => x && typeof x === 'object')
    .filter((x) => !t || String(x.themeId || '') === t)
    .map((it) => stripInternalTeamFields(it, { userKey }));
  return { items };
}

export async function createTeamLibraryItem(repoRoot, input, { actorEmail } = {}) {
  const p = teamPath(repoRoot);
  const store = await readStore(p);
  const { name, slideType, themeId, content, i18n } = normalizeItemBase(input);
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slideType_required' };

  const ts = nowIso();
  const item = {
    id: crypto.randomUUID(),
    name,
    slideType,
    themeId,
    content,
    favorites: [],
    trashedAt: '',
    trashedBy: '',
    createdAt: ts,
    updatedAt: ts,
    createdBy: cleanStr(actorEmail, { max: 200 }),
    updatedBy: cleanStr(actorEmail, { max: 200 }),
  };
  // Include i18n if present
  if (i18n) {
    item.i18n = i18n;
  }
  store.items = [item, ...store.items];
  await writeStore(p, store);
  return { ok: true, item: stripInternalTeamFields(item, { userKey: userKeyFromEmail(actorEmail) }) };
}

export async function updateTeamLibraryItem(
  repoRoot,
  id,
  patch,
  { actorEmail } = {}
) {
  const p = teamPath(repoRoot);
  const store = await readStore(p);
  const idx = store.items.findIndex((x) => String(x?.id || '') === String(id || ''));
  if (idx < 0) return { ok: false, reason: 'not_found' };

  const userKey = userKeyFromEmail(actorEmail);
  const prev = store.items[idx];
  const next = { ...prev };
  if (patch && typeof patch === 'object') {
    if ('name' in patch) next.name = cleanStr(patch.name, { max: 120 }) || next.name;
    if ('content' in patch) next.content = normalizeSlideContent(patch.content);
    if ('slideType' in patch) next.slideType = cleanStr(patch.slideType, { max: 80 }) || next.slideType;
    if ('themeId' in patch) next.themeId = cleanThemeId(patch.themeId);
    if ('favorite' in patch) {
      const fav = new Set(Array.isArray(next.favorites) ? next.favorites : []);
      if (patch.favorite) fav.add(userKey);
      else fav.delete(userKey);
      next.favorites = Array.from(fav);
    }
    if ('trashed' in patch) {
      const trashed = !!patch.trashed;
      next.trashedAt = trashed ? nowIso() : '';
      next.trashedBy = trashed ? cleanStr(actorEmail, { max: 200 }) : '';
    }
  }
  next.updatedAt = nowIso();
  next.updatedBy = cleanStr(actorEmail, { max: 200 });
  store.items[idx] = next;
  await writeStore(p, store);
  return { ok: true, item: stripInternalTeamFields(next, { userKey }) };
}

export async function setTeamLibraryItemTrashed(
  repoRoot,
  id,
  { trashed, actorEmail, allowTrash } = {}
) {
  const p = teamPath(repoRoot);
  const store = await readStore(p);
  const idx = store.items.findIndex((x) => String(x?.id || '') === String(id || ''));
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const item = store.items[idx];
  if (typeof allowTrash === 'function') {
    const ok = await allowTrash(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const next = { ...item };
  const t = !!trashed;
  next.trashedAt = t ? nowIso() : '';
  next.trashedBy = t ? cleanStr(actorEmail, { max: 200 }) : '';
  next.updatedAt = nowIso();
  next.updatedBy = cleanStr(actorEmail, { max: 200 });
  store.items[idx] = next;
  await writeStore(p, store);
  return { ok: true, item: stripInternalTeamFields(next, { userKey: userKeyFromEmail(actorEmail) }) };
}

export async function deleteTeamLibraryItem(repoRoot, id, { actorEmail, allowDelete } = {}) {
  // allowDelete: a function that can enforce policy (admin/creator) at route layer.
  const p = teamPath(repoRoot);
  const store = await readStore(p);
  const idx = store.items.findIndex((x) => String(x?.id || '') === String(id || ''));
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const item = store.items[idx];
  if (typeof allowDelete === 'function') {
    const ok = await allowDelete(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  store.items.splice(idx, 1);
  await writeStore(p, store);
  return { ok: true };
}

export function _unsafeUserKeyFromEmailForTests(email) {
  return userKeyFromEmail(email);
}

// ============================================================
// Bulk get/save helpers for file-adapter compatibility
// Note: These work with team library only for simplicity.
// Personal libraries are handled via the specific functions above.
// ============================================================

export async function getSlideLibrary(repoRoot) {
  const p = teamPath(repoRoot);
  return readStore(p);
}

export async function saveSlideLibrary(repoRoot, lib) {
  const p = teamPath(repoRoot);
  return writeStore(p, lib);
}

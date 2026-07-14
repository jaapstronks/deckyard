import fs from 'node:fs/promises';
import path from 'node:path';
import { presDir } from './paths.js';
import { readJsonIfExists } from './io.js';
import {
  computeMissingCount,
  normalizeLang,
  otherLang,
  pickVersion,
} from './i18n.js';
import { normalizePresentationScope } from '../../utils/presentation-authz.js';
import { resolveThemeId } from '../../utils/themes.js';
import {
  cleanupExpiredSandboxPresentation,
  isSandboxExpiredPresentation,
} from './sandbox.js';
import { normalizeEmail } from '../../utils/normalize.js';

function normalizeMeta(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  pres.scope = normalizePresentationScope(pres.scope);
  const rev = Number(pres.revision);
  pres.revision = Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
  const owner = normalizeEmail(pres.ownerEmail);
  pres.ownerEmail = owner || null;
  pres.createdBy = normalizeEmail(pres.createdBy) || owner || null;
  pres.updatedBy = normalizeEmail(pres.updatedBy) || pres.createdBy || owner || null;
  return pres;
}

export async function listPresentations(repoRoot) {
  const dir = presDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    const pres = await readJsonIfExists(full);
    if (!pres) continue;
    if (isSandboxExpiredPresentation(pres)) {
      await cleanupExpiredSandboxPresentation(repoRoot, pres);
      continue;
    }
    // Skip trashed presentations
    if (pres.trashedAt) continue;
    normalizeMeta(pres);
    const dominant =
      pres?.i18n?.dominant === 'en-GB'
        ? 'en-GB'
        : pres?.i18n?.dominant === 'nl'
        ? 'nl'
        : null;
    const dTitle =
      dominant &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      pres.i18n.versions?.[dominant] &&
      typeof pres.i18n.versions[dominant] === 'object' &&
      typeof pres.i18n.versions[dominant].title === 'string'
        ? pres.i18n.versions[dominant].title
        : pres.title;
    const dSlides =
      dominant &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      Array.isArray(pres.i18n.versions?.[dominant]?.slides)
        ? pres.i18n.versions[dominant].slides
        : pres.slides;
    const first = dSlides?.[0];
    const themeId = resolveThemeId(pres?.theme);
    out.push({
      id: pres.id,
      title: dTitle,
      modified: pres.modified,
      created: pres.created,
      theme: pres.theme,
      ownerEmail: pres.ownerEmail || null,
      createdBy: pres.createdBy || null,
      updatedBy: pres.updatedBy || null,
      scope: pres.scope || 'private',
      revision: Number(pres.revision) || 1,
      i18n:
        pres?.i18n && typeof pres.i18n === 'object'
          ? {
              dominant: dominant,
              hasNl: !!pres.i18n?.versions?.nl,
              hasEnGb: !!pres.i18n?.versions?.['en-GB'],
              otherLang:
                dominant === 'nl'
                  ? 'en-GB'
                  : dominant === 'en-GB'
                  ? 'nl'
                  : null,
              otherMissingCount: (() => {
                if (dominant !== 'nl' && dominant !== 'en-GB') return null;
                const other = otherLang(dominant);
                const hasOther = !!pres.i18n?.versions?.[other];
                if (!hasOther) return null;
                const src = pickVersion(pres, dominant);
                const tgt = pickVersion(pres, other);
                return computeMissingCount({ source: src, target: tgt });
              })(),
            }
          : null,
      // Used by the overview page to render a thumbnail preview without extra requests.
      firstSlide:
        first && typeof first === 'object'
          ? {
              id: first.id,
              type: first.type,
              content: first.content || {},
            }
          : null,
    });
  }
  out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return out;
}

export async function listTrashedPresentations(repoRoot) {
  const dir = presDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    const pres = await readJsonIfExists(full);
    if (!pres) continue;
    // Only include trashed presentations
    if (!pres.trashedAt) continue;
    normalizeMeta(pres);
    const dominant =
      pres?.i18n?.dominant === 'en-GB'
        ? 'en-GB'
        : pres?.i18n?.dominant === 'nl'
        ? 'nl'
        : null;
    const dTitle =
      dominant &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      pres.i18n.versions?.[dominant] &&
      typeof pres.i18n.versions[dominant] === 'object' &&
      typeof pres.i18n.versions[dominant].title === 'string'
        ? pres.i18n.versions[dominant].title
        : pres.title;
    const dSlides =
      dominant &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      Array.isArray(pres.i18n.versions?.[dominant]?.slides)
        ? pres.i18n.versions[dominant].slides
        : pres.slides;
    const first = dSlides?.[0];
    const themeId = resolveThemeId(pres?.theme);
    out.push({
      id: pres.id,
      title: dTitle,
      modified: pres.modified,
      created: pres.created,
      trashedAt: pres.trashedAt,
      trashedBy: pres.trashedBy,
      theme: pres.theme,
      ownerEmail: pres.ownerEmail || null,
      createdBy: pres.createdBy || null,
      updatedBy: pres.updatedBy || null,
      scope: pres.scope || 'private',
      revision: Number(pres.revision) || 1,
      i18n:
        pres?.i18n && typeof pres.i18n === 'object'
          ? {
              dominant: dominant,
              hasNl: !!pres.i18n?.versions?.nl,
              hasEnGb: !!pres.i18n?.versions?.['en-GB'],
              otherLang:
                dominant === 'nl'
                  ? 'en-GB'
                  : dominant === 'en-GB'
                  ? 'nl'
                  : null,
              otherMissingCount: (() => {
                if (dominant !== 'nl' && dominant !== 'en-GB') return null;
                const other = otherLang(dominant);
                const hasOther = !!pres.i18n?.versions?.[other];
                if (!hasOther) return null;
                const src = pickVersion(pres, dominant);
                const tgt = pickVersion(pres, other);
                return computeMissingCount({ source: src, target: tgt });
              })(),
            }
          : null,
      firstSlide:
        first && typeof first === 'object'
          ? {
              id: first.id,
              type: first.type,
              content: first.content || {},
            }
          : null,
    });
  }
  // Sort by trashed date (most recently trashed first)
  out.sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)));
  return out;
}

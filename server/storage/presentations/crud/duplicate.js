/**
 * CRUD duplicate operation with ID mapping.
 */

import { validatePresentation } from '../../../../shared/slide-schemas.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';
import { normalizeSlides } from '../slides.js';
import { normalizeI18n } from '../i18n.js';
import { writePresentation } from '../io.js';
import { attachSandboxMeta } from '../sandbox.js';
import { assertSandboxQuotaForCreate } from '../sandbox-quota.js';
import { sandboxEnabled } from '../../../config/sandbox.js';
import { listThemeIds } from '../../../utils/themes.js';
import { normalizeEmail, nowIso } from '../../../utils/normalize.js';
import { ValidationError } from '../../../utils/errors.js';
import { getPresentation } from './read.js';
import { normalizeMeta } from './helpers.js';

/**
 * Get allowed themes for validation.
 */
async function allowedThemesForValidation(repoRoot, { include = [] } = {}) {
  const ids = await listThemeIds(repoRoot);
  const filtered = sandboxEnabled()
    ? ids.filter((id) => String(id).startsWith('sandbox-'))
    : ids;
  const set = new Set(['default', ...filtered]);
  for (const t of include) {
    const s = typeof t === 'string' ? t.trim() : '';
    if (s) set.add(s);
  }
  return Array.from(set);
}

/**
 * Create a prefixed title for a duplicated presentation.
 */
function prefixedTitleForLang(title, lang) {
  const base = String(title || '').trim() || 'Untitled';
  const l = lang === 'nl' ? 'nl' : lang === 'en-GB' ? 'en-GB' : null;
  if (l === 'nl') return `Kopie van ${base}`;
  return `Copy of ${base}`;
}

/**
 * Apply ID mapping to slides (for consistent IDs across i18n versions).
 */
function applyIdMapToSlides(slides, { slideIdMap, pollIdMap } = {}) {
  const out = Array.isArray(slides) ? slides : [];
  for (const s of out) {
    if (!s || typeof s !== 'object') continue;
    const sid = typeof s.id === 'string' ? s.id : '';
    if (sid && slideIdMap?.has?.(sid)) s.id = slideIdMap.get(sid);
    if (s.type === 'poll-slide') {
      const pid =
        s?.content && typeof s.content === 'object' && typeof s.content.pollId === 'string'
          ? s.content.pollId
          : '';
      if (pid && pollIdMap?.has?.(pid)) {
        s.content = s.content && typeof s.content === 'object' ? s.content : {};
        s.content.pollId = pollIdMap.get(pid);
      }
    }
  }
  return out;
}

/**
 * Duplicate a presentation.
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Source presentation ID
 * @param {Object} opts - Options (actorEmail)
 * @returns {Promise<Object|null>} Duplicated presentation or null
 */
export async function duplicatePresentation(repoRoot, id, opts = {}) {
  const existing = await getPresentation(repoRoot, id);
  if (!existing) return null;

  const actorEmail = normalizeEmail(opts?.actorEmail);

  // Sandbox: a duplicate mints a new deck, so it counts against the guest's
  // quota — refuse (typed 4xx) once they are at the cap. No-op outside sandbox.
  await assertSandboxQuotaForCreate(repoRoot, actorEmail);

  const dominant =
    existing?.i18n?.dominant === 'nl' || existing?.i18n?.dominant === 'en-GB'
      ? existing.i18n.dominant
      : existing?.lang === 'en-GB'
        ? 'en-GB'
        : 'nl';

  const now = nowIso();
  const copy = structuredClone(existing);

  // New identity + ownership.
  copy.id = cryptoUuid();
  copy.created = now;
  copy.modified = now;
  copy.revision = 1;
  copy.ownerEmail = actorEmail || null;
  copy.createdBy = actorEmail || null;
  copy.updatedBy = actorEmail || null;
  copy.scope = 'private';

  // Sandbox mode: duplicates should also be ephemeral.
  attachSandboxMeta(copy);

  // A duplicated deck should not be published by default.
  try {
    delete copy.published;
  } catch {
    // ignore
  }

  // Map slide ids consistently across i18n versions so language switching keeps selection stable.
  const slideIdMap = new Map();
  const pollIdMap = new Map();

  const seedSlideArrays = [];
  if (Array.isArray(existing?.slides)) seedSlideArrays.push(existing.slides);
  const vers = existing?.i18n?.versions;
  if (vers && typeof vers === 'object') {
    for (const v of Object.values(vers)) {
      if (v && typeof v === 'object' && Array.isArray(v.slides))
        seedSlideArrays.push(v.slides);
    }
  }

  for (const arr of seedSlideArrays) {
    for (const s of arr || []) {
      const sid = typeof s?.id === 'string' ? s.id : '';
      if (sid && !slideIdMap.has(sid)) slideIdMap.set(sid, cryptoUuid());
      if (s?.type === 'poll-slide') {
        const pid =
          s?.content && typeof s.content === 'object' && typeof s.content.pollId === 'string'
            ? s.content.pollId
            : '';
        if (pid && !pollIdMap.has(pid)) pollIdMap.set(pid, cryptoUuid());
      }
    }
  }

  // Update main slides
  copy.slides = applyIdMapToSlides(copy.slides, { slideIdMap, pollIdMap });

  // Update i18n versions (if any)
  if (copy?.i18n && typeof copy.i18n === 'object') {
    copy.i18n.versions =
      copy.i18n.versions && typeof copy.i18n.versions === 'object'
        ? copy.i18n.versions
        : {};
    for (const [lang, vRaw] of Object.entries(copy.i18n.versions || {})) {
      const v = vRaw && typeof vRaw === 'object' ? vRaw : {};
      if (typeof v.title === 'string') v.title = prefixedTitleForLang(v.title, lang);
      if (Array.isArray(v.slides))
        v.slides = applyIdMapToSlides(v.slides, { slideIdMap, pollIdMap });
      copy.i18n.versions[lang] = v;
    }
    // Keep main title in sync with dominant version when possible.
    const dTitle = copy.i18n.versions?.[dominant]?.title;
    if (typeof dTitle === 'string' && dTitle.trim()) copy.title = dTitle.trim();
    else copy.title = prefixedTitleForLang(copy.title, dominant);
    copy.lang = dominant;
    copy.i18n.active = dominant;
    copy.i18n.dominant = dominant;
  } else {
    copy.title = prefixedTitleForLang(copy.title, dominant);
    copy.lang = dominant;
  }

  copy.slides = normalizeSlides(copy.slides);
  normalizeI18n(copy);

  const v = validatePresentation(copy, {
    allowedThemes: await allowedThemesForValidation(repoRoot, {
      include: [copy?.theme],
    }),
  });
  if (!v.ok) {
    throw new ValidationError(`Validation failed: ${v.errors.join('; ')}`);
  }

  await writePresentation(repoRoot, copy);
  return normalizeMeta(copy);
}

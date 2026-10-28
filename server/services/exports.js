/**
 * Exports — the one place a deck is made ready to export, on every contract
 * (A7.4, B520).
 *
 * The context an export builds from used to be prepared three times: by the
 * internal export routes (`server/export/pipeline.js`), by the public v1
 * export routes (`server/routes/public-api/v1/exports.js`) and by the queued
 * export worker (`server/jobs/queue/workers/export-worker.js`). The first two
 * were the same function line for line, apart from the answer they gave a
 * refusal; the worker had drifted on its own: another language projection
 * (no `i18n.active`, an empty version list kept), its own spelling of the
 * fields, and its own idea of where the custom slide types come from. Now each
 * caller asks here and keeps only its answer: streaming, headers, rate-limit
 * headers, the envelope (brief `one-service-layer.md`, D252–D256).
 *
 * Three entries, one per kind of caller:
 *
 *   - {@link prepareExportContext} — someone asks for an export. The deck is
 *     loaded with the read right ({@link loadPresentationForActor}, so a
 *     refusal throws `NotFoundError`/`ForbiddenError`, D255), and the export
 *     is counted once on the instance-health `export` axis (D247). This is the
 *     only place that count happens: a refused export was not one, one whose
 *     build then failed or that went to the queue was still asked for.
 *   - {@link prepareQueuedExportContext} — the worker rechecks the requester
 *     against current deck rights, bounded by the audience at enqueue. It
 *     does not count the export again.
 *   - {@link buildExportContext} — describe an already-authorized deck, as MCP
 *     does before returning a download link. No export has been requested yet,
 *     so this neither repeats the access check nor counts an export.
 *
 * Beside them, {@link prepareThemeTemplate} — the one export that is not a
 * deck's. The theme template is an artifact of a theme (B274, D126), so it
 * asks for a theme id and no presentation, but it is still an export: it is
 * counted on the same axis, under the same `pptx-template` key, from the
 * internal route and the v1 route alike.
 *
 * @module server/services/exports
 */

import {
  loadPresentationForActor,
  mayOnPresentation,
} from './presentations.js';
import { countInstanceHealth } from '../storage/instance-health.js';
import { repoRootOf } from '../storage/scope.js';
import { normalizeLang, projectPresentationForLang } from '../utils/i18n.js';
import {
  filterForExport,
  projectPresentationForAudience,
} from '../utils/public-output.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildThemeTemplateBuffer } from '../export/pptx-theme.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { ForbiddenError } from '../utils/errors.js';
import { normalizeEmail } from '../../shared/email.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * What every export builds from.
 *
 * @typedef {Object} ExportContext
 * @property {Object} pres - The deck, projected onto `exportLang`, every
 *   slide kept: what the data formats (JSON, the portable `.deck`) carry.
 * @property {Object} filteredPres - What every rendered format builds from:
 *   `pres` through {@link filterForExport} (no live-only, `hideInExport` or
 *   incomplete slide, in any language version; jumps pinned first, so `#N`
 *   still names the stored slide), for the author and a reader alike (B590).
 *   `pres` itself when the export strips nothing (`stripLiveOnly: false`, the
 *   data formats).
 * @property {Object|null} theme - The deck's resolved theme assets.
 * @property {Record<string, Object>} slideTypes - Core plus the deck
 *   organization's published custom slide types.
 * @property {string|null} exportLang - The language projected onto, or `null`
 *   for a format that carries every language version.
 * @property {string} langSuffix - The filename suffix for `exportLang`.
 * @property {string} title - The projected title, for the filename.
 */

/**
 * The filename suffix for an export language.
 *
 * @param {string|null} exportLang
 * @returns {string} `-NL`, `-EN` or `''`.
 */
function langSuffixFor(exportLang) {
  return exportLang === 'nl' ? '-NL' : exportLang === 'en-GB' ? '-EN' : '';
}

/**
 * Build the context from a deck the caller may export.
 *
 * The custom slide types are the deck's organization's: the deck is what is
 * rendered, and `presentations.organization_id` is never null.
 *
 * @param {StorageScope} scope
 * @param {Object} pres
 * @param {{ exportLang: string|null, stripLiveOnly: boolean, audience: 'author'|'reader' }} options
 * @returns {Promise<ExportContext>}
 */
export async function buildExportContext(
  scope,
  pres,
  { exportLang, stripLiveOnly, audience },
) {
  const [theme, slideTypes] = await Promise.all([
    loadThemeAssets(repoRootOf(scope), pres.theme, scope),
    buildMergedSlideTypes({ organizationId: pres.organizationId }),
  ]);
  const safe = projectPresentationForAudience(pres, {
    audience,
    channel: 'viewer',
    slideTypes,
  });
  const projected = exportLang
    ? projectPresentationForLang(safe, exportLang)
    : safe;
  const filteredPres = stripLiveOnly
    ? filterForExport(projected, { slideTypes })
    : projected;
  return {
    pres: projected,
    filteredPres,
    theme,
    slideTypes,
    exportLang,
    langSuffix: langSuffixFor(exportLang),
    title: projected.title || 'presentation',
  };
}

/**
 * Prepare an export someone asks for.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {string} input.format - The export's format id (the `export` axis
 *   vocabulary in `server/storage/instance-health.js`).
 * @param {string|null} [input.lang] - The requested language, normalized
 *   here; unknown or absent means the deck's dominant version.
 * @param {boolean} [input.allLanguages=false] - Skip the projection, for a
 *   format that carries every language version itself (the portable deck,
 *   D89): projecting first is what used to drop the other versions.
 * @param {boolean} [input.stripLiveOnly=true] - Filter `filteredPres` for
 *   export; `false` only for the data formats, which build from `pres`.
 * @returns {Promise<ExportContext>}
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The deck is there, the read right is not.
 */
export async function prepareExportContext(
  scope,
  identity,
  { presentationId, format, lang, allLanguages = false, stripLiveOnly = true },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId);
  const audience = await exportAudience(pres, identity, format);
  const actor = identity.actor;
  const exportAccess = {
    version: 1,
    presentationId,
    format,
    audience,
    actor: {
      id: actor.id || null,
      email: actor.email,
      organizationId: actor.organizationId || null,
      ...(actor.unrestricted === true ? { unrestricted: true } : {}),
    },
  };
  countInstanceHealth([{ axis: 'export', key: format }]);
  return {
    ...(await buildExportContext(scope, pres, {
      exportLang: allLanguages ? null : normalizeLang(lang),
      stripLiveOnly,
      audience,
    })),
    exportAccess,
  };
}

/** The current deck right, independent of an API key's action permissions. */
async function exportAudience(pres, identity, format, maximum = 'author') {
  const audience =
    maximum === 'author' && (await mayOnPresentation(pres, identity, 'write'))
      ? 'author'
      : 'reader';
  if (audience === 'reader' && ['notes-md', 'notes-docx'].includes(format)) {
    throw new ForbiddenError('Speaker notes require presentation write access');
  }
  return audience;
}

/** Missing pre-contract jobs/results are unsafe and must be exported again. */
function requireExportAccess(access) {
  if (
    access?.version !== 1 ||
    !access.presentationId ||
    !access.format ||
    !['author', 'reader'].includes(access.audience) ||
    !normalizeEmail(access.actor?.email)
  ) {
    throw new ForbiddenError('Export access context missing; export again');
  }
}

/**
 * Recheck a queued request without promoting its enqueue audience or counting
 * it twice. No fallback to a system/author export for older jobs.
 * @param {StorageScope} scope
 * @param {Object} input
 * @returns {Promise<ExportContext>}
 */
export async function prepareQueuedExportContext(
  scope,
  { presentationId, format, lang, stripLiveOnly = true, exportAccess },
) {
  requireExportAccess(exportAccess);
  if (
    exportAccess.presentationId !== presentationId ||
    exportAccess.format !== format
  ) {
    throw new ForbiddenError('Export access context does not match the job');
  }
  const identity = { actor: exportAccess.actor };
  const pres = await loadPresentationForActor(scope, identity, presentationId);
  const audience = await exportAudience(
    pres,
    identity,
    format,
    exportAccess.audience,
  );
  return {
    ...(await buildExportContext(scope, pres, {
      exportLang: normalizeLang(lang),
      stripLiveOnly,
      audience,
    })),
    exportAccess: { ...exportAccess, audience },
  };
}

/**
 * Check the finished artifact against the current downloader's rights. An
 * author artifact cannot be downgraded after building: refuse and re-export.
 * @param {StorageScope} scope
 * @param {{actor: Actor}} identity
 * @param {Object} exportAccess - Server-stamped context of the built artifact
 * @returns {Promise<void>}
 */
export async function authorizeExportResult(scope, identity, exportAccess) {
  requireExportAccess(exportAccess);
  if (
    normalizeEmail(identity.actor?.email) !==
      normalizeEmail(exportAccess.actor.email) ||
    (identity.actor?.organizationId || null) !==
      exportAccess.actor.organizationId
  ) {
    throw new ForbiddenError('Export belongs to another actor');
  }
  const pres = await loadPresentationForActor(
    scope,
    identity,
    exportAccess.presentationId,
  );
  const audience = await exportAudience(
    pres,
    identity,
    exportAccess.format,
    exportAccess.audience,
  );
  if (audience !== exportAccess.audience) {
    throw new ForbiddenError('Presentation rights changed; export again');
  }
}

/**
 * Prepare the PPTX template of a theme.
 *
 * The artifact belongs to the theme, not to a deck: the same theme hands back
 * the same bytes whichever presentation happens to use it. Until B274 it hung
 * off a deck anyway, because the deck was what named the theme; now the theme
 * is asked for directly and the deck route is gone.
 *
 * Authorization is {@link loadThemeAssets}' own: a session scope sees its
 * organization's themes and the seeds, and an id outside that throws the 404
 * it throws for an unknown theme — the same answer, which is what a caller
 * probing for other organizations' theme ids should get.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {string} themeId - The theme's UUID.
 * @returns {Promise<{ buffer: Buffer, label: string }>} The template and the
 *   theme's label, for the filename.
 * @throws {import('../utils/errors.js').AppError} No such theme in this scope.
 */
export async function prepareThemeTemplate(scope, themeId) {
  const repoRoot = repoRootOf(scope);
  const theme = await loadThemeAssets(repoRoot, themeId, scope);
  countInstanceHealth([{ axis: 'export', key: 'pptx-template' }]);
  return {
    buffer: await buildThemeTemplateBuffer(repoRoot, theme),
    // The same fallback the template titles itself with, so the filename and
    // the document's title cannot disagree.
    label: String(theme?.label || theme?.id || 'Theme'),
  };
}

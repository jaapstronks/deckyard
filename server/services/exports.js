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
 * Two entries, one per kind of caller:
 *
 *   - {@link prepareExportContext} — someone asks for an export. The deck is
 *     loaded with the read right ({@link loadPresentationForActor}, so a
 *     refusal throws `NotFoundError`/`ForbiddenError`, D255), and the export
 *     is counted once on the instance-health `export` axis (D247). This is the
 *     only place that count happens: a refused export was not one, one whose
 *     build then failed or that went to the queue was still asked for.
 *   - {@link prepareQueuedExportContext} — the export worker builds what an
 *     earlier request was admitted for. It acts as the system (D252): the
 *     right was decided and the export counted when the job was queued.
 *
 * @module server/services/exports
 */

import { loadPresentationForActor } from './presentations.js';
import { getPresentation } from '../storage/presentations/index.js';
import { countInstanceHealth } from '../storage/instance-health.js';
import { repoRootOf } from '../storage/scope.js';
import { normalizeLang, projectPresentationForLang } from '../utils/i18n.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * What every export builds from.
 *
 * @typedef {Object} ExportContext
 * @property {Object} pres - The deck, projected onto `exportLang` (live-only
 *   slides kept).
 * @property {Object} filteredPres - `pres` without its live-only slides when
 *   the export strips them, otherwise `pres` itself.
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
 * @param {{ exportLang: string|null, stripLiveOnly: boolean }} options
 * @returns {Promise<ExportContext>}
 */
async function buildExportContext(scope, pres, { exportLang, stripLiveOnly }) {
  const projected = exportLang
    ? projectPresentationForLang(pres, exportLang)
    : pres;
  const filteredPres = stripLiveOnly
    ? stripLiveOnlySlidesFromPresentation(projected)
    : projected;
  const [theme, slideTypes] = await Promise.all([
    loadThemeAssets(repoRootOf(scope), projected.theme, scope),
    buildMergedSlideTypes({ organizationId: pres.organizationId }),
  ]);
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
 * @param {boolean} [input.stripLiveOnly=true] - Drop the live-only slides
 *   from `filteredPres`.
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
  countInstanceHealth([{ axis: 'export', key: format }]);
  return buildExportContext(scope, pres, {
    exportLang: allLanguages ? null : normalizeLang(lang),
    stripLiveOnly,
  });
}

/**
 * Prepare a queued export: the worker acting as the system on what a request
 * was admitted for. The job payload carries the language the request already
 * normalized, or `null`.
 *
 * @param {StorageScope} scope - The job's scope (`jobScope`).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {string|null} [input.lang]
 * @param {boolean} [input.stripLiveOnly=true]
 * @returns {Promise<ExportContext>}
 * @throws {NotFoundError} The deck is gone since the job was queued.
 */
export async function prepareQueuedExportContext(
  scope,
  { presentationId, lang, stripLiveOnly = true },
) {
  const pres = await getPresentation(scope, presentationId);
  if (!pres) throw new NotFoundError('Presentation not found');
  return buildExportContext(scope, pres, {
    exportLang: normalizeLang(lang),
    stripLiveOnly,
  });
}

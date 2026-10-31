/**
 * The one-off conversion of the publications from before editions (T1.5,
 * D360, D361; `docs/plans/briefs/publication-records.md` § 5).
 *
 * Until T1.5 a deck was published at `/p/{publishId}-{slug}`, an eight-hex id
 * in `published_presentations` that showed the deck as it was at the moment
 * of the visit. That index is what was demonstrably public, so it is the
 * truth here: every row whose deck can be sealed becomes one first edition,
 * made by the same service as any publish ({@link createEdition}), and the
 * old id is linked to it (`publication_legacy_links`, migration 105). The old
 * address then resolves to that edition and never to a later one.
 *
 * - **One edition per deck.** Several old ids of one deck all point at the
 *   same first edition; the deck is sealed once.
 * - **No invented history.** The edition's publication time is the moment of
 *   the conversion, its content the deck as it is now: what the old link
 *   showed today.
 * - **Nothing skipped silently.** A row whose deck is gone, in the trash or in
 *   another organization, or that a publish gate or the sealing refuses, is
 *   reported as blocked with its reason and stays unconverted; its old link
 *   answers 404. Converting it is the operator's call, after fixing the deck.
 * - **Idempotent.** The edition is made under the key `migration:<deckId>`
 *   and the links keep their first target, so a second run reports
 *   `already_linked` and changes nothing; a run interrupted between the
 *   edition and its links finishes them.
 *
 * The dry run asks every question the conversion asks (the publish gates,
 * the render bundle, the sealing) and writes nothing.
 */

import { getPresentation } from '../storage/presentations/index.js';
import {
  findEditionByIdempotencyKey,
  linkLegacyPublication,
  listLegacyPublications,
} from '../storage/editions.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { RendererBundleError } from '../render/renderer-bundle/index.js';
import { AppError } from '../utils/errors.js';
import { createEdition, prepareEdition } from './publish-edition.js';

/**
 * @typedef {Object} MigrationRow
 * @property {string} legacyId - The old publish id
 * @property {string|null} presentationId
 * @property {string|null} organizationId - The deck's organization
 * @property {'converted'|'would_convert'|'already_linked'|'blocked'} outcome
 * @property {string} [reason] - Why a row is blocked: `source_missing`,
 *   `source_trashed`, `organization_mismatch`, or the refusal's own code
 *   (`missing_alt`, `incomplete_slides`, `renderer_edition_input_unsealable`, …)
 * @property {object|null} [details] - The refusal's details, when it has them
 * @property {{publicationId: string, version: number}} [edition]
 */

/**
 * The idempotency key a converted deck's first edition is made under. An
 * actor's keys are prefixed `actor:`, so the two never meet.
 * @param {string} presentationId
 */
export function migrationKey(presentationId) {
  return `migration:${presentationId}`;
}

/**
 * A refusal as a report line: its code and, where it has them, details. Only
 * a refusal of the deck (a gate, the sealing, the bundle) blocks a row; any
 * other error is a fault of the run and stops it.
 */
function refusal(err) {
  const refused =
    err instanceof RendererBundleError ||
    (err instanceof AppError && err.statusCode < 500);
  if (!refused) throw err;
  return { reason: err.code, details: err.details ?? null };
}

/**
 * Convert (or, without `apply`, plan the conversion of) every old publication.
 *
 * @param {string} repoRoot
 * @param {object} [options]
 * @param {boolean} [options.apply] - Write; without it nothing is written
 * @param {string} [options.rendererStore] - The installation's render bundle
 *   store; the image's own by default
 * @returns {Promise<{rows: MigrationRow[], summary: Record<string, number>}>}
 */
export async function migrateLegacyPublications(
  repoRoot,
  { apply = false, rendererStore } = {},
) {
  const legacy = await listLegacyPublications(
    crossOrganizationScope(
      repoRoot,
      'publication conversion: every old publication, in every organization',
    ),
  );

  /** @type {Map<string, Array<object>>} */
  const byDeck = new Map();
  /** @type {MigrationRow[]} */
  const rows = [];
  for (const row of legacy) {
    const base = {
      legacyId: row.legacyId,
      presentationId: row.presentationId,
      organizationId: row.deckOrganizationId,
    };
    if (row.linkedEdition) {
      rows.push({
        ...base,
        outcome: 'already_linked',
        edition: row.linkedEdition,
      });
    } else if (!row.presentationId) {
      rows.push({ ...base, outcome: 'blocked', reason: 'source_missing' });
    } else if (row.trashed) {
      rows.push({ ...base, outcome: 'blocked', reason: 'source_trashed' });
    } else if (row.deckOrganizationId !== row.indexOrganizationId) {
      // The deck moved organization after it was published; carrying the
      // publication along is a decision, not a conversion.
      rows.push({
        ...base,
        outcome: 'blocked',
        reason: 'organization_mismatch',
      });
    } else {
      const group = byDeck.get(row.presentationId) || [];
      group.push(base);
      byDeck.set(row.presentationId, group);
    }
  }

  for (const [deckId, group] of byDeck) {
    const scope = { repoRoot, organizationId: group[0].organizationId };
    let outcome;
    try {
      outcome = apply
        ? await convertDeck(scope, deckId, group, { rendererStore })
        : await planDeck(scope, deckId, { rendererStore });
    } catch (err) {
      outcome = { outcome: 'blocked', ...refusal(err) };
    }
    for (const base of group) rows.push({ ...base, ...outcome });
  }

  const summary = {};
  for (const row of rows)
    summary[row.outcome] = (summary[row.outcome] || 0) + 1;
  return { rows, summary };
}

/** The dry run of one deck: every question a publish asks, no write. */
async function planDeck(scope, deckId, { rendererStore }) {
  const prior = await findEditionByIdempotencyKey(scope, migrationKey(deckId));
  if (prior) {
    return {
      outcome: 'would_convert',
      edition: {
        publicationId: prior.edition.publicationId,
        version: prior.edition.version,
      },
    };
  }
  const pres = await getPresentation(scope, deckId);
  if (!pres) return { outcome: 'blocked', reason: 'source_missing' };
  await prepareEdition(scope, pres, { rendererStore });
  return { outcome: 'would_convert' };
}

/**
 * One deck: its first edition (or the one an interrupted run already made
 * under the same key, whatever the deck says now), then a link per old id.
 */
async function convertDeck(scope, deckId, group, { rendererStore }) {
  const prior = await findEditionByIdempotencyKey(scope, migrationKey(deckId));
  let edition = prior?.edition;
  if (!edition) {
    const pres = await getPresentation(scope, deckId);
    if (!pres) return { outcome: 'blocked', reason: 'source_missing' };
    ({ edition } = await createEdition(
      scope,
      pres,
      {
        expectedRevision: Number(pres.revision),
        idempotencyKey: migrationKey(deckId),
        actorUserId: null,
      },
      { rendererStore },
    ));
  }
  for (const { legacyId } of group) {
    await linkLegacyPublication(scope, { legacyId, editionId: edition.id });
  }
  return {
    outcome: 'converted',
    edition: { publicationId: edition.publicationId, version: edition.version },
  };
}

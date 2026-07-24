/**
 * PostgreSQL presentations storage module.
 */

import crypto from 'node:crypto';
import { getDb, getOrgId, jsonb, now, sql, applyPagination } from './helpers.js';
import { mapPresentationRow, mapVersionRowSummary, mapVersionRowFull } from '../../mappers.js';
import { ConflictError } from '../../../utils/errors.js';
import { mergeSlidesAtSlideLevel } from '../../presentations/crud/helpers.js';
import { enforceSlideWritePolicy } from '../../presentations/crud/enforce-slide-locks.js';

/**
 * Presentations mixin - adds presentation methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withPresentations(Base) {
  return class extends Base {
    /**
     * List all presentations accessible by the context.
     * @param {object} ctx - Storage context
     * @param {object} [opts] - Options
     * @param {number} [opts.limit] - Max items to return
     * @param {number} [opts.offset] - Items to skip
     */
    async listPresentations(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('presentations')
        .select([
          'id',
          'title',
          'modified_at as modified',
          'created_at as created',
          'theme',
          'owner_email as ownerEmail',
          'created_by as createdBy',
          'updated_by as updatedBy',
          'scope',
          'is_view_only as isViewOnly',
          'revision',
          'i18n',
          'slides',
        ])
        .where('organization_id', '=', orgId)
        .where('trashed_at', 'is', null)
        .orderBy('modified_at', 'desc');

      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map((row) => {
        const slides = Array.isArray(row.slides) ? row.slides : [];
        const firstSlide = slides[0] || null;
        const i18n = row.i18n && typeof row.i18n === 'object' ? row.i18n : null;
        const dominant = i18n?.dominant || null;

        return {
          id: row.id,
          title: row.title,
          modified: row.modified,
          created: row.created,
          theme: row.theme,
          ownerEmail: row.ownerEmail,
          createdBy: row.createdBy,
          updatedBy: row.updatedBy,
          scope: row.scope,
          isViewOnly: !!row.isViewOnly,
          revision: row.revision,
          i18n: i18n
            ? {
                dominant,
                hasNl: !!i18n.versions?.nl,
                hasEnGb: !!i18n.versions?.['en-GB'],
                otherLang: dominant === 'nl' ? 'en-GB' : dominant === 'en-GB' ? 'nl' : null,
              }
            : null,
          hasSlides: !!firstSlide,
        };
      });
    }

    async getPresentation(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('presentations')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) return null;
      return mapPresentationRow(row);
    }

    async createPresentation(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const timestamp = now();

      const id = data.id || crypto.randomUUID();
      const ownerEmail = data.ownerEmail || ctx?.actorEmail || null;

      const row = await db
        .insertInto('presentations')
        .values({
          id,
          organization_id: orgId,
          owner_email: ownerEmail,
          created_by: ownerEmail,
          updated_by: ownerEmail,
          title: data.title || 'Untitled',
          description: data.description || null,
          theme: data.theme || 'default',
          lang: data.lang || 'nl',
          scope: 'private',
          revision: 1,
          settings: jsonb(data.settings || {}),
          i18n: jsonb(data.i18n || {}),
          slides: jsonb(data.slides || []),
          notion_source_page_id: data.notionSourcePageId || null,
          sandbox: jsonb(data.sandbox),
          created_at: timestamp,
          modified_at: timestamp,
        })
        .returningAll()
        .executeTakeFirst();

      return mapPresentationRow(row);
    }

    async updatePresentation(id, data, ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      // Read the stored state once: the optimistic-locking check and the
      // slide-lock policy below both diff against it.
      const existing = await this.getPresentation(id, ctx);
      if (!existing) return null;

      // Check for optimistic locking
      let mergeInfo = null;
      if (opts?.expectedRevision != null) {
        if (existing.revision !== opts.expectedRevision) {
          // Attempt slide-level merge when client provides modifiedSlideIds
          const modifiedSlideIds = Array.isArray(opts?.modifiedSlideIds) ? opts.modifiedSlideIds : null;
          if (modifiedSlideIds && modifiedSlideIds.length >= 0) {
            const revisionGap = Number(existing.revision) - Number(opts.expectedRevision);
            const clientReordered = opts?.clientReordered ?? null;
            const mergeResult = mergeSlidesAtSlideLevel({
              serverSlides: existing.slides,
              clientSlides: data.slides,
              modifiedSlideIds,
              baseFingerprints: opts?.slideBaseFingerprints || null,
              revisionGap,
              clientReordered,
            });
            if (mergeResult.merged && mergeResult.conflicts.length === 0) {
              mergeInfo = {
                revisionGap,
                modifiedSlideIds,
                appendedSlideIds: mergeResult.appendedSlideIds || [],
                clientReordered,
              };
              data = { ...data, slides: mergeResult.slides };
              // Keep the active-language buffer in step with the merged
              // slides. The editor loads that buffer, so storing the
              // client's stale copy here would undo the merge on the next
              // load. (File-mode gets this for free: normalizeI18n runs
              // after the merge there.)
              const activeLang = data?.i18n?.active;
              if (activeLang && data?.i18n?.versions?.[activeLang]) {
                data = {
                  ...data,
                  i18n: {
                    ...data.i18n,
                    versions: {
                      ...data.i18n.versions,
                      [activeLang]: {
                        ...data.i18n.versions[activeLang],
                        slides: mergeResult.slides,
                      },
                    },
                  },
                };
              }
            } else if (mergeResult.conflicts.length > 0) {
              throw new ConflictError(
                'Conflict: the same slides were modified by multiple users.',
                {
                  id: existing.id,
                  revision: existing.revision,
                  modified: existing.modified,
                  updatedBy: existing.updatedBy || null,
                  conflictingSlides: mergeResult.conflicts,
                }
              );
            } else {
              throw new ConflictError('Presentation was updated by someone else', {
                id: existing.id, revision: existing.revision, modified: existing.modified,
              });
            }
          } else {
            throw new ConflictError('Presentation was updated by someone else', {
              id: existing.id, revision: existing.revision, modified: existing.modified,
            });
          }
        }
      }

      // Slide-lock policy (shared with the file-mode CRUD path): only
      // authors may toggle lockedByAuthor, and content edits/deletes on
      // locked slides are rejected with 423. Runs after the slide-level
      // merge above so stale client copies of other users' slides don't
      // read as edits.
      await enforceSlideWritePolicy({
        existing,
        nextSlides: data.slides,
        nextI18nVersions: data?.i18n?.versions || null,
        user: opts?.user || null,
        actorEmail: ctx?.actorEmail || '',
        bypassLockCheck: !!opts?.bypassLockCheck,
        ctx,
      });

      const updateData = {
        title: data.title,
        description: data.description ?? null,
        settings: jsonb(data.settings),
        i18n: jsonb(data.i18n),
        slides: jsonb(data.slides),
        published: data.published ? jsonb(data.published) : null,
        updated_by: ctx?.actorEmail || data.updatedBy,
        modified_at: now(),
        revision: sql`revision + 1`,
      };

      if (opts?.allowScopeChange && data.scope) {
        updateData.scope = data.scope;
      }

      // Theme is hard-locked on the shared write path; only an explicit,
      // permission-checked switch (the /change-theme route) opts in via
      // allowThemeChange, mirroring the allowScopeChange escape hatch above.
      if (opts?.allowThemeChange && data.theme) {
        updateData.theme = data.theme;
      }

      // Only the /scope route passes allowViewOnlyChange; regular editor saves
      // must not touch the stored flag (their body may omit it entirely).
      if (opts?.allowViewOnlyChange && typeof data.isViewOnly === 'boolean') {
        updateData.is_view_only = data.isViewOnly;
      }

      const row = await db
        .updateTable('presentations')
        .set(updateData)
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;
      const out = mapPresentationRow(row);
      // Response-only audit metadata (never stored); the facade logs it to
      // activity_events.
      if (mergeInfo) out._slideMerge = mergeInfo;
      return out;
    }

    async deletePresentation(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      // Soft delete: set trashed_at and trashed_by instead of deleting
      const result = await db
        .updateTable('presentations')
        .set({
          trashed_at: now(),
          trashed_by: ctx?.actorEmail || null,
        })
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .where('trashed_at', 'is', null) // Only trash if not already trashed
        .executeTakeFirst();

      return result.numUpdatedRows > 0;
    }

    /**
     * List all trashed presentations.
     * @param {object} ctx - Storage context
     * @param {object} [opts] - Options
     * @param {number} [opts.limit] - Max items to return
     * @param {number} [opts.offset] - Items to skip
     */
    async listTrashedPresentations(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('presentations')
        .select([
          'id',
          'title',
          'modified_at as modified',
          'created_at as created',
          'trashed_at as trashedAt',
          'trashed_by as trashedBy',
          'theme',
          'owner_email as ownerEmail',
          'created_by as createdBy',
          'updated_by as updatedBy',
          'scope',
          'revision',
          'i18n',
          'slides',
        ])
        .where('organization_id', '=', orgId)
        .where('trashed_at', 'is not', null)
        .orderBy('trashed_at', 'desc');

      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map((row) => {
        const slides = Array.isArray(row.slides) ? row.slides : [];
        const firstSlide = slides[0] || null;
        const i18n = row.i18n && typeof row.i18n === 'object' ? row.i18n : null;
        const dominant = i18n?.dominant || null;

        return {
          id: row.id,
          title: row.title,
          modified: row.modified,
          created: row.created,
          trashedAt: row.trashedAt,
          trashedBy: row.trashedBy,
          theme: row.theme,
          ownerEmail: row.ownerEmail,
          createdBy: row.createdBy,
          updatedBy: row.updatedBy,
          scope: row.scope,
          revision: row.revision,
          i18n: i18n
            ? {
                dominant,
                hasNl: !!i18n.versions?.nl,
                hasEnGb: !!i18n.versions?.['en-GB'],
                otherLang: dominant === 'nl' ? 'en-GB' : dominant === 'en-GB' ? 'nl' : null,
              }
            : null,
          hasSlides: !!firstSlide,
        };
      });
    }

    /**
     * Restore a presentation from trash.
     * @param {string} id - Presentation ID
     * @param {object} ctx - Storage context
     */
    async restorePresentation(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .updateTable('presentations')
        .set({
          trashed_at: null,
          trashed_by: null,
        })
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .where('trashed_at', 'is not', null) // Only restore if trashed
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;
      return mapPresentationRow(row);
    }

    /**
     * Permanently delete a presentation (bypass trash).
     * @param {string} id - Presentation ID
     * @param {object} ctx - Storage context
     */
    async permanentlyDeletePresentation(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('presentations')
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return result.numDeletedRows > 0;
    }

    async duplicatePresentation(id, ctx) {
      const existing = await this.getPresentation(id, ctx);
      if (!existing) return null;

      const slideIdMap = new Map();
      const mapSlides = (slides) => {
        return (slides || []).map((s) => {
          const newSlideId = crypto.randomUUID();
          if (s.id) slideIdMap.set(s.id, newSlideId);
          return { ...s, id: newSlideId };
        });
      };

      const newSlides = mapSlides(existing.slides);
      const newI18n = existing.i18n ? { ...existing.i18n } : {};
      if (newI18n.versions) {
        for (const [lang, version] of Object.entries(newI18n.versions)) {
          if (version?.slides) {
            newI18n.versions[lang] = {
              ...version,
              slides: mapSlides(version.slides),
            };
          }
        }
      }

      const lang = existing.i18n?.dominant || existing.lang || 'nl';
      const prefix = lang === 'en-GB' ? 'Copy of ' : 'Kopie van ';
      const newTitle = prefix + existing.title;

      return this.createPresentation(
        {
          title: newTitle,
          theme: existing.theme,
          lang: existing.lang,
          settings: existing.settings,
          i18n: newI18n,
          slides: newSlides,
        },
        ctx
      );
    }

    // ============================================================
    // COLLAB Y.DOC STATE
    // ============================================================

    async getYDocState(presentationId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('presentation_ydocs')
        .select('state')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row?.state) return null;
      return new Uint8Array(row.state);
    }

    async setYDocState(presentationId, state, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const buf = Buffer.from(state);
      const timestamp = now();

      await db
        .insertInto('presentation_ydocs')
        .values({
          presentation_id: presentationId,
          organization_id: orgId,
          state: buf,
          updated_at: timestamp,
        })
        .onConflict((oc) =>
          oc.column('presentation_id').doUpdateSet({
            state: buf,
            updated_at: timestamp,
          })
        )
        .execute();
      return true;
    }

    async deleteYDocState(presentationId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('presentation_ydocs')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();
      return Number(result?.numDeletedRows || 0) > 0;
    }

    // ============================================================
    // PRESENTATION VERSIONS
    // ============================================================

    async listPresentationVersions(presentationId, ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('presentation_versions')
        .select(['id', 'presentation_id', 'created_at', 'created_by', 'reason', 'label', 'revision', 'title'])
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .orderBy('created_at', 'desc');

      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map(mapVersionRowSummary);
    }

    async getPresentationVersion(presentationId, versionId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('presentation_versions')
        .selectAll()
        .where('id', '=', versionId)
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) return null;
      return mapVersionRowFull(row);
    }

    async createPresentationVersion(presentationId, snapshot, ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .insertInto('presentation_versions')
        .values({
          presentation_id: presentationId,
          organization_id: orgId,
          created_by: ctx?.actorEmail || null,
          reason: opts?.reason || 'snapshot',
          label: opts?.label || null,
          revision: snapshot.revision,
          title: snapshot.title,
          presentation_data: jsonb(snapshot),
        })
        .returningAll()
        .executeTakeFirst();

      return mapVersionRowFull(row);
    }

    async prunePresentationVersions(presentationId, ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const keep = opts?.keep || 50;

      const toKeep = await db
        .selectFrom('presentation_versions')
        .select('id')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .orderBy('created_at', 'desc')
        .limit(keep)
        .execute();

      const keepIds = toKeep.map((r) => r.id);
      if (keepIds.length === 0) return 0;

      const result = await db
        .deleteFrom('presentation_versions')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .where('id', 'not in', keepIds)
        .executeTakeFirst();

      return Number(result.numDeletedRows) || 0;
    }
  };
}
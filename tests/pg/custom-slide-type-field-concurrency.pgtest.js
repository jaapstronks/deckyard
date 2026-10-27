import crypto from 'node:crypto';
import { startCollabServer } from '../helpers/collab-socket.js';
import { getYDocState } from '../../server/storage/presentations/index.js';
import { Y, deckYdocCodec } from '../../server/collab/deck-doc.js';
import { createCollabPersistence } from '../../server/collab/persistence.js';
/** B849: the registry and all copies of its content share a PG write boundary. */
import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, __setTestDb } from '../../server/db/client.js';
import { updateCustomSlideType } from '../../server/storage/custom-slide-types.js';
import {
  createPresentation,
  updatePresentation,
  createPresentationVersion,
  createComment,
  getPresentation,
} from '../../server/storage/presentations/index.js';
import {
  createOrganizationLibraryItem,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';
import { savePresentation } from '../../server/services/save-presentation.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  openTestDb,
  closeTestDb,
  installFacadeStorage,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';

const scope = testScope();
const fields = ['headline', 'kicker', 'footer'].map((key) => ({
  key,
  type: 'string',
  label: key,
}));
const slide = (content = { headline: 'H', kicker: 'K' }) => ({
  id: 's1',
  type: 'custom-hero',
  content,
});
const deferred = () => Promise.withResolvers();

pgDescribe(
  'custom field removal serializes content writes (PostgreSQL)',
  () => {
    let db, orgId, typeId, deckId;
    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });
    after(async () => {
      await closeTestDb(db);
    });
    beforeEach(async () => {
      __setTestDb(db);
      await truncate(db, 'organizations');
      orgId = await seedDefaultOrganization(db);
      ({ id: typeId } = await db
        .insertInto('custom_slide_types')
        .values({
          organization_id: orgId,
          slug: 'hero',
          label: 'Hero',
          fields: JSON.stringify(fields),
          is_published: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow());
      deckId = await seedPresentation(db, { slides: [slide()] });
      await db
        .updateTable('presentations')
        .set({ visibility: 'organization' })
        .where('id', '=', deckId)
        .execute();
    });

    /** Pause exactly one real transaction after its work, before its commit. */
    function pauseCommit({ fail = false } = {}) {
      const entered = deferred(),
        release = deferred();
      let armed = true;
      const proxy = new Proxy(db, {
        get(target, prop) {
          if (prop === 'transaction')
            return () => ({
              execute: (fn) =>
                target.transaction().execute(async (trx) => {
                  const pause = armed;
                  armed = false;
                  const result = await fn(trx);
                  if (pause) {
                    const { rows } =
                      await sql`select pg_backend_pid() as pid`.execute(trx);
                    entered.resolve(rows[0].pid);
                    await release.promise;
                    if (fail)
                      throw new Error('injected rollback before commit');
                  }
                  return result;
                }),
            });
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      __setTestDb(proxy);
      return { entered: entered.promise, release: () => release.resolve() };
    }

    /** Observe the actual wait in PG; no timer decides when the commit occurs. */
    async function waitingOn(pid) {
      for (let n = 0; n < 300; n++) {
        const { rows } = await sql`select pid from pg_stat_activity
        where datname=current_database() and ${pid} = any(pg_blocking_pids(pid))`.execute(
          db,
        );
        if (rows.length) return;
        await delay(10);
      }
      assert.fail(
        'the competing content write never waited on the removal transaction',
      );
    }
    const remove = () =>
      updateCustomSlideType(
        scope,
        typeId,
        { fields: [fields[0]] },
        { force: true },
      );
    const caught = (promise) =>
      promise.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    const storedSlides = async () =>
      (
        await db
          .selectFrom('presentations')
          .select('slides')
          .where('id', '=', deckId)
          .executeTakeFirstOrThrow()
      ).slides;

    it('a real facade save waiting behind removal refuses the stale field, and the next edit succeeds', async () => {
      const gate = pauseCommit();
      const removal = remove();
      const pid = await gate.entered;
      const identity = {
        actor: {
          id: '11111111-1111-4111-8111-111111111111',
          organizationId: orgId,
          role: 'user',
        },
      };
      const saving = caught(
        savePresentation(scope, identity, {
          presentationId: deckId,
          changes: { slides: [slide({ headline: 'Concurrent', kicker: 'K' })] },
        }),
      );
      try {
        await waitingOn(pid);
      } finally {
        gate.release();
      }
      assert.equal((await removal).ok, true);
      assert.equal((await saving).error?.code, 'unknown_field');
      assert.deepEqual((await storedSlides())[0].content, { headline: 'H' });
      assert.ok(
        await savePresentation(scope, identity, {
          presentationId: deckId,
          changes: { slides: [slide({ headline: 'Next edit' })] },
        }),
      );
    });

    const writers = {
      'new deck': () =>
        createPresentation(scope, { title: 'New', slides: [slide()] }),
      'language buffer': () =>
        updatePresentation(scope, deckId, {
          i18n: {
            dominant: 'nl',
            versions: {
              nl: { title: 'NL', slides: [] },
              'en-GB': { title: 'EN', slides: [slide()] },
            },
          },
        }),
      'version snapshot': () =>
        createPresentationVersion(scope, deckId, {
          title: 'Old',
          slides: [slide()],
        }),
      'comment snapshot': () =>
        createComment(scope, deckId, {
          email: 'owner@example.com',
          body: 'note',
          slideId: 's1',
          slideSnapshot: slide(),
        }),
      'new library item with a language buffer': () =>
        createOrganizationLibraryItem(scope, {
          name: 'Item',
          slideType: 'custom-hero',
          content: { headline: 'H' },
          i18n: {
            versions: { nl: { content: { headline: 'NL', kicker: 'K' } } },
          },
        }),
    };
    for (const [name, write] of Object.entries(writers)) {
      it(`${name} cannot reintroduce a removed field after waiting`, async () => {
        const gate = pauseCommit();
        const removal = remove();
        const pid = await gate.entered;
        const writing = caught(write());
        try {
          await waitingOn(pid);
        } finally {
          gate.release();
        }
        assert.equal((await removal).ok, true);
        assert.equal((await writing).error?.code, 'unknown_field');
      });
    }

    it('a library PATCH is validated after acquiring the same boundary', async () => {
      const item = await createOrganizationLibraryItem(scope, {
        name: 'Item',
        slideType: 'custom-hero',
        content: { headline: 'H' },
      });
      const gate = pauseCommit();
      const removal = remove();
      const pid = await gate.entered;
      const writing = caught(
        updateOrganizationLibraryItem(
          scope,
          item.item.id,
          { content: { headline: 'H', kicker: 'K' } },
          { expectedRevision: item.item.revision, allowEdit: () => true },
        ),
      );
      try {
        await waitingOn(pid);
      } finally {
        gate.release();
      }
      await removal;
      assert.equal((await writing).error?.code, 'unknown_field');
    });

    for (const initiallyUsed of [[], ['kicker']]) {
      it(`content committed before removal is included, initial usage ${JSON.stringify(initiallyUsed)}`, async () => {
        await db
          .updateTable('presentations')
          .set({
            slides: JSON.stringify([
              slide({
                headline: 'H',
                ...Object.fromEntries(initiallyUsed.map((k) => [k, 'old'])),
              }),
            ]),
          })
          .where('id', '=', deckId)
          .execute();
        // The writer owns the organization boundary. Removal must not count
        // until it commits, including a formerly unused second removed field.
        const gate = pauseCommit();
        const writing = updatePresentation(scope, deckId, {
          slides: [slide({ headline: 'H', kicker: 'new', footer: 'new' })],
        });
        const pid = await gate.entered;
        const removal = remove();
        try {
          await waitingOn(pid);
        } finally {
          gate.release();
        }
        await writing;
        assert.equal((await removal).ok, true);
        assert.deepEqual((await storedSlides())[0].content, { headline: 'H' });
      });
    }

    it('new content committed first makes an unforced removal refuse', async () => {
      await db
        .updateTable('presentations')
        .set({ slides: '[]' })
        .where('id', '=', deckId)
        .execute();
      const gate = pauseCommit();
      const writing = createPresentation(scope, {
        title: 'New',
        slides: [slide()],
      });
      const pid = await gate.entered;
      const removal = updateCustomSlideType(scope, typeId, {
        fields: [fields[0]],
      });
      try {
        await waitingOn(pid);
      } finally {
        gate.release();
      }
      await writing;
      const result = await removal;
      assert.equal(result.reason, 'field_in_use');
      assert.deepEqual(result.usage.fields, ['kicker']);
    });

    it('a pending collab store cannot restore an obsolete binary after removal', async () => {
      const document = new Y.Doc();
      deckYdocCodec.bootstrapPresentationToDoc(
        await getPresentation(scope, deckId),
        document,
      );
      const errors = [];
      const hooks = createCollabPersistence({
        repoRoot: scope.repoRoot,
        documentScope: () => scope,
        deps: {
          log: {
            warn: () => {},
            error: (...args) => errors.push(args.join(' ')),
          },
        },
      });
      const gate = pauseCommit();
      const removal = remove();
      const pid = await gate.entered;
      const storing = hooks.onStoreDocument({
        documentName: `presentation:${deckId}`,
        document,
      });
      try {
        await waitingOn(pid);
      } finally {
        gate.release();
      }
      await removal;
      await storing;
      assert.deepEqual((await storedSlides())[0].content, { headline: 'H' });
      assert.equal(
        (
          await db
            .selectFrom('presentation_ydocs')
            .select('presentation_id')
            .where('presentation_id', '=', deckId)
            .execute()
        ).length,
        0,
      );
      assert.ok(errors.some((line) => line.includes('obsolete custom fields')));
      document.destroy();
    });

    for (const initiallyUsed of [[], ['kicker']]) {
      it(`live-only removed fields are cleaned, initial stored usage ${JSON.stringify(initiallyUsed)}`, async (t) => {
        process.env.COLLAB_ENABLED = 'true';
        process.env.COLLAB_LIVE_EDITS = 'true';
        t.after(() => {
          delete process.env.COLLAB_ENABLED;
          delete process.env.COLLAB_LIVE_EDITS;
        });
        await db
          .updateTable('presentations')
          .set({
            slides: JSON.stringify([
              slide({
                headline: 'H',
                ...Object.fromEntries(initiallyUsed.map((k) => [k, 'stored'])),
              }),
            ]),
          })
          .where('id', '=', deckId)
          .execute();
        const otherOrg = crypto.randomUUID();
        await db
          .insertInto('organizations')
          .values({ id: otherOrg, name: 'Other', slug: 'other' })
          .execute();
        await db
          .insertInto('custom_slide_types')
          .values({
            organization_id: otherOrg,
            slug: 'hero',
            label: 'Other hero',
            fields: JSON.stringify(fields),
            is_published: true,
          })
          .execute();
        const otherId = await seedPresentation(db, {
          organizationId: otherOrg,
          slides: [slide()],
        });
        const server = await startCollabServer({ repoRoot: scope.repoRoot });
        t.after(() => server.stop());
        const connection = await server.hocuspocus.openDirectConnection(
          `presentation:${deckId}`,
        );
        const other = await server.hocuspocus.openDirectConnection(
          `presentation:${otherId}`,
        );
        t.after(async () => {
          await connection.disconnect();
          await other.disconnect();
        });
        let document, otherDocument;
        await other.transact((doc) => {
          otherDocument = doc;
        });
        const otherBefore =
          deckYdocCodec.projectDocToPresentation(otherDocument);
        const edit = (doc, content) => {
          const before = deckYdocCodec.projectDocToPresentation(doc);
          const next = structuredClone(before);
          next.slides[0].content = { ...next.slides[0].content, ...content };
          for (const version of Object.values(next.i18n.versions)) {
            version.slides[0].content = {
              ...version.slides[0].content,
              ...content,
            };
          }
          deckYdocCodec.applyPresentationToDoc(next, doc, { base: before });
        };
        await connection.transact((doc) => {
          document = doc;
          edit(doc, {
            headline: 'Concurrent valid edit',
            kicker: 'Live K',
            footer: 'Live F',
          });
        });
        assert.equal(
          Object.hasOwn((await storedSlides())[0].content, 'footer'),
          false,
        );
        const liveBefore = deckYdocCodec.projectDocToPresentation(document);
        const gate = pauseCommit({ fail: true });
        const failed = caught(remove());
        await gate.entered;
        gate.release();
        assert.match((await failed).error.message, /injected rollback/);
        __setTestDb(db);
        assert.deepEqual(
          deckYdocCodec.projectDocToPresentation(document),
          liveBefore,
        );
        assert.equal((await remove()).ok, true);
        const cleaned = deckYdocCodec.projectDocToPresentation(document);
        assert.deepEqual(cleaned.slides[0].content, {
          headline: 'Concurrent valid edit',
        });
        for (const version of Object.values(cleaned.i18n.versions)) {
          assert.deepEqual(version.slides[0].content, {
            headline: 'Concurrent valid edit',
          });
        }
        assert.deepEqual(
          deckYdocCodec.projectDocToPresentation(otherDocument),
          otherBefore,
        );
        await connection.transact((doc) =>
          edit(doc, { headline: 'Next valid edit' }),
        );
        await connection.disconnect();
        assert.deepEqual((await storedSlides())[0].content, {
          headline: 'Next valid edit',
        });
        const binary = new Y.Doc();
        Y.applyUpdate(binary, await getYDocState(scope, deckId));
        assert.deepEqual(
          deckYdocCodec.projectDocToPresentation(binary).slides[0].content,
          { headline: 'Next valid edit' },
        );
        binary.destroy();
      });
    }

    it('another organization can write while this organization is migrating', async () => {
      const otherId = crypto.randomUUID();
      await db
        .insertInto('organizations')
        .values({ id: otherId, name: 'Other', slug: 'other' })
        .execute();
      const otherScope = { ...scope, organizationId: otherId };
      const gate = pauseCommit();
      const removal = remove();
      await gate.entered;
      try {
        const result = await Promise.race([
          createPresentation(otherScope, { title: 'Other deck', slides: [] }),
          delay(1500).then(() => {
            throw new Error('unrelated organization blocked');
          }),
        ]);
        assert.equal(result.organizationId, otherId);
      } finally {
        gate.release();
        await removal;
      }
    });

    it('rollback restores the type and every stripped surface', async () => {
      const before = await getPresentation(scope, deckId);
      const gate = pauseCommit({ fail: true });
      const removal = caught(remove());
      await gate.entered;
      gate.release();
      assert.match((await removal).error.message, /injected rollback/);
      assert.deepEqual(await getPresentation(scope, deckId), before);
      const type = await db
        .selectFrom('custom_slide_types')
        .select('fields')
        .where('id', '=', typeId)
        .executeTakeFirstOrThrow();
      assert.deepEqual(type.fields, fields);
    });
  },
);

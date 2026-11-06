/**
 * Tests for collab Y.Doc persistence (phase 2, step 2): the Y.Doc state
 * facade, the Hocuspocus onLoadDocument/onStoreDocument hooks, and
 * cold-binary invalidation when a deck is saved outside the collab doc.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js), the
 * only storage backend there is.
 *
 * Run with: node --test tests/collab-persistence.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import * as Y from 'yjs';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { deckYdocCodec } from '../server/collab/deck-doc.js';
import { REFUSED_FIELDS_MESSAGE } from '../shared/collab/refused-fields.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { getYDocState, setYDocState, deleteYDocState } =
  await import('../server/storage/presentations/ydocs.js');
const { createPresentation, getPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { holdBackRefusedSlideFields } =
  await import('../server/services/slide-field-validation.js');

// The collab hooks still take a `repoRoot` for their scope shape; storage
// ignores it entirely now that PostgreSQL is the only backend.
const REPO_ROOT = process.cwd();

__setTestDb(
  createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  }),
);
await initializeStorage();

// `closeStorage()` would call `db.destroy()`, which the in-memory double does
// not have — drop the adapter singleton instead, the seam meant for exactly
// this (server/db/lifecycle.js).
after(() => {
  __setTestDb(null);
});

function stripVolatile(pres) {
  const p = JSON.parse(JSON.stringify(pres));
  if (p.i18n) delete p.i18n.progress;
  delete p.modified;
  delete p.revision;
  return p;
}

function docName(id) {
  return `presentation:${id}`;
}

/** Collect log lines instead of spamming the test output. */
function makeLog() {
  const lines = { warn: [], error: [] };
  return {
    lines,
    warn: (...args) => lines.warn.push(args.join(' ')),
    error: (...args) => lines.error.push(args.join(' ')),
  };
}

describe('ydoc-state facade', () => {
  let deckId;

  before(async () => {
    const created = await createPresentation(testScope(), {
      title: 'Ydoc state deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });

  it('set/get/delete round-trip', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    assert.equal(await getYDocState(testScope(), deckId), null);
    assert.equal(await setYDocState(testScope(), deckId, bytes), true);
    assert.deepEqual(await getYDocState(testScope(), deckId), bytes);
    assert.equal(await deleteYDocState(testScope(), deckId), true);
    assert.equal(await getYDocState(testScope(), deckId), null);
  });
});

describe('collab persistence hooks', () => {
  let deckId;
  let log;
  let hooks;

  before(async () => {
    const created = await createPresentation(testScope(), {
      title: 'Persistente deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });
  beforeEach(() => {
    log = makeLog();
    hooks = createCollabPersistence({ repoRoot: REPO_ROOT, deps: { log } });
  });

  it('first open bootstraps the doc from the deck JSON and persists the binary', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const stored = await getPresentation(testScope(), deckId);
    assert.deepStrictEqual(
      stripVolatile(deckYdocCodec.projectDocToPresentation(doc)),
      stripVolatile(stored),
    );

    const bin = await getYDocState(testScope(), deckId);
    assert.ok(
      bin instanceof Uint8Array && bin.length > 0,
      'bootstrap binary persisted',
    );
  });

  it('a stored pre-provenance doc gets one shared empty container before peers connect', async () => {
    const old = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: old,
    });
    old.getMap('meta').delete('translationSources');
    await setYDocState(testScope(), deckId, Y.encodeStateAsUpdate(old));
    const loaded = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: loaded,
    });
    assert.ok(loaded.getMap('meta').get('translationSources') instanceof Y.Map);
    assert.equal(loaded.getMap('meta').get('translationSources').size, 0);
    const projected = deckYdocCodec.projectDocToPresentation(loaded);
    for (const version of Object.values(projected.i18n?.versions || {}))
      assert.equal(version.translationSources, undefined);
  });

  it('later opens load the binary instead of re-bootstrapping', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });

    // Edit the live doc + store, then open a second doc: it must see the edit.
    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, ' (bewerkt)');
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const doc2 = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc2,
    });
    assert.match(
      doc2.getMap('meta').get('title').get('nl').toString(),
      / \(bewerkt\)$/,
    );
  });

  it('onStoreDocument serializes the doc back to the deck JSON via the facade', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    const before = await getPresentation(testScope(), deckId);

    const title = doc.getMap('meta').get('title').get('nl');
    title.delete(0, title.length);
    title.insert(0, 'Live bewerkt');
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.title, 'Live bewerkt');
    assert.equal(
      afterJson.revision,
      before.revision + 1,
      'revision bumped by the facade',
    );
    assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
  });

  it('keeps the binary and leaves the JSON untouched when serialization fails', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    const before = await getPresentation(testScope(), deckId);

    const failing = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: {
        log,
        updatePresentation: async () => {
          throw new Error('validation exploded');
        },
      },
    });

    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, '!!!');
    await assert.doesNotReject(
      failing.onStoreDocument({ documentName: docName(deckId), document: doc }),
    );

    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.title, before.title, 'JSON not clobbered');
    assert.equal(afterJson.revision, before.revision, 'JSON untouched');
    assert.equal(log.lines.error.length, 1);
    assert.match(log.lines.error[0], /JSON left as-is/);

    // The binary DID advance: a reload sees the unserialized edit.
    const doc2 = new Y.Doc();
    await failing.onLoadDocument({
      documentName: docName(deckId),
      document: doc2,
    });
    assert.match(doc2.getMap('meta').get('title').get('nl').toString(), /!!!$/);
  });

  describe('field validation on the store (DY-813)', () => {
    /** A deck with one end slide, open in a doc, and a way to edit that slide. */
    async function openEndSlide(others = []) {
      const { id } = await createPresentation(testScope(), {
        title: 'Eindslide',
        ownerEmail: 'owner@example.com',
        lang: 'nl',
      });
      const stored = await getPresentation(testScope(), id);
      const slide = {
        id: 'end-1',
        type: 'end-slide',
        content: { title: 'Bedankt', contactUrl: 'https://example.com/' },
      };
      await updatePresentation(testScope(), id, {
        ...stored,
        slides: [slide, ...others],
        i18n: {
          ...stored.i18n,
          versions: {
            ...stored.i18n?.versions,
            nl: { ...stored.i18n?.versions?.nl, slides: [slide, ...others] },
          },
        },
      });
      const doc = new Y.Doc();
      await hooks.onLoadDocument({ documentName: docName(id), document: doc });
      const edit = async (fields, index = 0) => {
        const base = deckYdocCodec.projectDocToPresentation(doc);
        const next = structuredClone(base);
        Object.assign(next.slides[index].content, fields);
        const version = next.i18n?.versions?.nl?.slides?.[index];
        if (version) Object.assign(version.content, fields);
        deckYdocCodec.applyPresentationToDoc(next, doc, { base });
        await hooks.onStoreDocument({
          documentName: docName(id),
          document: doc,
        });
      };
      return { id, doc, edit };
    }
    const storedContent = async (id, index = 0) =>
      (await getPresentation(testScope(), id)).slides[index].content;
    const OTHER_SLIDE = {
      id: 'other-1',
      type: 'end-slide',
      content: { title: 'Oud' },
    };

    it('a javascript: link stays out of the JSON, the binary keeps the work, a fix lands', async () => {
      const { id, doc, edit } = await openEndSlide();

      await edit({ contactUrl: 'javascript:alert(1)' });

      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
      assert.deepEqual(
        await getYDocState(testScope(), id),
        Y.encodeStateAsUpdate(doc),
        'the binary holds the refused state, so nothing typed is lost',
      );
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
      assert.equal(log.lines.warn.length, 1);
      assert.match(log.lines.warn[0], /contactUrl/);
      assert.doesNotMatch(log.lines.warn[0], /alert\(1\)/);

      await edit({ contactUrl: 'https://example.org/' });

      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.org/',
      );
    });

    describe('every peer hears which field stays out (DY-856)', () => {
      const listen = (doc) => {
        const sent = [];
        doc.broadcastStateless = (message) => sent.push(JSON.parse(message));
        return sent;
      };
      const connection = () => {
        const sent = [];
        return { sent, sendStateless: (m) => sent.push(JSON.parse(m)) };
      };

      it('a refusal is broadcast once, named without its value, and a fix clears it', async () => {
        const { id, doc, edit } = await openEndSlide();
        const sent = listen(doc);

        await edit({ contactUrl: 'javascript:alert(1)' });
        await edit({ title: 'Nog steeds' });

        assert.equal(sent.length, 1, 'an unchanged set is not sent again');
        assert.equal(sent[0].type, REFUSED_FIELDS_MESSAGE);
        assert.equal(sent[0].fields.length, 1, 'one entry for both versions');
        assert.deepEqual(
          { ...sent[0].fields[0], errors: undefined },
          {
            slideId: 'end-1',
            field: 'contactUrl',
            path: [],
            lang: 'nl',
            errors: undefined,
          },
        );
        assert.ok(sent[0].fields[0].errors.length);
        assert.doesNotMatch(JSON.stringify(sent), /alert\(1\)/);

        const late = connection();
        hooks.sendRefusedFields(late, docName(id));
        assert.deepEqual(late.sent, [sent[0]], 'a later peer hears it too');

        await edit({ contactUrl: 'https://example.org/' });
        assert.equal(sent.length, 2);
        assert.deepEqual(sent[1].fields, []);
        const after = connection();
        hooks.sendRefusedFields(after, docName(id));
        assert.deepEqual(after.sent[0].fields, [], 'a reconnect clears it');
      });

      it('a refused value in a stored binary is known on the next load, before any store', async () => {
        const { id, edit } = await openEndSlide();
        await edit({ contactUrl: 'javascript:alert(1)' });
        await hooks.afterUnloadDocument({ documentName: docName(id) });

        const reopened = createCollabPersistence({
          repoRoot: REPO_ROOT,
          deps: { log },
        });
        await reopened.onLoadDocument({
          documentName: docName(id),
          document: new Y.Doc(),
        });
        const peer = connection();
        reopened.sendRefusedFields(peer, docName(id));

        assert.deepEqual(
          peer.sent[0].fields.map((f) => [f.slideId, f.field]),
          [['end-1', 'contactUrl']],
        );
      });
    });

    it('an old bad link on a slide nobody touches does not hold back other edits', async () => {
      const { id, edit } = await openEndSlide([
        {
          id: 'end-2',
          type: 'end-slide',
          content: { title: 'Oud', contactUrl: 'example.com' },
        },
      ]);

      await edit({ title: 'Nieuw' });

      assert.equal((await storedContent(id)).title, 'Nieuw');
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
    });

    it('an edit on another slide lands while one field is refused', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ contactUrl: 'www.example.com' });
      await edit({ title: 'Een uur werk' }, 1);

      assert.equal((await storedContent(id, 1)).title, 'Een uur werk');
      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
      const stored = await getPresentation(testScope(), id);
      assert.deepEqual(
        stored.i18n.versions.nl.slides,
        stored.slides,
        'the language version gets the same held-back slides',
      );
    });

    it('another field on the same slide lands beside the refused one', async () => {
      const { id, edit } = await openEndSlide();

      await edit({ contactUrl: 'www.example.com', title: 'Nieuw' });

      const content = await storedContent(id);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, 'https://example.com/');
    });

    it('a write from outside the doc afterwards loses at most the refused field', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);
      await edit({ contactUrl: 'www.example.com' });
      await edit({ title: 'Een uur werk' }, 1);

      const cold = await getPresentation(testScope(), id);
      await updatePresentation(testScope(), id, { ...cold, title: 'Hernoemd' });
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(await getYDocState(testScope(), id), null);
      assert.equal((await storedContent(id, 1)).title, 'Een uur werk');
      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
    });

    it('a title that is too long holds back only that title', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ title: 'x'.repeat(130) });
      await edit({ title: 'Later werk' }, 1);

      assert.equal((await storedContent(id)).title, 'Bedankt');
      assert.equal((await storedContent(id, 1)).title, 'Later werk');
    });

    it('a half-typed e-mail address holds back only that address', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ contactEmail: 'jaap@' });
      await edit({ title: 'Later werk' }, 1);

      assert.equal((await storedContent(id)).contactEmail, undefined);
      assert.equal((await storedContent(id, 1)).title, 'Later werk');
    });

    it('a new slide is stored without its refused field', async () => {
      const { id, doc } = await openEndSlide();
      const base = deckYdocCodec.projectDocToPresentation(doc);
      const next = structuredClone(base);
      const added = {
        id: 'new-1',
        type: 'end-slide',
        content: { title: 'Nieuw', contactUrl: 'javascript:alert(1)' },
        notes: '',
      };
      next.slides.push(added);
      next.i18n.versions.nl.slides.push(structuredClone(added));
      deckYdocCodec.applyPresentationToDoc(next, doc, { base });

      await hooks.onStoreDocument({ documentName: docName(id), document: doc });

      const content = await storedContent(id, 1);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, undefined);
    });

    it('a store that changes only a refused field writes nothing and logs once', async () => {
      const { id, doc, edit } = await openEndSlide([OTHER_SLIDE]);
      await edit({ title: 'Eerst iets echts' }, 1);
      const before = await getPresentation(testScope(), id);

      await edit({ contactUrl: 'www.example.com' });
      await hooks.onStoreDocument({ documentName: docName(id), document: doc });
      await hooks.onStoreDocument({ documentName: docName(id), document: doc });

      const stored = await getPresentation(testScope(), id);
      assert.equal(stored.revision, before.revision, 'no revision bump');
      assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));

      await edit({ contactUrl: 'www.example.org' });
      assert.equal(log.lines.warn.length, 2, 'a new value gets its own line');
    });

    it('an old bad value on a slide someone edits stops nothing and logs nothing', async () => {
      const { id, edit } = await openEndSlide([
        {
          id: 'end-2',
          type: 'end-slide',
          content: { title: 'Oud', contactUrl: 'example.com' },
        },
      ]);

      await edit({ title: 'Nieuw' }, 1);

      const content = await storedContent(id, 1);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, 'example.com');
      assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
    });

    it('holds a value back in every language version and reports it per version', async () => {
      const slide = (title, contactUrl) => ({
        id: 'end-1',
        type: 'end-slide',
        content: { title, contactUrl },
      });
      const deck = (nl, en) => ({
        slides: [nl],
        i18n: {
          active: 'nl',
          dominant: 'nl',
          versions: { nl: { slides: [nl] }, 'en-GB': { slides: [en] } },
        },
      });
      const stored = deck(
        slide('Bedankt', 'https://example.com/'),
        slide('Thanks', 'https://example.com/'),
      );

      const { deck: written, refused } = await holdBackRefusedSlideFields(
        testScope(),
        stored,
        deck(
          slide('Bedankt', 'javascript:alert(1)'),
          slide('Thank you', 'javascript:alert(1)'),
        ),
      );

      assert.equal(
        written.slides[0].content.contactUrl,
        'https://example.com/',
      );
      assert.equal(
        written.i18n.versions.nl.slides[0],
        written.slides[0],
        'the active version is the top-level buffer',
      );
      const en = written.i18n.versions['en-GB'].slides[0].content;
      assert.equal(en.contactUrl, 'https://example.com/');
      assert.equal(en.title, 'Thank you');
      assert.equal(refused.length, 2);
    });

    it('a slide whose type changed does not get the stored value of its old type', async () => {
      const stored = {
        slides: [
          {
            id: 's1',
            type: 'content-slide',
            content: { title: 'Oud', contactUrl: 'https://example.com/' },
          },
        ],
      };
      const { deck: written } = await holdBackRefusedSlideFields(
        testScope(),
        stored,
        {
          slides: [
            {
              id: 's1',
              type: 'end-slide',
              content: { title: 'Nieuw', contactUrl: 'javascript:alert(1)' },
            },
          ],
        },
      );
      assert.equal(written.slides[0].content.title, 'Nieuw');
      assert.equal('contactUrl' in written.slides[0].content, false);
    });

    it('an empty required field on its way to a new value is not a refusal', async () => {
      const { id, edit } = await openEndSlide();

      await edit({ title: '' });

      assert.equal((await storedContent(id)).title, '');
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
    });

    describe('inside a list, per item sub-field', () => {
      const ANNA = {
        name: 'Anna',
        linkedin: 'https://www.linkedin.com/in/anna',
      };
      /** A deck with one team-cards slide open in a doc, and a way to change it. */
      async function openTeam(members) {
        const { id } = await createPresentation(testScope(), {
          title: 'Team',
          ownerEmail: 'owner@example.com',
          lang: 'nl',
        });
        const stored = await getPresentation(testScope(), id);
        const slide = {
          id: 't-1',
          type: 'team-cards-slide',
          content: { title: 'Team', members },
        };
        await updatePresentation(testScope(), id, {
          ...stored,
          slides: [slide],
          i18n: {
            ...stored.i18n,
            versions: {
              ...stored.i18n?.versions,
              nl: { ...stored.i18n?.versions?.nl, slides: [slide] },
            },
          },
        });
        const doc = new Y.Doc();
        await hooks.onLoadDocument({
          documentName: docName(id),
          document: doc,
        });
        const mutate = async (fn) => {
          const base = deckYdocCodec.projectDocToPresentation(doc);
          const next = structuredClone(base);
          fn(next.slides[0].content);
          next.i18n.versions.nl.slides[0] = structuredClone(next.slides[0]);
          deckYdocCodec.applyPresentationToDoc(next, doc, { base });
          await hooks.onStoreDocument({
            documentName: docName(id),
            document: doc,
          });
        };
        return { id, doc, mutate };
      }
      const storedMembers = async (id) =>
        (await getPresentation(testScope(), id)).slides[0].content.members;

      it('another item, a new item and a removed item land beside a refused item link', async () => {
        const { id, mutate } = await openTeam([
          ANNA,
          { name: 'Bob' },
          { name: 'Dirk' },
        ]);

        await mutate((c) => {
          c.members[1].linkedin = 'linkedin.com/in/bob';
        });
        await mutate((c) => {
          c.members[0].name = 'Anna de Vries';
        });
        await mutate((c) => {
          c.members.push({ name: 'Carla', byline: 'Nieuw' });
        });
        await mutate((c) => {
          c.members.splice(2, 1);
        });
        await mutate((c) => {
          c.title = 'Ons team';
        });

        const stored = await getPresentation(testScope(), id);
        const members = stored.slides[0].content.members;
        assert.equal(stored.slides[0].content.title, 'Ons team');
        assert.deepEqual(
          members.map((m) => m.name),
          ['Anna de Vries', 'Bob', 'Carla'],
        );
        assert.equal(members[0].linkedin, ANNA.linkedin);
        assert.equal(
          'linkedin' in members[1],
          false,
          'the refused link is left out',
        );
        assert.equal(members[2].byline, 'Nieuw');
        assert.deepEqual(stored.i18n.versions.nl.slides, stored.slides);
        assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
        assert.match(log.lines.warn[0], /"members" item \[1\]\.linkedin/);
        assert.doesNotMatch(log.lines.warn[0], /linkedin\.com\/in\/bob/);
      });

      it('a write from outside the doc afterwards loses at most that link', async () => {
        const { id, mutate } = await openTeam([ANNA, { name: 'Bob' }]);
        await mutate((c) => {
          c.members[1].linkedin = 'linkedin.com/in/bob';
          c.members[0].name = 'Anna de Vries';
          c.members.push({ name: 'Carla' });
        });

        const cold = await getPresentation(testScope(), id);
        await updatePresentation(testScope(), id, {
          ...cold,
          title: 'Hernoemd',
        });
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(await getYDocState(testScope(), id), null);
        const members = await storedMembers(id);
        assert.deepEqual(
          members.map((m) => m.name),
          ['Anna de Vries', 'Bob', 'Carla'],
        );
        assert.equal('linkedin' in members[1], false);
      });

      it('after a reorder no stored link sits on another item', async () => {
        const { id, mutate } = await openTeam([ANNA, { name: 'Bob' }]);

        await mutate((c) => {
          c.members.reverse();
          c.members[0].linkedin = 'linkedin.com/in/bob';
        });

        const members = await storedMembers(id);
        assert.deepEqual(
          members.map((m) => m.name),
          ['Bob', 'Anna'],
        );
        assert.equal(
          'linkedin' in members[0],
          false,
          "Anna's stored link at index 0 does not move onto Bob",
        );
        assert.equal(members[1].linkedin, ANNA.linkedin);
      });

      it('an old stored bad item link does not hold back an edit to another item and logs nothing', async () => {
        const { id, mutate } = await openTeam([
          ANNA,
          { name: 'Bob', linkedin: 'linkedin.com/in/bob' },
        ]);

        await mutate((c) => {
          c.members[0].name = 'Anna de Vries';
        });

        const members = await storedMembers(id);
        assert.equal(members[0].name, 'Anna de Vries');
        assert.equal(members[1].linkedin, 'linkedin.com/in/bob');
        assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
        assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
      });

      it('several stores of a changing list log one line for one refused value', async () => {
        const { id, mutate } = await openTeam([ANNA, { name: 'Bob' }]);

        await mutate((c) => {
          c.members[1].linkedin = 'linkedin.com/in/bob';
        });
        await mutate((c) => {
          c.members[0].name = 'Anna de Vries';
        });
        await mutate((c) => {
          c.members.unshift({ name: 'Carla' });
        });

        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
        const members = await storedMembers(id);
        assert.deepEqual(
          members.map((m) => m.name),
          ['Carla', 'Anna de Vries', 'Bob'],
        );
        assert.equal('linkedin' in members[2], false);
      });

      it('a refusal of the list itself keeps the stored list', async () => {
        const stored = {
          slides: [
            {
              id: 't-1',
              type: 'team-cards-slide',
              content: { title: 'Team', members: [ANNA] },
            },
          ],
        };
        const { deck: written, refused } = await holdBackRefusedSlideFields(
          testScope(),
          stored,
          {
            slides: [
              {
                id: 't-1',
                type: 'team-cards-slide',
                content: { title: 'Team', members: [ANNA, 'not an object'] },
              },
            ],
          },
        );
        assert.deepEqual(written.slides[0].content.members, [ANNA]);
        assert.equal(refused.length, 1);
        assert.deepEqual(refused[0].path, []);
      });

      it('a list inside an item holds back the nested sub-field only', async () => {
        const row = (title) => ({
          blocks: [{ title: 'Eerste', body: 'Tekst' }, { title }],
        });
        const slide = (rows) => ({
          id: 'tb-1',
          type: 'text-blocks-slide',
          content: { rows },
        });
        const { deck: written, refused } = await holdBackRefusedSlideFields(
          testScope(),
          { slides: [slide([row('Oud')])] },
          { slides: [slide([row('x'.repeat(500)), row('Nieuwe rij')])] },
        );
        const rows = written.slides[0].content.rows;
        assert.equal(rows.length, 2, 'the new row lands');
        assert.equal(rows[0].blocks[0].title, 'Eerste');
        assert.equal('title' in rows[0].blocks[1], false);
        assert.equal(rows[1].blocks[1].title, 'Nieuwe rij');
        assert.deepEqual(
          refused.map((r) => r.path),
          [[0, 'blocks', 1, 'title']],
        );
      });

      it('a new slide keeps its list without the refused sub-field', async () => {
        const { deck: written } = await holdBackRefusedSlideFields(
          testScope(),
          { slides: [] },
          {
            slides: [
              {
                id: 't-2',
                type: 'team-cards-slide',
                content: {
                  title: 'Team',
                  members: [ANNA, { name: 'Bob', linkedin: 'javascript:x' }],
                },
              },
            ],
          },
        );
        const members = written.slides[0].content.members;
        assert.deepEqual(
          members.map((m) => m.name),
          ['Anna', 'Bob'],
        );
        assert.equal('linkedin' in members[1], false);
      });

      /** A deck with one slide open in a doc; peers edit its content. */
      async function openSlide(slide) {
        const { id } = await createPresentation(testScope(), {
          title: 'Lijst',
          ownerEmail: 'owner@example.com',
          lang: 'nl',
        });
        const stored = await getPresentation(testScope(), id);
        await updatePresentation(testScope(), id, {
          ...stored,
          slides: [slide],
          i18n: {
            ...stored.i18n,
            versions: {
              ...stored.i18n?.versions,
              nl: { ...stored.i18n?.versions?.nl, slides: [slide] },
            },
          },
        });
        const doc = new Y.Doc();
        await hooks.onLoadDocument({
          documentName: docName(id),
          document: doc,
        });
        const edit = (target, fn) => {
          const base = deckYdocCodec.projectDocToPresentation(target);
          const next = structuredClone(base);
          fn(next.slides[0].content);
          next.i18n.versions.nl.slides[0] = structuredClone(next.slides[0]);
          deckYdocCodec.applyPresentationToDoc(next, target, { base });
        };
        const store = () =>
          hooks.onStoreDocument({ documentName: docName(id), document: doc });
        /** A peer that starts from the doc as it is now. */
        const peer = (fn) => {
          const other = new Y.Doc();
          Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
          edit(other, fn);
          return other;
        };
        const mutate = async (fn) => {
          edit(doc, fn);
          await store();
        };
        const content = async () =>
          (await getPresentation(testScope(), id)).slides[0].content;
        return { id, doc, peer, store, mutate, content };
      }
      const block = (n) => ({ title: `B${n}`, body: 'Tekst' });
      const blocksSlide = (rows) => ({
        id: 'tb-1',
        type: 'text-blocks-slide',
        content: { rows },
      });

      it('two peers who each add a block to a row at five of six keep the stored five blocks', async () => {
        const five = [1, 2, 3, 4, 5].map(block);
        const { id, doc, peer, store, mutate, content } = await openSlide(
          blocksSlide([{ title: 'Rij', blocks: five }]),
        );
        const anna = peer((c) => c.rows[0].blocks.push(block('Anna')));
        const bob = peer((c) => c.rows[0].blocks.push(block('Bob')));
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(anna));
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(bob));
        assert.equal(
          deckYdocCodec.projectDocToPresentation(doc).slides[0].content.rows[0]
            .blocks.length,
          7,
          'the doc holds both inserts',
        );

        await store();
        assert.deepEqual((await content()).rows[0].blocks, five);
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
        assert.match(log.lines.warn[0], /"rows" item \[0\]\.blocks/);

        const cold = await getPresentation(testScope(), id);
        await updatePresentation(testScope(), id, { ...cold, title: 'Koud' });
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(await getYDocState(testScope(), id), null);
        assert.deepEqual((await content()).rows[0].blocks, five);

        await mutate((c) => c.rows[0].blocks.pop());
        const landed = (await content()).rows[0].blocks.map((b) => b.title);
        assert.equal(landed.length, 6, 'below the limit the list lands');
        assert.deepEqual(landed.slice(0, 5), ['B1', 'B2', 'B3', 'B4', 'B5']);
      });

      it('a nested list stored over its count stops nothing, also after its item moves', async () => {
        const seven = [1, 2, 3, 4, 5, 6, 7].map(block);
        const { mutate, content } = await openSlide(
          blocksSlide([{ title: 'Oud', blocks: seven }]),
        );

        await mutate((c) => {
          c.rows[0].title = 'Hernoemd';
        });
        await mutate((c) => {
          c.rows.unshift({ title: 'Nieuw', blocks: [block(1)] });
        });

        const rows = (await content()).rows;
        assert.deepEqual(
          rows.map((r) => r.title),
          ['Nieuw', 'Hernoemd'],
        );
        assert.deepEqual(rows[1].blocks, seven);
        assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
      });

      it('an old over-long text and an old bad link stay stored after an insert, a removal and a reorder', async () => {
        const OLD = {
          name: 'N'.repeat(200),
          byline: 'Oud',
          linkedin: 'linkedin.com/in/bob',
        };
        const { mutate, content } = await openSlide({
          id: 't-1',
          type: 'team-cards-slide',
          content: { title: 'Team', members: [ANNA, OLD] },
        });
        const old = async () =>
          (await content()).members.find((m) => m.byline === 'Oud');

        await mutate((c) => c.members.unshift({ name: 'Carla' }));
        assert.deepEqual(await old(), OLD, 'after an insert before it');
        await mutate((c) => c.members.splice(1, 1));
        assert.deepEqual(await old(), OLD, 'after a removal before it');
        await mutate((c) => c.members.reverse());
        assert.deepEqual(await old(), OLD, 'after a reorder');
        assert.deepEqual(
          (await content()).members.map((m) => m.name),
          [OLD.name, 'Carla'],
        );
        assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
        assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
      });

      it('a bad value the stored list does not hold is still left out after the same edits', async () => {
        const { mutate, content } = await openSlide({
          id: 't-1',
          type: 'team-cards-slide',
          content: {
            title: 'Team',
            members: [ANNA, { name: 'Bob', linkedin: 'linkedin.com/in/bob' }],
          },
        });

        await mutate((c) => {
          c.members.unshift({ name: 'Carla', linkedin: 'linkedin.com/in/c' });
          c.members[2].name = 'X'.repeat(200);
        });
        await mutate((c) => c.members.splice(1, 1));
        await mutate((c) => c.members.reverse());

        const members = (await content()).members;
        assert.deepEqual(
          members.map((m) => m.name ?? null),
          [null, 'Carla'],
          "Bob's new over-long name is left out, Anna is removed",
        );
        assert.equal(members[0].linkedin, 'linkedin.com/in/bob');
        assert.equal('linkedin' in members[1], false);
        assert.equal(log.lines.warn.length, 2, log.lines.warn.join('\n'));
      });

      it('an old over-long block title stays stored when its row moves past the stored rows and is edited', async () => {
        const long = { title: 'L'.repeat(300), body: 'Lang' };
        const { mutate, content } = await openSlide(
          blocksSlide([{ title: 'Rij', blocks: [block(1), long] }]),
        );

        await mutate((c) => {
          c.rows.unshift({ title: 'Nieuw', blocks: [block(7)] });
          c.rows[1].blocks[0].body = 'Bewerkt';
        });
        let rows = (await content()).rows;
        assert.deepEqual(rows[1].blocks, [
          { ...block(1), body: 'Bewerkt' },
          long,
        ]);

        await mutate((c) => {
          c.rows[1].blocks[0].body = 'Nog eens';
        });
        rows = (await content()).rows;
        assert.deepEqual(rows[1].blocks, [
          { ...block(1), body: 'Nog eens' },
          long,
        ]);
        assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
      });

      it('a new over-long block title in a moved row is still left out', async () => {
        const { mutate, content } = await openSlide(
          blocksSlide([{ title: 'Rij', blocks: [block(1), block(2)] }]),
        );

        await mutate((c) => {
          c.rows.unshift({ title: 'Nieuw', blocks: [block(7)] });
          c.rows[1].blocks[1].title = 'X'.repeat(300);
        });
        const blocks = (await content()).rows[1].blocks;
        assert.deepEqual(blocks[0], block(1));
        assert.equal('title' in blocks[1], false);
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      });

      it('a new row with seven blocks is held back like a stored row', async () => {
        const rows = [{ title: 'Rij', blocks: [block(1)] }];
        const { mutate, content } = await openSlide(blocksSlide(rows));

        await mutate((c) => {
          c.rows.push({
            title: 'Nieuw',
            blocks: [1, 2, 3, 4, 5, 6, 7].map(block),
          });
        });
        assert.deepEqual((await content()).rows, rows);
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      });

      it('a list over its count logs one line across several stores', async () => {
        const rows = [1, 2, 3, 4].map((n) => ({
          title: `Rij ${n}`,
          blocks: [block(n)],
        }));
        const { mutate, content } = await openSlide(blocksSlide(rows));

        await mutate((c) => {
          c.rows.push({ title: 'Rij 5', blocks: [block(5)] });
        });
        for (const t of ['a', 'ab', 'abc']) {
          await mutate((c) => {
            c.rows[0].title = t;
          });
        }

        assert.deepEqual((await content()).rows, rows);
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      });

      it('a nested list over its count logs one line across several stores', async () => {
        const five = [1, 2, 3, 4, 5].map(block);
        const { mutate, content } = await openSlide(
          blocksSlide([{ title: 'Rij', blocks: five }]),
        );

        await mutate((c) => {
          c.rows[0].blocks.push(block(6), block(7));
        });
        for (const t of ['a', 'ab', 'abc']) {
          await mutate((c) => {
            c.rows[0].blocks[0].body = t;
          });
        }

        assert.deepEqual((await content()).rows[0].blocks, five);
        assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      });
    });
  });

  it('never stores an unpopulated doc over a real deck', async () => {
    const before = await getPresentation(testScope(), deckId);
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: new Y.Doc(),
    });
    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.revision, before.revision);
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /no deck state/);
  });

  it('logs bootstrap warnings loudly when language versions had diverged', async () => {
    const diverged = await createPresentation(testScope(), {
      title: 'Divergent deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    const pres = await getPresentation(testScope(), diverged.id);
    pres.i18n = {
      dominant: 'nl',
      versions: {
        nl: { title: pres.title, slides: pres.slides },
        'en-GB': {
          title: 'Diverged deck',
          slides: [
            ...JSON.parse(JSON.stringify(pres.slides)),
            {
              id: 'ghost-slide',
              type: 'quote-slide',
              content: { quote: 'boo' },
              notes: '',
            },
          ],
        },
      },
    };
    await updatePresentation(testScope(), diverged.id, pres);

    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(diverged.id),
      document: doc,
    });
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /normalized diverged language versions/);
    assert.match(log.lines.warn[0], /ghost-slide/);
  });
});

describe('cold-binary invalidation on non-collab saves', () => {
  let deckId;
  const envBefore = {};

  before(async () => {
    for (const k of ['COLLAB_ENABLED', 'COLLAB_LIVE_EDITS'])
      envBefore[k] = process.env[k];
    process.env.COLLAB_ENABLED = 'true';
    process.env.COLLAB_LIVE_EDITS = 'true';
    const created = await createPresentation(testScope(), {
      title: 'Invalidate me',
      ownerEmail: 'owner@example.com',
    });
    deckId = created.id;
  });
  after(() => {
    for (const [k, v] of Object.entries(envBefore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('a REST/MCP-style save deletes the stored doc binary', async () => {
    const hooks = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: { log: makeLog() },
    });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    assert.ok(
      await getYDocState(testScope(), deckId),
      'binary exists after collab open',
    );

    const pres = await getPresentation(testScope(), deckId);
    await updatePresentation(testScope(), deckId, {
      ...pres,
      title: 'Edited via REST',
    });
    // The invalidation is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      await getYDocState(testScope(), deckId),
      null,
      'binary invalidated',
    );
  });

  it('invalidation also fires while the flag is off (no resurrection after re-enable)', async () => {
    // A binary written while COLLAB_LIVE_EDITS was on must not survive saves
    // made while it is off — re-enabling the flag would resurrect stale state.
    delete process.env.COLLAB_ENABLED;
    delete process.env.COLLAB_LIVE_EDITS;
    try {
      await setYDocState(testScope(), deckId, new Uint8Array([1, 2, 3]));
      const pres = await getPresentation(testScope(), deckId);
      await updatePresentation(testScope(), deckId, {
        ...pres,
        title: 'Saved while flag off',
      });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        await getYDocState(testScope(), deckId),
        null,
        'binary invalidated',
      );
    } finally {
      process.env.COLLAB_ENABLED = 'true';
      process.env.COLLAB_LIVE_EDITS = 'true';
    }
  });

  it('a collab-originated save keeps the binary', async () => {
    const hooks = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: { log: makeLog() },
    });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(
      await getYDocState(testScope(), deckId),
      'binary survives collab save',
    );
  });
});

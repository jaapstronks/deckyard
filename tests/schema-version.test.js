import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  migratePresentation,
  schemaVersionOf,
} from '../shared/slide-types/schema-version.js';
import {
  newPresentation,
  validatePresentation,
} from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

/** A minimal pre-versioning deck (no schemaVersion stamp). */
function legacyDeck() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'Legacy deck',
    description: '',
    created: now,
    modified: now,
    theme: 'default',
    lang: 'nl',
    settings: {},
    slides: [
      {
        id: randomUUID(),
        type: 'title-slide',
        parentId: null,
        content: { title: 'Hi' },
        visibility: {},
      },
    ],
  };
}

test('the migrations array has exactly one step per version bump', () => {
  // Bumping CURRENT_SCHEMA_VERSION without adding a migration should fail here.
  assert.equal(SCHEMA_MIGRATIONS.length, CURRENT_SCHEMA_VERSION);
});

test('newPresentation() stamps the current schema version', () => {
  const pres = newPresentation({});
  assert.equal(pres.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('schemaVersionOf treats missing/garbage stamps as version 0', () => {
  assert.equal(schemaVersionOf(null), 0);
  assert.equal(schemaVersionOf({}), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 'nope' }), 0);
  assert.equal(schemaVersionOf({ schemaVersion: -3 }), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 1 }), 1);
  assert.equal(schemaVersionOf({ schemaVersion: '1' }), 1);
});

test('migrating a legacy deck stamps it current without touching content', () => {
  const legacy = legacyDeck();
  const before = structuredClone(legacy);
  const migrated = migratePresentation(legacy);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  // Everything else is byte-identical to the original.
  const { schemaVersion, ...rest } = migrated;
  assert.deepEqual(rest, before);
});

test('migration is idempotent', () => {
  const once = migratePresentation(legacyDeck());
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('v1->v2 folds legacy text-blocks fields into rows[] non-destructively', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 1,
    title: 'TB',
    slides: [
      {
        id: randomUUID(),
        type: 'text-blocks-slide',
        content: {
          title: 'Flow',
          row1Count: '2',
          row1Block1Title: 'A',
          row1Block1Body: 'aa',
          row1Block2Title: 'B',
          row1Block2Body: 'bb',
        },
      },
    ],
  };
  const migrated = migratePresentation(deck);
  const c = migrated.slides[0].content;
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  // rows[] is now populated from the legacy numbered fields …
  assert.ok(Array.isArray(c.rows) && c.rows.length === 1, JSON.stringify(c.rows));
  assert.equal(c.rows[0].blocks.length, 2);
  assert.equal(c.rows[0].blocks[0].title, 'A');
  assert.equal(c.rows[0].blocks[1].body, 'bb');
  // … and the legacy keys are left in place (non-destructive fold).
  assert.equal(c.row1Block1Title, 'A');
});

test('v1->v2 leaves a text-blocks slide that already has rows[] untouched', () => {
  const rows = [{ title: 'R', arrow: 'none', blocks: [{ title: 'X', body: 'x' }] }];
  const deck = {
    id: randomUUID(),
    schemaVersion: 1,
    title: 'TB',
    slides: [{ id: randomUUID(), type: 'text-blocks-slide', content: { title: 'T', rows } }],
  };
  const migrated = migratePresentation(deck);
  assert.deepEqual(migrated.slides[0].content.rows, rows);
});

test('v3->v4 folds a canonical reverse-DNS type down to the registry key', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 3,
    title: 'Canon',
    slides: [
      { id: randomUUID(), type: 'eu.deckyard.slide.title', content: { title: 'Hi' } },
      { id: randomUUID(), type: 'core/title-slide', content: { title: 'Bye' } },
    ],
  };
  const migrated = migratePresentation(deck);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.slides[0].type, 'title-slide');
  assert.equal(migrated.slides[1].type, 'title-slide');
});

test('v3->v4 leaves a bare key untouched and never drops an unknown type', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 3,
    title: 'Mixed',
    slides: [
      { id: randomUUID(), type: 'title-slide', content: { title: 'Known' } },
      { id: randomUUID(), type: 'acme/hero', content: { title: 'Foreign' } },
    ],
  };
  const migrated = migratePresentation(deck);
  // A bare key resolves to itself; a type naming no registered type is kept verbatim.
  assert.equal(migrated.slides[0].type, 'title-slide');
  assert.equal(migrated.slides[1].type, 'acme/hero');
});

test('v3->v4 is idempotent — a second run rewrites nothing', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 3,
    title: 'Canon',
    slides: [{ id: randomUUID(), type: 'eu.deckyard.slide.title', content: { title: 'Hi' } }],
  };
  const once = migratePresentation(deck);
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

/** A v4 deck whose quote slide still stores its centring the legacy way. */
function legacyQuoteDeck(quoteStyle, extraContent = {}) {
  return {
    id: randomUUID(),
    schemaVersion: 4,
    title: 'Quote',
    slides: [
      {
        id: randomUUID(),
        type: 'quote-slide',
        content: {
          quote: 'Q',
          authorName: 'N',
          ...extraContent,
          textStyles: { quote: { ...quoteStyle } },
        },
      },
    ],
  };
}

test('v4->v5 folds the legacy quote align into quoteAlign and drops the old key', () => {
  const migrated = migratePresentation(legacyQuoteDeck({ align: 'center' }));
  const content = migrated.slides[0].content;
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(content.quoteAlign, 'center');
  // Normalize-and-remove: the second stored form is gone, not merely ignored.
  assert.equal(content.textStyles, undefined);
});

test('v4->v5 renders a folded deck exactly as the legacy read fallback did', () => {
  const migrated = migratePresentation(legacyQuoteDeck({ align: 'center' }));
  const html = SLIDE_TYPES['quote-slide'].renderHtml(
    migrated.slides[0].content,
    { id: 's' },
    {}
  );
  assert.match(html, /is-align-center/);
});

test('v4->v5 keeps the group value when both forms are stored', () => {
  const migrated = migratePresentation(
    legacyQuoteDeck({ align: 'center' }, { quoteAlign: 'left' })
  );
  const content = migrated.slides[0].content;
  assert.equal(content.quoteAlign, 'left');
  assert.equal(content.textStyles, undefined);
});

test('v4->v5 keeps per-field colour/size on the same field', () => {
  const migrated = migratePresentation(legacyQuoteDeck({ align: 'center', color: 'accent' }));
  const content = migrated.slides[0].content;
  assert.equal(content.quoteAlign, 'center');
  assert.deepEqual(content.textStyles, { quote: { color: 'accent' } });
});

test('v4->v5 drops an align the group never offered without inventing a value', () => {
  // `right` is not on the quote-block group's offer, so it already resolved to
  // the default on render; folding it would store a value nothing honours.
  const migrated = migratePresentation(legacyQuoteDeck({ align: 'right' }));
  const content = migrated.slides[0].content;
  assert.equal(content.quoteAlign, undefined);
  assert.equal(content.textStyles, undefined);
});

test('v5->v6 folds inert per-field align on every group member, across types', () => {
  // The two keys the v4 -> v5 quote fold deliberately left behind: a title-slide
  // header member (`title`) and a quote member that is not the designated field
  // (`authorName`). Both are inert since the group model; v5 -> v6 is where they
  // finally go. Start at v4 so the whole chain runs.
  const deck = {
    id: randomUUID(),
    schemaVersion: 4,
    title: 'Mixed',
    slides: [
      {
        id: randomUUID(),
        type: 'title-slide',
        content: { title: 'T', textStyles: { title: { align: 'center' } } },
      },
      {
        id: randomUUID(),
        type: 'quote-slide',
        content: { quote: 'Q', textStyles: { authorName: { align: 'center' } } },
      },
    ],
  };
  const once = migratePresentation(deck);
  // Both inert member-align keys are gone, and the now-empty textStyles with them.
  assert.equal(once.slides[0].content.textStyles, undefined);
  assert.equal(once.slides[1].content.textStyles, undefined);
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('v5->v6 drops only align, keeping per-field colour/size on the same member', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 5,
    title: 'Styled',
    slides: [
      {
        id: randomUUID(),
        type: 'title-slide',
        content: { title: 'T', textStyles: { title: { align: 'center', color: 'muted', size: 'lg' } } },
      },
    ],
  };
  const migrated = migratePresentation(deck);
  assert.deepEqual(migrated.slides[0].content.textStyles, { title: { color: 'muted', size: 'lg' } });
});

test('v5->v6 leaves a non-group field and unknown types untouched, and is idempotent', () => {
  const deck = {
    id: randomUUID(),
    schemaVersion: 5,
    title: 'Untouched',
    slides: [
      {
        // `body` is not a group member on a text-blocks slide, so its per-field
        // align is a live text-align and must survive.
        id: randomUUID(),
        type: 'text-blocks-slide',
        content: { rows: [{ blocks: [] }], textStyles: { body: { align: 'center' } } },
      },
      {
        // A foreign/unknown type has no registry def; the sweep must skip it.
        id: randomUUID(),
        type: 'com.example.custom',
        content: { textStyles: { whatever: { align: 'center' } } },
      },
    ],
  };
  const once = migratePresentation(deck);
  assert.deepEqual(once.slides[0].content.textStyles, { body: { align: 'center' } });
  assert.deepEqual(once.slides[1].content.textStyles, { whatever: { align: 'center' } });
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('gate: the v5->v6 sweep clears inert align for every declared group member in the registry', () => {
  // Built from the registry, not a hardcoded list: one slide per adopting type,
  // seeding a per-field align on every one of that type's group members. A type
  // that adopts a group later is swept by the same migration code AND proven
  // swept here, without editing this test — that is the gate that keeps new
  // inert keys out.
  const slides = [];
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const groupIds = new Set(
      (Array.isArray(def.fieldGroups) ? def.fieldGroups : [])
        .map((g) => (g && typeof g.id === 'string' ? g.id : ''))
        .filter(Boolean)
    );
    if (!groupIds.size) continue;
    const members = (Array.isArray(def.fields) ? def.fields : []).filter(
      (f) => typeof f?.group === 'string' && groupIds.has(f.group.trim())
    );
    if (!members.length) continue;
    const textStyles = {};
    for (const m of members) textStyles[m.key] = { align: 'center' };
    slides.push({ id: randomUUID(), type, content: { textStyles } });
  }
  assert.ok(slides.length >= 5, 'the registry still has adopting types to sweep');

  const migrated = migratePresentation({
    id: randomUUID(),
    schemaVersion: 5,
    title: 'Gate',
    slides,
  });

  for (const slide of migrated.slides) {
    const styles = slide.content.textStyles || {};
    for (const [key, fieldStyle] of Object.entries(styles)) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(fieldStyle || {}, 'align'),
        `${slide.type}.${key} still carries an inert align after migration`
      );
    }
  }
});

test('the renderer no longer reads the legacy quote align at all', () => {
  // The reverse of the fold: an un-migrated raw value must be inert, so the
  // dual reading form cannot quietly come back.
  const html = SLIDE_TYPES['quote-slide'].renderHtml(
    { quote: 'Q', authorName: 'N', textStyles: { quote: { align: 'center' } } },
    { id: 's' },
    {}
  );
  assert.doesNotMatch(html, /is-align-center/);
});

test('a deck from a newer build is never downgraded', () => {
  const future = { id: randomUUID(), schemaVersion: 99, title: 'Future' };
  const out = migratePresentation(future);
  assert.equal(out.schemaVersion, 99);
});

test('non-object input passes through untouched', () => {
  assert.equal(migratePresentation(null), null);
  assert.equal(migratePresentation(undefined), undefined);
});

test('the read funnel migrates a stored legacy deck in memory', async () => {
  // The single durable read funnel is the presentations facade: a deck stored
  // WITHOUT a schemaVersion stamp (legacy row) comes back migrated.
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  process.env.DEFAULT_ORGANIZATION_ID = ORG;
  const { createFakeDb } = await import('./helpers/fake-db.js');
  const { __setTestDb } = await import('../server/db/client.js');
  const { initializeStorage, __resetStorageForTests } = await import(
    '../server/storage/lifecycle.js'
  );
  const legacy = legacyDeck();
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      presentations: [
        {
          id: legacy.id,
          organization_id: ORG,
          owner_email: 'owner@example.com',
          title: legacy.title,
          theme: legacy.theme,
          lang: legacy.lang,
          created: legacy.created,
          modified: legacy.modified,
          revision: 1,
          deleted_at: null,
          slides: legacy.slides,
          settings: legacy.settings,
          i18n: null,
          published: null,
        },
      ],
    })
  );
  await initializeStorage();
  try {
    const { getPresentation } = await import(
      '../server/storage/presentations/index.js'
    );
    const storageScope = { repoRoot: null, organizationId: ORG };
    const read = await getPresentation(storageScope, legacy.id);
    assert.equal(read.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(read.id, legacy.id);
    assert.equal(read.slides[0].content.title, 'Hi');

    const missing = await getPresentation(storageScope, randomUUID());
    assert.equal(missing, null);
  } finally {
    __resetStorageForTests();
    __setTestDb(null);
  }
});

test('validatePresentation accepts a freshly stamped deck', () => {
  const { ok, errors } = validatePresentation(newPresentation({ theme: 'amethyst' }));
  assert.equal(ok, true, `unexpected errors: ${errors.join(', ')}`);
});

test('validatePresentation rejects an out-of-range schemaVersion', () => {
  const base = newPresentation({});

  const negative = validatePresentation({ ...base, schemaVersion: -1 });
  assert.equal(negative.ok, false);
  assert.ok(negative.errors.some((e) => /schemaVersion/.test(e)));

  const fractional = validatePresentation({ ...base, schemaVersion: 1.5 });
  assert.equal(fractional.ok, false);
  assert.ok(fractional.errors.some((e) => /non-negative integer/.test(e)));

  const future = validatePresentation({ ...base, schemaVersion: 99 });
  assert.equal(future.ok, false);
  assert.ok(future.errors.some((e) => /newer than this build/.test(e)));
});

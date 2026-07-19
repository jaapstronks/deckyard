import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSlideType,
  toPortableDefinition,
  parseImportedSlideType,
  slugifyLabel,
  deriveUniqueSlug,
  SLIDE_TYPE_ENVELOPE,
} from '../client/views/settings/slide-type-editor/io.js';

const FULL = {
  id: 'uuid-123',
  slug: 'my-type',
  label: 'My Type',
  baseType: 'content-slide',
  fields: [{ key: 'title', type: 'string', label: 'Title' }],
  defaults: { title: 'Hi' },
  defaultsByLang: { en: { title: 'Hi' } },
  template: '<h1>{{esc title}}</h1>',
  css: '.x{}',
  isPublished: true,
  sortOrder: 3,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  createdBy: 'someone',
};

test('toPortableDefinition strips identity, audit, and publish state', () => {
  const def = toPortableDefinition(FULL);
  assert.deepEqual(Object.keys(def).sort(), [
    'baseType', 'css', 'defaults', 'defaultsByLang', 'fields', 'label', 'template',
  ]);
  assert.equal(def.id, undefined);
  assert.equal(def.slug, undefined);
  assert.equal(def.isPublished, undefined);
  assert.equal(def.sortOrder, undefined);
  assert.equal(def.createdBy, undefined);
});

test('serialize → parse round-trips the portable definition', () => {
  const text = serializeSlideType(FULL);
  const obj = JSON.parse(text);
  assert.equal(obj[SLIDE_TYPE_ENVELOPE], 1);
  const parsed = parseImportedSlideType(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.definition, toPortableDefinition(FULL));
});

test('parse accepts a bare definition object (no envelope)', () => {
  const bare = JSON.stringify({ label: 'Bare', fields: [{ key: 'a', type: 'string', label: 'A' }] });
  const parsed = parseImportedSlideType(bare);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.definition.label, 'Bare');
});

test('parse rejects invalid JSON', () => {
  assert.deepEqual(parseImportedSlideType('{not json'), { ok: false, reason: 'invalid_json' });
});

test('parse rejects a definition with no label', () => {
  const text = JSON.stringify({ definition: { fields: [{ key: 'a', type: 'string', label: 'A' }] } });
  assert.equal(parseImportedSlideType(text).reason, 'missing_label');
});

test('parse rejects a definition with no fields', () => {
  const text = JSON.stringify({ definition: { label: 'X', fields: [] } });
  assert.equal(parseImportedSlideType(text).reason, 'missing_fields');
});

test('slugifyLabel matches the editor/server slug rules', () => {
  assert.equal(slugifyLabel('My Cool Type!'), 'my-cool-type');
  assert.equal(slugifyLabel('  spaced  out  '), 'spaced-out');
  assert.equal(slugifyLabel(''), '');
});

test('deriveUniqueSlug returns the base slug when free', () => {
  assert.equal(deriveUniqueSlug('My Type', ['other']), 'my-type');
});

test('deriveUniqueSlug appends a counter on collision', () => {
  assert.equal(deriveUniqueSlug('My Type', ['my-type']), 'my-type-2');
  assert.equal(deriveUniqueSlug('My Type', ['my-type', 'my-type-2']), 'my-type-3');
});

test('deriveUniqueSlug falls back for an empty label', () => {
  assert.equal(deriveUniqueSlug('', []), 'custom-type');
  assert.equal(deriveUniqueSlug('', ['custom-type']), 'custom-type-2');
});

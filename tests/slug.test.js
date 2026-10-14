import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { generateSlug, isValidSlug, MAX_SLUG_LEN } from '../shared/slug.js';

test('derived slugs use one spelling for accents, separators and empty labels', () => {
  assert.equal(generateSlug('  Café / Crème!  '), 'cafe-creme');
  assert.equal(generateSlug(''), '');
  assert.equal(
    generateSlug('???', { fallback: 'presentation' }),
    'presentation',
  );
  for (const maxLength of [32, 63, MAX_SLUG_LEN]) {
    const slug = generateSlug(`${'a'.repeat(maxLength - 1)} / next`, {
      maxLength,
    });
    assert.equal(slug, 'a'.repeat(maxLength - 1));
    assert.ok(isValidSlug(slug, { maxLength }));
  }
});

test('explicit slugs are refused instead of repaired, with caller length bounds', () => {
  for (const slug of [
    null,
    undefined,
    123,
    '',
    'UPPER',
    ' two ',
    'two words',
    'café',
    '-a',
    'a-',
    'a/b',
    'a'.repeat(81),
  ]) {
    assert.equal(isValidSlug(slug), false, JSON.stringify(slug));
  }
  for (const slug of ['a', '123', 'a--b', 'a'.repeat(80)]) {
    assert.ok(isValidSlug(slug), slug);
  }
  assert.equal(isValidSlug('a', { minLength: 2, maxLength: 63 }), false);
  assert.ok(isValidSlug('a'.repeat(63), { minLength: 2, maxLength: 63 }));
  assert.equal(
    isValidSlug('a'.repeat(64), { minLength: 2, maxLength: 63 }),
    false,
  );
});

async function jsFiles(dir) {
  const entries = await readdir(new URL(`../${dir}/`, import.meta.url), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? jsFiles(`${dir}/${entry.name}`)
        : entry.name.endsWith('.js')
          ? [`${dir}/${entry.name}`]
          : [],
    ),
  );
  return files.flat();
}

test('slug consumers carry no private derivation or validation implementation', async () => {
  const roots = [
    'server/storage',
    'server/utils',
    'server/export',
    'client/views/settings',
    'shared',
  ];
  const files = (await Promise.all(roots.map(jsFiles))).flat();
  const violations = [];
  for (const file of files) {
    if (file === 'shared/slug.js') continue;
    const source = await readFile(
      new URL(`../${file}`, import.meta.url),
      'utf8',
    );
    if (
      /replace\(\/\[\^a-z0-9/.test(source) ||
      /const\s+MAX_SLUG_LEN\s*=/.test(source) ||
      /(?:function|const)\s+(?:generateSlug|isValidSlug|safeSlug|slugifyLabel|slugifyVariantId)\b/.test(
        source,
      )
    ) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('theme runtime has no file loader, static route, or client theme catalogue', async () => {
  const [runtime, paths, client, registry, policy] = await Promise.all([
    read('server/utils/themes.js'),
    read('server/config/paths.js'),
    read('client/lib/theme/theme.js'),
    read('shared/slide-types/registry.js'),
    read('shared/slide-types/policy.js'),
  ]);

  assert.doesNotMatch(runtime, /(?:readFile|readdir|customDirFor|themesDir)/);
  assert.doesNotMatch(paths, /urlPrefix:\s*['"]\/(?:custom\/)?themes\//);
  assert.doesNotMatch(
    client,
    /(?:fetch|api)\s*\(\s*[`'"]\/(?:custom\/)?themes\//,
  );
  assert.doesNotMatch(client, /\bTHEMES\b/);
  assert.doesNotMatch(registry, /\bTHEMES\b|\bthemeId\b/);
  assert.match(policy, /themeOnly/);
});

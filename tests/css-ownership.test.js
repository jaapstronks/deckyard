import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssOwnershipDebt } from './helpers/css-ownership.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function readTree(dir, suffix) {
  return Object.fromEntries(
    fs
      .readdirSync(path.join(root, dir), { recursive: true })
      .filter((file) => file.endsWith(suffix))
      .sort()
      .map((file) => [
        `${dir}/${file}`,
        fs.readFileSync(path.join(root, dir, file), 'utf8'),
      ]),
  );
}

test('app CSS has a JS user in its owner, with an exact shrinking debt list', () => {
  const styles = Object.fromEntries(
    Object.entries(readTree('client/styles/app', '.css'))
      .map(([file, source]) => [
        file.slice('client/styles/app/'.length),
        source,
      ])
      .filter(([file]) => file.includes('/')),
  );
  const sources = {
    ...readTree('client/views', '.js'),
    ...readTree('client/lib/dom', '.js'),
  };
  const allowed = JSON.parse(
    fs.readFileSync(
      path.join(root, 'tests/fixtures/css-ownership-debt.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    cssOwnershipDebt(styles, sources),
    allowed,
    'Move new CSS to its JS owner; remove stale file/class entries when debt shrinks. Do not extend the baseline.',
  );
});

test('ownership is local, covers nested rules and ignores prose and imports', () => {
  const styles = {
    'editor/a.css': `/* .comment */ @media (width > 10px) {
      .owned:is(.other, [data-note='.attribute']), .comment-only, .import-only { content: '.not-a-selector'; & .nested-missing {} }
    }`,
    'components/modal.css': '.modal {} .editor-only {}',
    'shell/banner.css': '.banner {}',
    'editor/escaped.css': '.escaped\\:name {}',
    'new-feature/new.css': '.unowned {}',
  };
  const sources = {
    'client/views/editor/a.js': `
      import x from './import-only.js';
      // 'comment-only'
      const classes = 'owned editor-only';
      const escaped = 'escaped:name';
    `,
    'client/views/list/a.js': `const className = 'other';`,
    'client/lib/dom/modal.js': `const classes = 'modal banner';`,
  };
  assert.deepEqual(cssOwnershipDebt(styles, sources), {
    'editor/a.css': ['comment-only', 'import-only', 'nested-missing', 'other'],
    'components/modal.css': ['editor-only'],
    'new-feature/new.css': ['unowned'],
  });
});

test('dynamic classes require both a local prefix and an actual local value', () => {
  assert.deepEqual(
    cssOwnershipDebt(
      {
        'editor/a.css': '.status-live {} .status-invented {} .static {}',
      },
      {
        'client/views/editor/a.js':
          "const state = 'live'; const c = `static status-${state}`;",
        'client/views/list/a.js': "const state = 'invented';",
      },
    ),
    { 'editor/a.css': ['status-invented'] },
  );
});

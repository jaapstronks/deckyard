/**
 * Optional packages must stay lazy and guarded; static imports make them hard
 * dependencies regardless of whether the feature is enabled.
 * Run with: node --test tests/optional-dependencies-gate.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { walkJsFiles } from './helpers/call-sites.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(
  fs.readFileSync(new URL('package.json', root), 'utf8'),
);
const optional = new Set(Object.keys(manifest.optionalDependencies));
const packageName = (specifier) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

// Only direct await and awaited Promise.all propagate the rejection to a catch.
// Stop at functions: their bodies execute outside an enclosing try statement.
function caughtAwait(node, ancestors) {
  let awaited = ancestors.at(-1);
  let awaitIndex = ancestors.length - 1;
  if (awaited?.type === 'ArrayExpression') {
    const call = ancestors.at(-2);
    if (
      call?.type !== 'CallExpression' ||
      call.callee.type !== 'MemberExpression' ||
      call.callee.computed ||
      call.callee.object.name !== 'Promise' ||
      call.callee.property.name !== 'all' ||
      call.arguments.length !== 1 ||
      call.arguments[0] !== awaited
    )
      return false;
    node = call;
    awaitIndex -= 2;
    awaited = ancestors[awaitIndex];
  }
  if (awaited?.type !== 'AwaitExpression' || awaited.argument !== node)
    return false;
  for (let index = awaitIndex - 1; index >= 0; index -= 1) {
    const parent = ancestors[index];
    if (parent.type.includes('Function')) return false;
    if (
      parent.type === 'TryStatement' &&
      parent.handler &&
      ancestors[index + 1] === parent.block
    )
      return true;
  }
  return false;
}

// The doctor injects a lazy loader and awaits it in its own catch boundary.
function caughtCall(node, name, ancestors = []) {
  if (!node || typeof node !== 'object') return false;
  if (node.type?.includes('Function')) return false;
  if (
    node.type === 'CallExpression' &&
    node.callee.name === name &&
    caughtAwait(node, ancestors)
  )
    return true;
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((child) => caughtCall(child, name, [...ancestors, node]))
      : value &&
        typeof value === 'object' &&
        caughtCall(value, name, [...ancestors, node]),
  );
}

function inspect(source, packages) {
  const imports = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  function visit(node, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(node.type) &&
      typeof node.source?.value === 'string'
    ) {
      const name = packageName(node.source.value);
      if (packages.has(name)) {
        // A catch handles absence; an earlier return/throw in the same function
        // is the feature-off gate (including imports grouped in Promise.all).
        const guarded =
          caughtAwait(node, ancestors) ||
          ancestors.some(
            (parent, index) =>
              parent.type === 'BlockStatement' &&
              ancestors[index - 1]?.type?.includes('Function') &&
              parent.body.some(
                (statement) =>
                  statement.end <= node.start &&
                  statement.type === 'IfStatement' &&
                  statement.test.type === 'UnaryExpression' &&
                  statement.test.operator === '!' &&
                  /(?:Enabled|Configured)$/.test(
                    statement.test.argument.callee?.name ?? '',
                  ) &&
                  ['ReturnStatement', 'ThrowStatement'].includes(
                    statement.consequent.type,
                  ),
              ),
          );
        const injected = ancestors.findLast(
          (parent) =>
            parent.type === 'AssignmentPattern' &&
            parent.left.type === 'Identifier',
        );
        const outerFunction = ancestors.findLast(
          (parent) =>
            parent.type?.includes('Function') &&
            parent.params?.some(
              (param) =>
                param.start <= (injected?.start ?? -1) &&
                param.end >= (injected?.end ?? -1),
            ),
        );
        imports.push({
          name,
          lazy: node.type === 'ImportExpression',
          guarded: Boolean(
            guarded ||
            (injected &&
              outerFunction &&
              caughtCall(outerFunction.body, injected.left.name)),
          ),
        });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value))
        value.forEach((child) => visit(child, [...ancestors, node]));
      else if (value && typeof value === 'object')
        visit(value, [...ancestors, node]);
    }
  }
  visit(ast);
  return imports;
}

test('the detector distinguishes hard, unguarded and gated imports, including subpaths', () => {
  const packages = new Set(['optional', '@scope/optional']);
  assert.deepEqual(
    inspect(
      "import x from 'optional'; export { x } from '@scope/optional/sub';",
      packages,
    ).map(({ lazy }) => lazy),
    [false, false],
  );
  assert.equal(
    inspect("await import('optional');", packages)[0].guarded,
    false,
  );
  assert.equal(
    inspect(
      "async function f() { if (cached) return cached; return import('optional'); }",
      packages,
    )[0].guarded,
    false,
  );
  assert.equal(
    inspect(
      "async function f() { try { return await import('optional'); } catch { throw new Error('missing'); } }",
      packages,
    )[0].guarded,
    true,
  );
  assert.equal(
    inspect(
      "async function f() { if (!isFeatureEnabled()) return null; return Promise.all([import('@scope/optional/sub')]); }",
      packages,
    )[0].guarded,
    true,
  );
  assert.equal(
    inspect("try {} catch { await import('optional'); }", packages)[0].guarded,
    false,
  );
  assert.deepEqual(
    inspect(
      "// import x from 'optional'\nconst s = \"import('optional')\";",
      packages,
    ),
    [],
  );
});

const catchCases = [
  ['direct await', "try { await import('optional'); } catch {}", true],
  ['awaited return', "try { return await import('optional'); } catch {}", true],
  ['unawaited return', "try { return import('optional'); } catch {}", false],
  ['unawaited expression', "try { import('optional'); } catch {}", false],
  [
    'deferred arrow',
    "try { return () => import('optional'); } catch {}",
    false,
  ],
  [
    'deferred async arrow',
    "try { return async () => await import('optional'); } catch {}",
    false,
  ],
  [
    'nested function',
    "try { async function later() { await import('optional'); } return later; } catch {}",
    false,
  ],
  [
    'callback in awaited call',
    "try { await later(async () => await import('optional')); } catch {}",
    false,
  ],
  [
    'awaited Promise.all',
    "try { await Promise.all([import('optional')]); } catch {}",
    true,
  ],
  [
    'unawaited Promise.all',
    "try { return Promise.all([import('optional')]); } catch {}",
    false,
  ],
  [
    'deferred Promise.all element',
    "try { await Promise.all([() => import('optional')]); } catch {}",
    false,
  ],
  [
    'unawaited wrapper argument',
    "try { await wrap(import('optional')); } catch {}",
    false,
  ],
  [
    'local catch in nested function',
    "return async () => { try { await import('optional'); } catch {} };",
    true,
  ],
  [
    'catch outside inner finally',
    "try { try {} finally { await import('optional'); } } catch {}",
    true,
  ],
  [
    'same try finally',
    "try {} catch {} finally { await import('optional'); }",
    false,
  ],
];
for (const [label, body, guarded] of catchCases) {
  test(`catch detection: ${label}`, () => {
    assert.equal(
      inspect(`async function run() { ${body} }`, new Set(['optional']))[0]
        .guarded,
      guarded,
    );
  });
}

const thunkCases = [
  ['awaited invocation', 'try { await load(); } catch {}', true],
  [
    'awaited Promise.all invocation',
    'try { await Promise.all([load()]); } catch {}',
    true,
  ],
  ['unawaited invocation', 'try { load(); } catch {}', false],
  ['unawaited return', 'try { return load(); } catch {}', false],
  [
    'unawaited Promise.all',
    'try { return Promise.all([load()]); } catch {}',
    false,
  ],
  [
    'deferred invocation',
    'try { return async () => await load(); } catch {}',
    false,
  ],
  [
    'catch in deferred function',
    'return async () => { try { await load(); } catch {} };',
    false,
  ],
  ['invocation in catch', 'try {} catch { await load(); }', false],
];
for (const [label, body, guarded] of thunkCases) {
  test(`injected thunk catch detection: ${label}`, () => {
    assert.equal(
      inspect(
        `async function run({ load = () => import('optional') }) { ${body} }`,
        new Set(['optional']),
      )[0].guarded,
      guarded,
    );
  });
}

test('every declared optional dependency is used only through guarded dynamic imports', () => {
  const imports = [];
  for (const dir of ['server', 'shared', 'client', 'scripts']) {
    for (const file of walkJsFiles(new URL(`${dir}/`, root).pathname)) {
      if (file.includes('/vendor/')) continue;
      imports.push(
        ...inspect(fs.readFileSync(file, 'utf8'), optional).map((entry) => ({
          ...entry,
          file: path.relative(root.pathname, file),
        })),
      );
    }
  }
  assert.ok(optional.size > 0);
  assert.deepEqual(
    imports.filter(({ lazy, guarded }) => !lazy || !guarded),
    [],
  );
  assert.deepEqual(
    [...new Set(imports.map(({ name }) => name))].sort(),
    [...optional].sort(),
    'a removed optional import requires removing its declaration',
  );
  for (const name of optional)
    assert.equal(
      Object.hasOwn(manifest.dependencies, name),
      false,
      `${name} cannot also be hard`,
    );
});

test('injected import thunks must be invoked behind a catch boundary', () => {
  const packages = new Set(['optional']);
  assert.equal(
    inspect(
      "async function run({ load = () => import('optional') }) { try { await load(); } catch { return 'missing'; } }",
      packages,
    )[0].guarded,
    true,
  );
  assert.equal(
    inspect(
      "async function run({ load = () => import('optional') }) { await load(); }",
      packages,
    )[0].guarded,
    false,
  );
});

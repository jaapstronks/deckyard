/**
 * The body of an `api()` call is a value, not a string (B345, D177).
 *
 * The client knew two forms for one concept: a caller handed `api()` the body
 * as an object (~36 sites) or stringified it itself (`body: JSON.stringify(…)`,
 * 123 sites in 61 files, plus four `body: '{}'` string literals the grep for
 * `JSON.stringify` never saw). Canonical is the **object**: `api()` owns the
 * serialisation and the JSON `Content-Type`; the caller only describes *what*
 * it sends. D177 rejected making the default depend on who serialised — that
 * would fix the second form into the network layer.
 *
 * Two halves here: the behaviour of the refusal, and a static guard that keeps
 * the pre-stringified form from growing back. They are not redundant. The
 * static half reads the literal shape and one level of indirection
 * (`const payload = JSON.stringify(pres)` two lines above `body: payload` —
 * the form the editor's whole save path used, and the one a mechanical sweep
 * for `body: JSON.stringify(` walks straight past). The runtime half is the
 * backstop for a string built any other way: the refusal is the point, not a
 * nicety, because a sweep that converts every call site but keeps swallowing
 * strings leaves the second form standing.
 *
 * The one exception is a body that is not JSON. The `.deckyard` import sends a
 * `File` and sets its own `Content-Type` (`DECK_MIMETYPE`), which wins the
 * header merge from #1183. That is pinned below — a sweep that quietly broke it
 * would only show up on the network.
 *
 * Run with: node --test tests/api-body-object-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

import { api, assertBodyShape } from '../client/lib/api.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// ---------------------------------------------------------------- behaviour

/** Capture the one `fetch` call `api()` makes, and answer it with JSON. */
function withStubbedFetch(run, { status = 200, json = { ok: true } } = {}) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Promise.resolve(run(seen)).finally(() => {
    globalThis.fetch = original;
  });
}

test('an object body is serialised by api(), with the JSON Content-Type', async () => {
  await withStubbedFetch(async (seen) => {
    await api('/api/things', { method: 'POST', body: { a: 1, b: [2, 3] } });
    const { init } = seen[0];
    assert.equal(init.body, '{"a":1,"b":[2,3]}');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
  });
});

test('a pre-stringified body is refused, not quietly passed through', async () => {
  await withStubbedFetch(async (seen) => {
    await assert.rejects(
      () => api('/api/things', { method: 'POST', body: '{"a":1}' }),
      /body must be the value to send/,
      'a string body without its own Content-Type is a caller bug',
    );
    assert.equal(seen.length, 0, 'the request is never sent');
  });
});

test('the empty-object string — the form four presenter call sites used — is refused too', () => {
  assert.throws(() => assertBodyShape('{}'), /body must be the value to send/);
});

test('a string body is refused even when the caller names the JSON Content-Type — the old form (D202)', async () => {
  await withStubbedFetch(async (seen) => {
    await assert.rejects(
      () =>
        api('/api/things', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"a":1}',
        }),
      /body must be the value to send/,
      'a header name is not a licence to stringify',
    );
    assert.equal(seen.length, 0, 'the request is never sent');
  });
});

test('a string body has no typed escape: a non-JSON body is a Blob with its type', () => {
  assert.throws(() => assertBodyShape('a,b\n1,2'));
  assert.doesNotThrow(() =>
    assertBodyShape(new Blob(['a,b\n1,2'], { type: 'text/csv' })),
  );
});

test('a non-string body is never refused: the .deckyard import sends a File', async () => {
  await withStubbedFetch(async (seen) => {
    const file = new Blob(['PK'], {
      type: 'application/vnd.deckyard.deck+zip',
    });
    await api('/api/presentations/import/deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.deckyard.deck+zip' },
      body: file,
    });
    const { init } = seen[0];
    assert.equal(init.body, file, 'the Blob is passed through untouched');
    assert.equal(
      init.headers.get('Content-Type'),
      'application/vnd.deckyard.deck+zip',
      "the caller's own Content-Type wins the merge (#1183)",
    );
  });
});

test('FormData passes through untouched as well', async () => {
  await withStubbedFetch(async (seen) => {
    const form = new FormData();
    form.append('a', '1');
    await api('/api/things', { method: 'POST', body: form });
    assert.equal(seen[0].init.body, form);
  });
});

// -------------------------------------------------------------------- guard

/** Every `.js` file under `client/`, minus the vendored bundles. */
function clientSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'vendor') continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'client'));
  return out;
}

function walkAst(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit);
    } else {
      walkAst(value, visit);
    }
  }
}

/** Is this node a `JSON.stringify(…)` call? */
function isJsonStringify(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'JSON' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'stringify'
  );
}

/**
 * Local names in `file` that hold the result of a `JSON.stringify(…)` — the
 * indirection a `body: <name>` can hide behind. Flat per file, not per scope:
 * a drift stop, not a proof.
 *
 * @param {string} file
 * @returns {Map<string, string>} name -> `<relative path>:<line>`
 */
function stringifiedLocals(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const found = new Map();
  walkAst(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.id.type !== 'Identifier' || !node.init) return;
    if (!isJsonStringify(node.init)) return;
    found.set(
      node.id.name,
      `${path.relative(REPO_ROOT, file)}:${src.slice(0, node.start).split('\n').length}`,
    );
  });
  return found;
}

/**
 * Every `body:` and `headers:` property of an options object handed to a call
 * of `api` (or `apiFn`, the one local alias, in
 * `slide-runtime/slide-render.js`). Raw `fetch(` is out of scope: those sites
 * are lint-gated exceptions that build their own request, SSE streams among
 * them.
 *
 * @param {string} file
 * @returns {{ name: string, value: object, where: string }[]}
 */
function apiCallBodies(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const found = [];
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type !== 'Identifier') return;
    if (node.callee.name !== 'api' && node.callee.name !== 'apiFn') return;
    const opts = node.arguments[1];
    if (!opts || opts.type !== 'ObjectExpression') return;
    for (const prop of opts.properties) {
      if (prop.type !== 'Property' || prop.computed) continue;
      const name =
        prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
      if (name !== 'body' && name !== 'headers') continue;
      found.push({
        name,
        value: prop.value,
        where: `${path.relative(REPO_ROOT, file)}:${
          src.slice(0, prop.start).split('\n').length
        }`,
      });
    }
  });
  return found;
}

test('no api() caller stringifies its own body', () => {
  const offenders = [];
  for (const file of clientSources()) {
    const stringified = stringifiedLocals(file);
    for (const { name, value, where } of apiCallBodies(file)) {
      if (name !== 'body') continue;
      if (isJsonStringify(value))
        offenders.push(`${where}: body: JSON.stringify(…)`);
      if (value.type === 'Literal' && typeof value.value === 'string') {
        offenders.push(`${where}: body: ${JSON.stringify(value.value)}`);
      }
      if (value.type === 'TemplateLiteral') {
        offenders.push(`${where}: body: \`…\` (template literal)`);
      }
      // One level of indirection: `const payload = JSON.stringify(pres)` two
      // lines up, then `body: payload`. That is the shape the mechanical
      // sweep for `body: JSON.stringify(` missed in `save-manager.js`, and
      // the one the editor's whole save path used. Shallow on purpose — a
      // string built any other way is caught at runtime by `assertBodyShape`.
      if (value.type === 'Identifier' && stringified.has(value.name)) {
        offenders.push(
          `${where}: body: ${value.name} (assigned JSON.stringify(…) at ${stringified.get(value.name)})`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `api() owns the serialisation (D177) — pass the object:\n  ${offenders.join('\n  ')}`,
  );
});

test('no api() caller sets the JSON Content-Type itself', () => {
  const offenders = [];
  for (const file of clientSources()) {
    for (const { name, value, where } of apiCallBodies(file)) {
      if (name !== 'headers' || value.type !== 'ObjectExpression') continue;
      for (const prop of value.properties) {
        if (prop.type !== 'Property' || prop.computed) continue;
        const key =
          prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
        if (String(key).toLowerCase() !== 'content-type') continue;
        if (
          prop.value.type === 'Literal' &&
          String(prop.value.value).includes('application/json')
        ) {
          offenders.push(`${where}: '${key}': '${prop.value.value}'`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `api() sets the JSON Content-Type — a caller only names a non-JSON one:\n  ${offenders.join('\n  ')}`,
  );
});

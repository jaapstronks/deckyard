import { parse } from 'acorn';
import { posix } from 'node:path';

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
const QUERY_METHODS = new Set([
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'transaction',
  'executeQuery',
]);

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, fn));
    else if (value && typeof value === 'object') visit(value, fn);
  }
}

function target(file, source) {
  return source.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(file), source))
    : source;
}

function parameterName(node) {
  if (node?.type === 'AssignmentPattern') return parameterName(node.left);
  return node?.type === 'Identifier' ? node.name : null;
}

/**
 * Static DB reachability for storage functions, including private delegation,
 * callbacks, imported aliases, named re-exports and export-star barrels. Query
 * builders and db/client imports seed the graph. No runtime modules are loaded.
 *
 * This is conservative syntax analysis, not authorization proof: references to
 * a DB-reaching function count even in conditional branches or callbacks. Dynamic
 * property dispatch and functions returned by factories are not resolved.
 */
export function storageScopeInventory(sources, callerSources = sources) {
  const modules = new Map();
  const functions = new Map();
  for (const [file, source] of sources) {
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
    const mod = {
      imports: new Map(),
      exports: new Map(),
      aliases: new Map(),
      stars: [],
    };
    modules.set(file, mod);
    for (const statement of ast.body) {
      if (statement.type === 'ImportDeclaration') {
        for (const spec of statement.specifiers) {
          mod.imports.set(spec.local.name, {
            file: target(file, statement.source.value),
            name: spec.imported?.name || spec.imported?.value || '*',
          });
        }
      }
      if (statement.type === 'ExportAllDeclaration') {
        mod.stars.push(target(file, statement.source.value));
      }
      if (statement.type === 'ExportNamedDeclaration') {
        for (const spec of statement.specifiers) {
          mod.exports.set(spec.exported.name, {
            file: statement.source
              ? target(file, statement.source.value)
              : file,
            name: spec.local.name,
          });
        }
      }
      const decl = statement.declaration || statement;
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type !== 'Identifier' || d.init?.type !== 'Identifier')
            continue;
          mod.aliases.set(d.id.name, d.init.name);
          if (statement.type === 'ExportNamedDeclaration')
            mod.exports.set(d.id.name, { file, name: d.id.name });
        }
      }
      const declarations =
        decl.type === 'FunctionDeclaration'
          ? [[decl.id.name, decl]]
          : decl.type === 'VariableDeclaration'
            ? decl.declarations
                .filter(
                  (d) =>
                    d.id.type === 'Identifier' && FUNCTIONS.has(d.init?.type),
                )
                .map((d) => [d.id.name, d.init])
            : [];
      for (const [name, node] of declarations) {
        const key = `${file} :: ${name}`;
        const record = {
          key,
          file,
          name,
          line: node.loc.start.line,
          params: node.params.map(parameterName),
          refs: new Set(),
          members: [],
          db: false,
        };
        visit(node.body, (child) => {
          if (child.type === 'Identifier') record.refs.add(child.name);
          if (child.type === 'MemberExpression') {
            const property = child.computed
              ? child.property.value
              : child.property.name;
            if (QUERY_METHODS.has(property)) record.db = true;
            if (child.object.type === 'Identifier') {
              record.members.push([child.object.name, property]);
            }
          }
          if (
            child.type === 'ImportExpression' &&
            typeof child.source.value === 'string' &&
            target(file, child.source.value).startsWith('server/db/')
          )
            record.db = true;
        });
        functions.set(key, record);
        if (statement.type === 'ExportNamedDeclaration') {
          mod.exports.set(name, { file, name });
        }
      }
    }
  }

  function resolve(file, name, seen = new Set()) {
    const key = `${file} :: ${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (functions.has(key)) return key;
    const mod = modules.get(file);
    if (!mod) return file.startsWith('server/db/') ? '@database' : null;
    if (mod.aliases.has(name))
      return resolve(file, mod.aliases.get(name), seen);
    const binding = mod.imports.get(name) || mod.exports.get(name);
    if (binding) return resolve(binding.file, binding.name, seen);
    for (const star of mod.stars) {
      const resolved = resolve(star, name, new Set(seen));
      if (resolved) return resolved;
    }
    return null;
  }

  for (const fn of functions.values()) {
    fn.dependencies = new Set();
    for (const ref of fn.refs) {
      const resolved = resolve(fn.file, ref);
      if (resolved === '@database') fn.db = true;
      else if (resolved && resolved !== fn.key) fn.dependencies.add(resolved);
    }
    for (const [object, property] of fn.members) {
      const binding = modules.get(fn.file).imports.get(object);
      if (binding?.name !== '*') continue;
      const resolved = resolve(binding.file, property);
      if (resolved === '@database') fn.db = true;
      else if (resolved) fn.dependencies.add(resolved);
    }
  }
  let changed;
  do {
    changed = false;
    for (const fn of functions.values()) {
      if (
        !fn.db &&
        [...fn.dependencies].some((key) => functions.get(key)?.db)
      ) {
        fn.db = true;
        changed = true;
      }
    }
  } while (changed);

  const callSites = new Map();
  for (const [file, source] of callerSources) {
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
    const imports = new Map();
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') continue;
      for (const spec of node.specifiers)
        imports.set(spec.local.name, {
          file: target(file, node.source.value),
          name: spec.imported?.name || spec.imported?.value || '*',
        });
    }
    visit(ast, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node.callee;
      let resolved;
      if (callee.type === 'Identifier') {
        const binding = imports.get(callee.name);
        resolved = binding
          ? resolve(binding.file, binding.name)
          : resolve(file, callee.name);
      } else if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier'
      ) {
        const binding = imports.get(callee.object.name);
        if (binding?.name === '*')
          resolved = resolve(
            binding.file,
            callee.computed ? callee.property.value : callee.property.name,
          );
      }
      if (!functions.has(resolved)) return;
      if (!callSites.has(resolved)) callSites.set(resolved, new Set());
      callSites.get(resolved).add(`${file}:${node.loc.start.line}`);
    });
  }

  // Report defining exports once; barrels point to the same function, never a
  // second burndown entry. Include `function f() {}; export { f as alias }`.
  const exported = new Set();
  for (const [file, mod] of modules) {
    if (!file.startsWith('server/storage/')) continue;
    for (const name of mod.exports.keys()) {
      const key = resolve(file, name);
      if (functions.has(key)) exported.add(key);
    }
  }
  return [...exported]
    .map((key) => {
      const fn = functions.get(key);
      return {
        ...fn,
        callers: [...(callSites.get(key) || [])].sort(),
      };
    })
    .filter((fn) => fn.file.startsWith('server/storage/') && fn.db)
    .sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

/** Positive signature violations; pure functions do not acquire fake scopes. */
export function scopeFirstViolations(inventory, exceptions) {
  return inventory
    .filter((fn) => fn.params[0] !== 'scope' && !exceptions.has(fn.key))
    .map((fn) => `${fn.key} :: scope-first`)
    .sort();
}

/** A checked-in baseline may shrink, but cannot buy room by removing other rows. */
export function addedBurndownEntries(burndown, baseline) {
  const allowed = new Set(baseline);
  return burndown.filter((line) => !allowed.has(line));
}

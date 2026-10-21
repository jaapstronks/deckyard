/**
 * The anonymous-visitor store audit (B786): code, not words.
 *
 * `tests/fixtures/anonymous-visitor-stores.json` is the register of every
 * table that holds something about a visitor (an IP, a user agent, a
 * browser-generated device id, a possessed session token, an accessor
 * e-mail). `docs/reference/analytics-privacy.md` is its reading copy. This
 * module checks the register against the source tree, so a new write of an
 * identity key under `server/` fails a test instead of waiting for a reader
 * of the docs to notice:
 *
 *   (a) every `insertInto('<table>').values({ … })` under `server/` whose
 *       keys include an identity key belongs to a registered table, through
 *       a registered producer (`file :: function`), with those keys among
 *       the table's `identityColumns`;
 *   (b) every `insertInto('<registered table>')` is a registered producer,
 *       and every registered producer is an insert site that exists (a stale
 *       register line is a violation too);
 *   (c) every cleanup, erase and reader function is exported (readers:
 *       declared) by the named file, the cleanup job names the function,
 *       every erase route is declared under `server/routes/`, every test
 *       file exists and names the table, and an `exception` has a reason;
 *   (d) the reference's inventory section names every registered table and
 *       the register's `reference` anchor is a heading in that document.
 *
 * The audit is a pure function of the sources it is handed, so the gate test
 * runs it on the real tree and on a synthetic write without a register line
 * (the negative case that proves the gate bites).
 */

import { parse } from 'acorn';

export const IDENTITY_KEY_PATTERN =
  /^(ip_address|accessor_ip|client_ip|user_agent|device_id|session_token|accessor_email|viewer_email)$/;

/** The heading of the inventory section in the reference document. */
export const INVENTORY_HEADING =
  '## Anonymous visitor records adjacent to analytics';

// ─── AST helpers ───────────────────────────────────────────────────────────

function isNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

/**
 * Depth-first walk with the ancestor chain (nearest last).
 * @param {object} node
 * @param {(node: object, ancestors: object[]) => void} visit
 * @param {object[]} [ancestors]
 */
function walk(node, visit, ancestors = []) {
  visit(node, ancestors);
  const next = ancestors.concat(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit, next);
    } else if (isNode(value)) {
      walk(value, visit, next);
    }
  }
}

function memberName(member) {
  if (member.type !== 'MemberExpression' || member.computed) return null;
  return member.property.type === 'Identifier' ? member.property.name : null;
}

function propertyKeyName(property) {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

/**
 * Every object key written anywhere inside a `.values(…)` argument: the
 * literal `{ … }`, an array of them, or the object a `.map()` callback
 * returns.
 * @param {object} arg
 * @returns {string[]}
 */
function collectKeys(arg) {
  const keys = new Set();
  walk(arg, (node) => {
    if (node.type === 'Property') {
      const name = propertyKeyName(node);
      if (name) keys.add(name);
    }
  });
  return [...keys].sort();
}

/**
 * The `.values(…)` call chained onto an `insertInto(…)` call, if any.
 * @param {object} insertCall
 * @param {object[]} ancestors
 */
function chainedValuesCall(insertCall, ancestors) {
  let current = insertCall;
  for (let i = ancestors.length - 1; i > 0; i--) {
    const member = ancestors[i];
    const call = ancestors[i - 1];
    if (
      member.type !== 'MemberExpression' ||
      member.object !== current ||
      call.type !== 'CallExpression' ||
      call.callee !== member
    )
      return null;
    if (memberName(member) === 'values') return call;
    current = call;
    i--;
  }
  return null;
}

function functionName(fn, parent) {
  if (fn.type === 'FunctionDeclaration' && fn.id) return fn.id.name;
  if (!parent) return null;
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return parent.id.name;
  if (parent.type === 'Property' || parent.type === 'MethodDefinition')
    return propertyKeyName(parent);
  if (
    parent.type === 'AssignmentExpression' &&
    parent.left.type === 'Identifier'
  )
    return parent.left.name;
  return null;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * The nearest *named* function around a node: an anonymous callback (the
 * `withDbGuard(async (db) => …)` shape) is looked through.
 * @param {object[]} ancestors
 */
function enclosingFunctionName(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (!FUNCTION_TYPES.has(node.type)) continue;
    const name = functionName(node, ancestors[i - 1]);
    if (name) return name;
  }
  return '<module>';
}

// ─── Source scan ───────────────────────────────────────────────────────────

/**
 * @typedef {object} InsertSite
 * @property {string} file - Repo-relative path.
 * @property {string|null} table - The literal table name, or null when dynamic.
 * @property {string} fn - The enclosing named function.
 * @property {string} producer - `file :: fn`.
 * @property {string[]} keys - Keys written by the chained `.values(…)`.
 * @property {number} line
 */

/**
 * Every `insertInto(…)` site in one module.
 * @param {string} file - Repo-relative path.
 * @param {string} text - Module source.
 * @returns {InsertSite[]}
 */
export function collectInsertSites(file, text) {
  const ast = parse(text, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });
  const sites = [];
  walk(ast, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    if (memberName(node.callee) !== 'insertInto') return;
    const arg = node.arguments[0];
    const table =
      arg && arg.type === 'Literal' && typeof arg.value === 'string'
        ? arg.value
        : null;
    const valuesCall = chainedValuesCall(node, ancestors);
    const fn = enclosingFunctionName(ancestors);
    sites.push({
      file,
      table,
      fn,
      producer: `${file} :: ${fn}`,
      keys:
        valuesCall && valuesCall.arguments[0]
          ? collectKeys(valuesCall.arguments[0])
          : [],
      line: node.loc.start.line,
    });
  });
  return sites;
}

// ─── Register checks ───────────────────────────────────────────────────────

function splitRef(ref) {
  const [file, name] = String(ref).split(' :: ');
  return { file, name };
}

function exportsName(text, name) {
  return new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\*?\\s+${name}\\b|(?:const|let)\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`,
  ).test(text);
}

function declaresName(text, name) {
  return new RegExp(
    `\\bfunction\\*?\\s+${name}\\s*\\(|\\b(?:const|let)\\s+${name}\\s*=`,
  ).test(text);
}

function headingSlugs(markdown) {
  return new Set(
    [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) =>
      m[1]
        .toLowerCase()
        .replace(/[`*_]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-'),
    ),
  );
}

function inventorySection(markdown) {
  const start = markdown.indexOf(INVENTORY_HEADING);
  if (start < 0) return '';
  const rest = markdown.slice(start + INVENTORY_HEADING.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

function isException(value) {
  return value && typeof value === 'object' && 'exception' in value;
}

/**
 * Run the audit.
 * @param {object} input
 * @param {object} input.register - Parsed `anonymous-visitor-stores.json`.
 * @param {{file: string, text: string}[]} input.sources - Every module under
 *   `server/` the gate scans (migrations and vendor already excluded), plus
 *   any file a register line may point at.
 * @param {string} input.referenceText - The reference document.
 * @param {(file: string) => string|null} input.readFile - Repo-relative read;
 *   null when the file does not exist.
 * @returns {{violations: string[], sites: InsertSite[]}}
 */
export function auditAnonymousVisitorStores({
  register,
  sources,
  referenceText,
  readFile,
}) {
  const violations = [];
  const stores = register.stores || {};
  const sites = sources.flatMap(({ file, text }) =>
    collectInsertSites(file, text),
  );
  const sourceText = new Map(sources.map((s) => [s.file, s.text]));
  const read = (file) =>
    sourceText.has(file) ? sourceText.get(file) : readFile(file);

  // (a) identity writes belong to a registered table and producer.
  for (const site of sites) {
    const identityKeys = site.keys.filter((k) => IDENTITY_KEY_PATTERN.test(k));
    if (!identityKeys.length) continue;
    const where = `${site.file}:${site.line}`;
    if (site.table === null) {
      violations.push(
        `${where}: insertInto() with a dynamic table name writes ${identityKeys.join(', ')}; the gate needs a literal table`,
      );
      continue;
    }
    const store = stores[site.table];
    if (!store) {
      violations.push(
        `${where}: \`${site.table}\` receives ${identityKeys.join(', ')} but is not in tests/fixtures/anonymous-visitor-stores.json`,
      );
      continue;
    }
    if (!(store.producers || []).includes(site.producer)) {
      violations.push(
        `${where}: \`${site.table}\` is written by ${site.producer}, which is not a registered producer`,
      );
    }
    const unlisted = identityKeys.filter(
      (k) => !(store.identityColumns || []).includes(k),
    );
    if (unlisted.length) {
      violations.push(
        `${where}: \`${site.table}\` is written with ${unlisted.join(', ')}, missing from its identityColumns`,
      );
    }
  }

  // (b) every insert into a registered table is a registered producer, and
  //     every registered producer is a real insert site.
  for (const [table, store] of Object.entries(stores)) {
    const tableSites = sites.filter((s) => s.table === table);
    const producers = store.producers || [];
    for (const site of tableSites) {
      if (!producers.includes(site.producer)) {
        violations.push(
          `${site.file}:${site.line}: second write path into \`${table}\` (${site.fn}) is not a registered producer`,
        );
      }
    }
    for (const producer of producers) {
      if (!tableSites.some((s) => s.producer === producer)) {
        violations.push(
          `\`${table}\`: registered producer ${producer} has no insertInto('${table}') site`,
        );
      }
    }
  }

  // (c) every piece of evidence exists.
  const checkFunctionRef = (table, role, ref, predicate) => {
    const { file, name } = splitRef(ref);
    const text = file && name ? read(file) : null;
    if (text == null) {
      violations.push(
        `\`${table}\` ${role}: ${ref} names a file that does not exist`,
      );
    } else if (!predicate(text, name)) {
      violations.push(
        `\`${table}\` ${role}: ${file} does not ${predicate === exportsName ? 'export' : 'declare'} ${name}`,
      );
    }
  };

  for (const [table, store] of Object.entries(stores)) {
    if (!Array.isArray(store.identityColumns)) {
      violations.push(`\`${table}\`: identityColumns must be an array`);
    }
    if (!Array.isArray(store.producers) || !store.producers.length) {
      violations.push(
        `\`${table}\`: producers must name at least one write site`,
      );
    }
    for (const ref of store.readers || []) {
      checkFunctionRef(table, 'reader', ref, declaresName);
    }

    const cleanup = store.cleanup;
    if (isException(cleanup)) {
      if (!String(cleanup.exception || '').trim())
        violations.push(`\`${table}\` cleanup: an exception needs a reason`);
    } else if (!cleanup || !cleanup.job || !Array.isArray(cleanup.functions)) {
      violations.push(
        `\`${table}\` cleanup: expected { job, functions } or { exception }`,
      );
    } else {
      const jobText = read(cleanup.job);
      if (jobText == null) {
        violations.push(
          `\`${table}\` cleanup: job ${cleanup.job} does not exist`,
        );
      }
      if (!cleanup.functions.length)
        violations.push(`\`${table}\` cleanup: functions is empty`);
      for (const ref of cleanup.functions) {
        checkFunctionRef(table, 'cleanup', ref, exportsName);
        const { name } = splitRef(ref);
        if (
          jobText != null &&
          name &&
          !new RegExp(`\\b${name}\\b`).test(jobText)
        ) {
          violations.push(
            `\`${table}\` cleanup: ${cleanup.job} does not call ${name}`,
          );
        }
      }
    }

    const erase = store.erase;
    if (isException(erase)) {
      if (!String(erase.exception || '').trim())
        violations.push(`\`${table}\` erase: an exception needs a reason`);
    } else if (
      !erase ||
      (!Array.isArray(erase.routes) && !Array.isArray(erase.functions))
    ) {
      violations.push(
        `\`${table}\` erase: expected { routes?, functions? } or { exception }`,
      );
    } else {
      if (!(erase.routes || []).length && !(erase.functions || []).length)
        violations.push(`\`${table}\` erase: no route and no function named`);
      for (const route of erase.routes || []) {
        const path = String(route).split(' ').pop();
        const declared = sources.some(
          (s) =>
            s.file.startsWith('server/routes/') && s.text.includes(`'${path}'`),
        );
        if (!declared)
          violations.push(
            `\`${table}\` erase: route ${route} is not declared under server/routes/`,
          );
      }
      for (const ref of erase.functions || []) {
        checkFunctionRef(table, 'erase', ref, exportsName);
      }
    }

    if (!Array.isArray(store.tests) || !store.tests.length) {
      violations.push(`\`${table}\`: tests must name at least one test file`);
    }
    for (const testFile of store.tests || []) {
      const text = read(testFile);
      if (text == null) {
        violations.push(`\`${table}\` tests: ${testFile} does not exist`);
      } else if (!text.includes(table)) {
        violations.push(
          `\`${table}\` tests: ${testFile} does not name the table`,
        );
      }
    }

    // (d) the reference names the table and the anchor is a heading.
    const anchor = String(store.reference || '');
    if (!anchor.startsWith('#')) {
      violations.push(`\`${table}\`: reference must be a heading anchor (#…)`);
    } else if (!headingSlugs(referenceText).has(anchor.slice(1))) {
      violations.push(
        `\`${table}\`: reference anchor ${anchor} is not a heading in the reference document`,
      );
    }
  }

  const inventory = inventorySection(referenceText);
  if (!inventory) {
    violations.push(`reference document has no "${INVENTORY_HEADING}" section`);
  } else {
    for (const table of Object.keys(stores)) {
      if (!inventory.includes(`\`${table}\``)) {
        violations.push(`reference inventory does not name \`${table}\``);
      }
    }
  }

  return { violations, sites };
}

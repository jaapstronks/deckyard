import { parse } from 'acorn';
import { parsers } from 'prettier/plugins/postcss';
import {
  emptyEvidence,
  harvestSource,
  isAlive,
} from '../../scripts/lint-dead-css.js';

/** Harvest executable string literals, excluding comments and import paths. */
export function ownershipEvidence(source, evidence = emptyEvidence()) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression')
      return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      harvestSource(JSON.stringify(node.value), evidence);
      // A class attribute can contain punctuation escaped by its CSS selector.
      for (const token of node.value.split(/\s+/)) evidence.used.add(token);
    }
    if (node.type === 'TemplateLiteral') {
      // Preserve composition boundaries, without harvesting comments inside
      // interpolations. Their executable expressions are visited below.
      harvestSource(
        '`' + node.quasis.map((q) => q.value.raw).join('${value}') + '`',
        evidence,
      );
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'source' && node.type.startsWith('Export')) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return evidence;
}

/** CSS and selector ASTs include nested rules, pseudo-classes and escaped names. */
function selectorClasses(css) {
  const names = new Set();
  function visit(node) {
    if (node.type === 'selector-class') {
      names.add(
        node.value.replace(
          /\\(?:([\da-f]{1,6})\s?|([^\r\n\f]))/gi,
          (_, hex, literal) => {
            if (!hex) return literal;
            const code = Number.parseInt(hex, 16);
            return !code ||
              code > 0x10ffff ||
              (code >= 0xd800 && code <= 0xdfff)
              ? '\ufffd'
              : String.fromCodePoint(code);
          },
        ),
      );
    }
    if (node.selector) visit(node.selector);
    for (const child of node.nodes || []) visit(child);
  }
  visit(parsers.css.parse(css));
  return [...names];
}

/** Map an app stylesheet to its JS owner; shared chrome belongs to lib/dom. */
export function cssOwner(file) {
  const owner = file.split('/')[0];
  return owner === 'shell' || owner === 'components'
    ? 'client/lib/dom/'
    : `client/views/${owner}/`;
}

/** Exact file/class pairs without a string reference in the owning JS layer. */
export function cssOwnershipDebt(styles, sources) {
  const evidenceByOwner = new Map();
  const debt = {};
  for (const [file, css] of Object.entries(styles)) {
    const owner = cssOwner(file);
    if (!evidenceByOwner.has(owner)) {
      const evidence = emptyEvidence();
      for (const [jsFile, source] of Object.entries(sources)) {
        if (jsFile.startsWith(owner)) ownershipEvidence(source, evidence);
      }
      evidenceByOwner.set(owner, evidence);
    }
    const evidence = evidenceByOwner.get(owner);
    const missing = selectorClasses(css)
      .filter((name) => !isAlive(name, evidence))
      .sort();
    if (missing.length) debt[file] = missing;
  }
  return debt;
}

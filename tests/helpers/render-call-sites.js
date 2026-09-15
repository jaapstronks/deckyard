/**
 * Source-level scan of the render entrypoints, for the guards that pin what a
 * call site must state: the deck's language (`tests/slide-copy-language.test.js`)
 * and where a server-rendered type is fetched from
 * (`tests/render-via-declaration.test.js`).
 *
 * A bracket-depth scanner, not a parser, like `./call-sites.js`: exact about the
 * options object of ordinary calls, blind to brackets inside strings. Each guard
 * ships a "the scan reaches the surfaces it claims to" row so a change here that
 * blinds it fails loudly.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The three functions a render surface can enter through, and the module each
// one must be imported from for a call to be *that* function. The import check
// is what keeps the scan honest about shadowing: the editor hands its render
// modules a `renderSlideElement` of its own — a wrapper that injects
// `resolveDeckLang(pres)` — and those modules would otherwise read as call
// sites that forgot the language while being the ones that cannot.
export const RENDER_ENTRYPOINTS = [
  { name: 'renderSlideHtml', from: /slide-types(\/presentation)?\.js'/ },
  { name: 'mountSlideInto', from: /slide-runtime\/slide-render\.js'/ },
  { name: 'renderSlideElement', from: /slide-runtime\/slide-render\.js'/ },
];

/** Blank out comments, keeping every byte's line and column. */
export function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:\\])\/\/[^\n]*/g,
      (m, lead) => lead + blank(m.slice(lead.length)),
    );
}

/**
 * The arguments of the call that starts at `from` (just past its `(`), split on
 * top-level commas. A trailing comma yields no extra argument.
 */
function callArgs(src, from) {
  const args = [];
  let depth = 1;
  let nested = 0;
  let start = from;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (!depth) {
        args.push(src.slice(start, i));
        break;
      }
    } else if (c === '[' || c === '{') nested++;
    else if (c === ']' || c === '}') nested--;
    else if (c === ',' && depth === 1 && nested === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return args.map((a) => a.trim()).filter(Boolean);
}

/** The `{ … }` an identifier was declared with in the same file, or null. */
export function declaredObject(src, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(src);
  if (!decl) return null;
  let i = src.indexOf('{', decl.index);
  let depth = 0;
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && !--depth) break;
  }
  // Properties assigned after the literal count too (`opts.lang = …`).
  const assigned = [
    ...src.matchAll(new RegExp(`${name}\\.(\\w+)\\s*=[^=]`, 'g')),
  ].map((m) => `${m[1]},`);
  return src.slice(open, i + 1) + '\n' + assigned.join('\n');
}

const jsFilesUnder = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') jsFilesUnder(p, acc);
    } else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
};

/**
 * The call sites of `entry` in one source file.
 *
 * @param {string} raw - File contents.
 * @param {string} where - Label for the file (repo-relative path).
 * @param {{ name: string, from: RegExp }} entry
 * @returns {{ where: string, options: string, src: string }[]}
 */
export function renderCallSitesIn(raw, where, entry) {
  if (!entry.from.test(raw)) return [];
  const src = stripComments(raw);
  const sites = [];
  const call = new RegExp(`(?<![\\w.$])${entry.name}\\(`, 'g');
  for (const m of src.matchAll(call)) {
    // The declaration itself is not a call.
    if (/\bfunction\s+$/.test(src.slice(0, m.index))) continue;
    const args = callArgs(src, m.index + m[0].length);
    const line = src.slice(0, m.index).split('\n').length;
    sites.push({
      where: `${where}:${line}`,
      options: args[args.length - 1] || '',
      src,
    });
  }
  return sites;
}

/**
 * Every call site of `entry` under the given roots.
 *
 * @param {string} repoRoot
 * @param {{ name: string, from: RegExp }} entry
 * @param {string[]} [roots]
 */
export function renderCallSites(
  repoRoot,
  entry,
  roots = ['client', 'server', 'shared'],
) {
  const sites = [];
  for (const root of roots) {
    for (const file of jsFilesUnder(join(repoRoot, root))) {
      sites.push(
        ...renderCallSitesIn(
          readFileSync(file, 'utf8'),
          file.slice(repoRoot.length + 1),
          entry,
        ),
      );
    }
  }
  return sites;
}

import fs from 'node:fs/promises';
import path from 'node:path';

function isExternalCssImportUrl(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (t.startsWith('data:')) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.startsWith('//')) return true;
  return false;
}

function resolveImportAbsPath({ repoRoot, fromAbsPath, importUrl }) {
  const u = String(importUrl || '').trim();
  if (!u) return '';
  if (isExternalCssImportUrl(u)) return '';

  // Absolute-from-repo imports like "/client/styles/..." (rare, but support it).
  if (u.startsWith('/')) return path.join(repoRoot, u.replace(/^\//, ''));

  // Relative imports like "./slides/01-layout.css"
  return path.resolve(path.dirname(fromAbsPath), u);
}

function parseTopLevelImports(cssText) {
  const css = String(cssText || '');
  const imports = [];

  let i = 0;
  let depth = 0; // { } nesting
  let inStr = ''; // ' or "
  let inComment = false;
  while (i < css.length) {
    const c = css[i];
    const n = css[i + 1];

    if (inComment) {
      if (c === '*' && n === '/') {
        inComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inStr) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = '';
      i += 1;
      continue;
    }

    if (c === '/' && n === '*') {
      inComment = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i += 1;
      continue;
    }

    if (c === '{') depth += 1;
    if (c === '}') depth = Math.max(0, depth - 1);

    // Only treat @import at top-level (not inside blocks).
    if (depth === 0 && c === '@' && css.slice(i, i + 7) === '@import') {
      const start = i;
      i += 7;

      // Consume until ';' (respect strings/parens/comments at a shallow level).
      let j = i;
      let localInStr = '';
      let localInComment = false;
      let paren = 0;
      while (j < css.length) {
        const cj = css[j];
        const nj = css[j + 1];
        if (localInComment) {
          if (cj === '*' && nj === '/') {
            localInComment = false;
            j += 2;
            continue;
          }
          j += 1;
          continue;
        }
        if (localInStr) {
          if (cj === '\\') {
            j += 2;
            continue;
          }
          if (cj === localInStr) localInStr = '';
          j += 1;
          continue;
        }
        if (cj === '/' && nj === '*') {
          localInComment = true;
          j += 2;
          continue;
        }
        if (cj === '"' || cj === "'") {
          localInStr = cj;
          j += 1;
          continue;
        }
        if (cj === '(') paren += 1;
        if (cj === ')') paren = Math.max(0, paren - 1);
        if (cj === ';' && paren === 0) break;
        j += 1;
      }
      const end = j < css.length ? j + 1 : j;
      const stmt = css.slice(start, end);

      // Extract URL from: @import "x";  @import 'x';  @import url("x");
      const m =
        stmt.match(
          /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)\s;]+))(?:\s*\))?/i
        ) || [];
      const url = (m[1] || m[2] || m[3] || '').trim();
      const media = stmt
        .replace(/^[\s\S]*?\)\s*/i, (s) => s) // noop for safety
        .replace(/@import\s+/i, '')
        .replace(/^(?:url\(\s*)?(?:"[^"]+"|'[^']+'|[^)\s;]+)(?:\s*\))?/i, '')
        .replace(/;[\s\S]*$/, '')
        .trim();

      imports.push({ start, end, url, media, stmt });
      i = end;
      continue;
    }

    i += 1;
  }

  return imports;
}

async function readTextIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

async function inlineCssImports({
  repoRoot,
  absPath,
  seen = new Set(),
  stack = new Set(),
}) {
  const realAbs = path.resolve(absPath);
  if (stack.has(realAbs)) {
    // Cycle: keep the original file contents rather than recursing forever.
    return await readTextIfExists(realAbs);
  }

  const css = await readTextIfExists(realAbs);
  if (!css) return '';

  const imports = parseTopLevelImports(css);
  if (!imports.length) return css;

  stack.add(realAbs);
  try {
    let out = '';
    let last = 0;
    for (const imp of imports) {
      out += css.slice(last, imp.start);

      const childAbs = resolveImportAbsPath({
        repoRoot,
        fromAbsPath: realAbs,
        importUrl: imp.url,
      });

      if (!childAbs) {
        // External or unresolvable: keep statement as-is.
        out += imp.stmt;
        last = imp.end;
        continue;
      }

      if (!seen.has(childAbs)) seen.add(childAbs);
      const childCss = await inlineCssImports({
        repoRoot,
        absPath: childAbs,
        seen,
        stack,
      });

      if (!childCss) {
        // Missing file: keep original statement (helps debugging).
        out += imp.stmt;
        last = imp.end;
        continue;
      }

      if (imp.media) {
        out += `\n/* inlined ${path.relative(repoRoot, childAbs)} */\n`;
        out += `@media ${imp.media} {\n${childCss}\n}\n`;
      } else {
        out += `\n/* inlined ${path.relative(repoRoot, childAbs)} */\n`;
        out += `${childCss}\n`;
      }

      last = imp.end;
    }
    out += css.slice(last);
    return out;
  } finally {
    stack.delete(realAbs);
  }
}

/**
 * Read a local CSS file and inline any local `@import` rules recursively.
 * Intended for HTML export builders that inline CSS into `<style>...</style>`.
 */
export async function readCssWithImports(repoRoot, absCssPath) {
  return await inlineCssImports({
    repoRoot,
    absPath: absCssPath,
    seen: new Set(),
    stack: new Set(),
  });
}

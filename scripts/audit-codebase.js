import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'server/data',
  'server/uploads',
]);

const EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.md',
]);

const isSkipped = (relPath) => {
  const parts = relPath.split(path.sep);
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  // skip lockfiles (huge, machine-generated)
  if (relPath === 'package-lock.json') return true;
  return false;
};

async function walk(dirAbs, relBase = '') {
  const out = [];
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dirAbs, ent.name);
    const rel = relBase ? path.join(relBase, ent.name) : ent.name;
    if (isSkipped(rel)) continue;
    if (ent.isDirectory()) {
      out.push(...(await walk(abs, rel)));
    } else if (ent.isFile()) {
      out.push({ abs, rel });
    }
  }
  return out;
}

async function lineCount(abs) {
  const buf = await fs.readFile(abs, 'utf8');
  // Works fine for LF/CRLF; also counts last line without trailing newline.
  return buf ? buf.split(/\n/).length : 0;
}

async function readText(abs) {
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

function pad(n, width = 6) {
  const s = String(n);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

async function main() {
  const files = await walk(ROOT);

  const sized = [];
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;
    try {
      const n = await lineCount(f.abs);
      sized.push({ ...f, lines: n });
    } catch {
      // ignore unreadable files
    }
  }

  sized.sort((a, b) => b.lines - a.lines);
  const big = sized.filter((f) => f.lines >= 500);

  console.log('== Codebase audit ==');
  console.log(`Root: ${ROOT}`);
  console.log('');

  console.log('Files >= 500 lines (hand-written focus):');
  for (const f of big.slice(0, 50)) {
    console.log(`${pad(f.lines)}  ${f.rel}`);
  }
  if (big.length > 50) console.log(`... and ${big.length - 50} more`);
  console.log(`Total >=500: ${big.length}`);
  console.log('');

  console.log('Top 25 largest files:');
  for (const f of sized.slice(0, 25)) {
    console.log(`${pad(f.lines)}  ${f.rel}`);
  }
  console.log('');

  const tokens = ['TODO', 'FIXME', 'HACK', 'XXX'];
  let tokenHits = 0;
  const tokenFiles = new Map();
  for (const f of sized) {
    if (!f.rel.endsWith('.js')) continue;
    // Don't let the audit script report its own "TODO" label strings.
    if (f.rel === 'scripts/audit-codebase.js') continue;
    const txt = await readText(f.abs);
    if (!txt) continue;
    let fileHits = 0;
    for (const t of tokens) {
      const re = new RegExp(`\\b${t}\\b`, 'g');
      const m = txt.match(re);
      if (m) fileHits += m.length;
    }
    if (fileHits) {
      tokenHits += fileHits;
      tokenFiles.set(f.rel, fileHits);
    }
  }

  console.log('TODO/FIXME/HACK/XXX:');
  if (!tokenHits) {
    console.log('  none found');
  } else {
    const rows = Array.from(tokenFiles.entries()).sort((a, b) => b[1] - a[1]);
    for (const [rel, hits] of rows.slice(0, 30)) {
      console.log(`  ${pad(hits, 4)}  ${rel}`);
    }
    if (rows.length > 30) console.log(`  ... and ${rows.length - 30} more files`);
    console.log(`  Total hits: ${tokenHits}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



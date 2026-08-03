import fs from 'node:fs/promises';
import path from 'node:path';
import { SLIDE_TYPES, CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types.js';
import { slideTypeUiStrings } from './lib/slide-type-i18n-keys.js';

const REPO_ROOT = process.cwd();

const CLIENT_DIR = path.join(REPO_ROOT, 'client');
const OUT_TEMPLATE = path.join(CLIENT_DIR, 'i18n', 'template.pot.json');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'client/vendor',
  'client/styles',
]);

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function posToLine(src, idx) {
  // 1-based
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function readQuotedString(src, startIdx) {
  const q = src[startIdx];
  if (q !== "'" && q !== '"') return null;
  let i = startIdx + 1;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === q) {
      return { value: out, end: i + 1 };
    }
    if (ch === '\\') {
      const nxt = src[i + 1];
      if (nxt === undefined) return null;
      // Common escapes
      if (nxt === 'n') out += '\n';
      else if (nxt === 'r') out += '\r';
      else if (nxt === 't') out += '\t';
      else out += nxt; // includes \' and \"
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return null;
}

function skipWs(src, i) {
  let idx = i;
  while (idx < src.length && isWs(src[idx])) idx++;
  return idx;
}

function findTCalls(src) {
  const calls = [];

  // State machine to avoid matching inside strings/comments.
  let state = 'normal'; // normal | s | d | line | block | tmpl
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const nxt = src[i + 1];

    if (state === 'normal') {
      if (ch === '/' && nxt === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && nxt === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 's';
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'd';
        i++;
        continue;
      }
      if (ch === '`') {
        state = 'tmpl';
        i++;
        continue;
      }

      // Match t( ... ) with first two args as string literals.
      if (ch === 't') {
        const prev = i > 0 ? src[i - 1] : '';
        if (prev && (isIdentChar(prev) || prev === '.')) {
          i++;
          continue;
        }
        let j = i + 1;
        j = skipWs(src, j);
        if (src[j] !== '(') {
          i++;
          continue;
        }
        j++;
        j = skipWs(src, j);
        const keyStr = readQuotedString(src, j);
        if (!keyStr) {
          i++;
          continue;
        }
        j = skipWs(src, keyStr.end);
        if (src[j] !== ',') {
          i++;
          continue;
        }
        j++;
        j = skipWs(src, j);
        const defStr = readQuotedString(src, j);
        if (!defStr) {
          i++;
          continue;
        }
        calls.push({
          key: keyStr.value,
          def: defStr.value,
          index: i,
        });
        i = defStr.end;
        continue;
      }

      i++;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') state = 'normal';
      i++;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && nxt === '/') {
        state = 'normal';
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (state === 's') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'") state = 'normal';
      i++;
      continue;
    }
    if (state === 'd') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') state = 'normal';
      i++;
      continue;
    }
    if (state === 'tmpl') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') state = 'normal';
      i++;
      continue;
    }

    // Fallback
    i++;
  }

  return calls;
}

function addKey(strings, key, def, ref) {
  const k = String(key || '').trim();
  if (!k) return;
  const d = String(def ?? '');
  if (!strings[k]) strings[k] = { default: d, refs: [] };
  if (strings[k].default !== d) {
    // Keep first default; conflicts are handled in main() warnings.
  }
  if (ref && !strings[k].refs.includes(ref)) strings[k].refs.push(ref);
}

function extractSlideTypeUiStrings(strings) {
  const customNames = new Set(CUSTOM_SLIDE_TYPE_NAMES || []);
  // Delegate the "which keys does a type own?" walk to the shared generator, so
  // this extractor and i18n-sync's prune can never disagree on the key shape.
  // One type at a time keeps the per-type ref that the template records.
  for (const [type, def] of Object.entries(SLIDE_TYPES || {})) {
    // Skip fork-specific custom types: template.pot.json must only contain
    // upstream strings (it is a local, gitignored extraction artifact).
    if (customNames.has(type)) continue;
    const typeRef = `shared/slide-types:${type}`;
    for (const [key, def0] of slideTypeUiStrings({ [type]: def })) {
      addKey(strings, key, def0, typeRef);
    }
  }
}

async function* walk(dir) {
  const rel = path.relative(REPO_ROOT, dir).replaceAll('\\', '/');
  if (IGNORE_DIRS.has(rel)) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = path.relative(REPO_ROOT, full).replaceAll('\\', '/');
    if (IGNORE_DIRS.has(r)) continue;
    if (e.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

async function writeJsonPretty(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const text = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(p, text, 'utf8');
}

function sortObjectByKey(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

async function main() {
  const strings = Object.create(null); // key -> { default, refs[] }
  const warnings = [];

  for await (const filePath of walk(CLIENT_DIR)) {
    if (!filePath.endsWith('.js')) continue;
    const rel = path.relative(REPO_ROOT, filePath).replaceAll('\\', '/');
    const src = await fs.readFile(filePath, 'utf8');
    const calls = findTCalls(src);
    for (const c of calls) {
      const key = String(c.key || '').trim();
      if (!key) continue;
      const def = String(c.def ?? '');
      const line = posToLine(src, c.index);
      const ref = `${rel}:${line}`;

      if (!strings[key]) strings[key] = { default: def, refs: [] };
      if (strings[key].default !== def) {
        warnings.push(
          `Key "${key}" has conflicting defaults:\n  - "${strings[key].default}"\n  - "${def}"\n  (keeping first)`
        );
      }
      if (!strings[key].refs.includes(ref)) strings[key].refs.push(ref);
    }
  }

  // Shared slide type/editor metadata strings (labels/options/etc).
  // These are dynamic-key lookups in the client, so we extract them explicitly.
  extractSlideTypeUiStrings(strings);

  // Template file (.pot-like)
  const template = {
    meta: {
      format: 'presentation-system-ui-i18n-template',
      defaultLocale: 'en',
      generatedAt: new Date().toISOString(),
      note:
        'Translate the values into <locale>.json. Keys are stable and referenced from code as t(key, englishFallback).',
    },
    strings: sortObjectByKey(strings),
  };
  await writeJsonPretty(OUT_TEMPLATE, template);

  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('[i18n] Warnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[i18n] Extracted ${Object.keys(strings).length} keys -> ${path.relative(REPO_ROOT, OUT_TEMPLATE)}`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});



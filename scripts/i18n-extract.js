import fs from 'node:fs/promises';
import path from 'node:path';
import { SLIDE_TYPES, CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types.js';

const REPO_ROOT = process.cwd();

const CLIENT_DIR = path.join(REPO_ROOT, 'client');
const OUT_TEMPLATE = path.join(CLIENT_DIR, 'i18n', 'template.pot.json');
const OUT_EN = path.join(CLIENT_DIR, 'i18n', 'en.json');

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

function normalizeOption(opt) {
  if (typeof opt === 'string') return { value: opt, label: opt, title: opt, ariaLabel: opt };
  if (opt && typeof opt === 'object') {
    const value = String(opt.value ?? '');
    const label = String(opt.label ?? opt.title ?? value);
    const title = String(opt.title ?? opt.label ?? value);
    const ariaLabel = String(opt.ariaLabel ?? opt.label ?? title ?? value);
    return { ...opt, value, label, title, ariaLabel };
  }
  return { value: '', label: '', title: '', ariaLabel: '' };
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
  for (const [type, def] of Object.entries(SLIDE_TYPES || {})) {
    // Skip fork-specific custom types: template.pot.json is a tracked
    // artifact and must only contain upstream strings.
    if (customNames.has(type)) continue;
    const typeRef = `shared/slide-types:${type}`;
    const labelKey = def?.labelKey || `slideType.${type}.label`;
    addKey(strings, labelKey, def?.label || type, typeRef);

    for (const f of Array.isArray(def?.fields) ? def.fields : []) {
      const fk = String(f?.key || '').trim();
      if (!fk) continue;
      addKey(strings, f.labelKey || `slideType.${type}.field.${fk}.label`, f?.label || fk, typeRef);
      if (typeof f?.placeholder === 'string')
        addKey(strings, f.placeholderKey || `slideType.${type}.field.${fk}.placeholder`, f.placeholder, typeRef);
      if (typeof f?.helpText === 'string')
        addKey(strings, f.helpTextKey || `slideType.${type}.field.${fk}.help`, f.helpText, typeRef);

      const itemFields = Array.isArray(f?.itemFields) ? f.itemFields : [];
      for (const it of itemFields) {
        const ik = String(it?.key || '').trim();
        if (!ik) continue;
        addKey(strings, it.labelKey || `slideType.${type}.field.${fk}.item.${ik}.label`, it?.label || ik, typeRef);
        if (typeof it?.placeholder === 'string')
          addKey(strings, it.placeholderKey || `slideType.${type}.field.${fk}.item.${ik}.placeholder`, it.placeholder, typeRef);
        if (typeof it?.helpText === 'string')
          addKey(strings, it.helpTextKey || `slideType.${type}.field.${fk}.item.${ik}.help`, it.helpText, typeRef);
      }

      const opts = Array.isArray(f?.options) ? f.options : [];
      for (const raw of opts) {
        const opt = normalizeOption(raw);
        const ok = opt?.labelKey || opt?.titleKey || opt?.ariaLabelKey;
        if (!ok) continue;
        if (opt.labelKey) addKey(strings, opt.labelKey, opt.label, typeRef);
        if (opt.titleKey) addKey(strings, opt.titleKey, opt.title, typeRef);
        if (opt.ariaLabelKey) addKey(strings, opt.ariaLabelKey, opt.ariaLabel, typeRef);
      }
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

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
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

  // Keep en.json in sync (translator-friendly)
  const existingEn = (await readJsonIfExists(OUT_EN)) || {};
  const nextEn = { ...(existingEn && typeof existingEn === 'object' ? existingEn : {}) };
  for (const [k, v] of Object.entries(strings)) nextEn[k] = v.default;
  await writeJsonPretty(OUT_EN, sortObjectByKey(nextEn));

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



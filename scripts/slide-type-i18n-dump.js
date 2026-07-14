import fs from 'node:fs/promises';
import path from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types.js';

const REPO_ROOT = process.cwd();

function add(out, key, value) {
  const k = String(key || '').trim();
  if (!k) return;
  const v = typeof value === 'string' ? value : '';
  out[k] = v;
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

function safeKeyPart(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function walkFields({ out, type, fields, prefix }) {
  for (const f of Array.isArray(fields) ? fields : []) {
    const fieldKey = String(f?.key || '').trim();
    if (!fieldKey) continue;

    const base = `${prefix}.field.${fieldKey}`;
    add(out, `${base}.label`, f?.label || fieldKey);

    if (typeof f?.placeholder === 'string')
      add(out, `${base}.placeholder`, f.placeholder);
    if (typeof f?.helpText === 'string')
      add(out, `${base}.help`, f.helpText);

    if (Array.isArray(f?.options)) {
      for (const raw of f.options) {
        const opt = normalizeOption(raw);
        const optId = safeKeyPart(opt.value || opt.label || 'option');
        add(out, `${base}.option.${optId}.label`, opt.label);
        if (opt.title) add(out, `${base}.option.${optId}.title`, opt.title);
        if (opt.ariaLabel)
          add(out, `${base}.option.${optId}.ariaLabel`, opt.ariaLabel);
      }
    }

    // Items fields in this codebase use `itemFields` (editor-only nested fields).
    if (Array.isArray(f?.itemFields)) {
      for (const it of f.itemFields) {
        const ik = String(it?.key || '').trim();
        if (!ik) continue;
        add(out, `${base}.item.${ik}.label`, it?.label || ik);
        if (typeof it?.placeholder === 'string')
          add(out, `${base}.item.${ik}.placeholder`, it.placeholder);
        if (typeof it?.helpText === 'string')
          add(out, `${base}.item.${ik}.help`, it.helpText);
      }
    }

    // Nested item fields (items/grid schemas)
    if (Array.isArray(f?.fields)) {
      walkFields({ out, type, fields: f.fields, prefix: base });
    }
  }
}

async function main() {
  const out = {};
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const prefix = `slideType.${type}`;
    add(out, `${prefix}.label`, def?.label || type);
    walkFields({ out, type, fields: def?.fields, prefix });
  }

  const target = path.join(REPO_ROOT, 'docs', 'i18n', 'slide-type-copy-dump.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(out, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[dump] Wrote ${Object.keys(out).length} strings -> ${path.relative(REPO_ROOT, target)}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});



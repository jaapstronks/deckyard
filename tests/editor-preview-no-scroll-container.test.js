/**
 * The editor's slide preview is never a scroll container.
 *
 * attachThumbScaleContain() fits the 16:9 slide to the preview stage with a
 * ResizeObserver. If the box around the stage can scroll, any sub-pixel
 * overflow (the hover lift, an inline-edit chip) shows a scrollbar, the stage
 * narrows, the thumb shrinks, the overflow and the scrollbar go away, the
 * thumb grows back — and the preview flickers between two sizes. That is what
 * happened while the preview body still carried the generic `.panel-scroll`
 * class, whose `.is-editor .panel-scroll { overflow-y: auto }` out-ranked the
 * intended `overflow: hidden`.
 *
 * Two halves: no source puts `panel-scroll` on the preview body, and no
 * stylesheet gives the preview body a scrolling overflow.
 *
 * Run with: node --test tests/editor-preview-no-scroll-container.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir, ext) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, ext)));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

test('no view puts panel-scroll on the preview body', async () => {
  const offenders = [];
  for (const file of await walk(path.join(ROOT, 'client'), '.js')) {
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/class:\s*['"`]([^'"`]*)['"`]/g)) {
      const classes = m[1].split(/\s+/);
      if (
        classes.includes('preview-panel-body') &&
        classes.includes('panel-scroll')
      ) {
        offenders.push(path.relative(ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no stylesheet lets the preview body scroll', async () => {
  const offenders = [];
  let declaresHidden = false;
  for (const file of await walk(path.join(ROOT, 'client/styles'), '.css')) {
    const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.preview-panel-body\b/.test(m[1])) continue;
      if (/overflow(?:-[xy])?\s*:\s*(auto|scroll)/.test(m[2])) {
        offenders.push(`${path.relative(ROOT, file)}  ${m[1].trim()}`);
      }
      if (/overflow\s*:\s*hidden/.test(m[2])) declaresHidden = true;
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(
    declaresHidden,
    '.preview-panel-body must declare overflow: hidden',
  );
});

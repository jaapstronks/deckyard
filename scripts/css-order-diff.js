#!/usr/bin/env node
// Report possible cascade flips in B534. A candidate needs reversed file
// order, the same CSS property and a class in each selector's final compound.
// One-time B534 audit against the B533 baseline, before per-map imports.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  APP_FEATURE_LAYER,
  APP_FEATURE_ORDER,
  appFeatureEntries,
  viewerEntries,
} from './generate-slide-css-aggregators.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function baselineImports(file) {
  const source = execFileSync(
    'git',
    ['show', `b8fc6507:client/styles/${file}`],
    { cwd: root, encoding: 'utf8' },
  );
  return [...source.matchAll(/@import url\('\.\/([^']+)'\)/g)].map(
    (match) => match[1],
  );
}

// Tokens and primitives stay ahead of both populations. In B533, app.css
// loaded base.css before viewer.css; B534 puts viewer chrome first.
const oldFiles = [
  ...baselineImports('base.css'),
  ...baselineImports('viewer.css'),
];
const viewerFiles = viewerEntries().map((file) => `viewer/${file}`);
const newFiles = [
  ...viewerFiles,
  ...APP_FEATURE_ORDER.flatMap((feature) =>
    appFeatureEntries(feature).map((file) => `app/${feature}/${file}`),
  ),
];
const expected = [
  ...APP_FEATURE_LAYER.files.map((file) => `app/${file}`),
  ...viewerFiles,
].sort();
if (
  JSON.stringify([...oldFiles].sort()) !== JSON.stringify(expected) ||
  JSON.stringify([...newFiles].sort()) !== JSON.stringify(expected)
) {
  throw new Error(
    'B534 CSS populations differ from B533; order diff is invalid',
  );
}

function parseRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  function splitSelectors(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '(' || text[index] === '[') depth++;
      if (text[index] === ')' || text[index] === ']') depth--;
      if (text[index] === ',' && depth === 0) {
        parts.push(text.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }
  function specificity(selector) {
    const ids = [...selector.matchAll(/#[\w-]+/g)].length;
    const classes = [...selector.matchAll(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)]
      .length;
    const elements = [
      ...selector.matchAll(/(^|[\s>+~])(?:[a-z][\w-]*|::[\w-]+)/gi),
    ].length;
    return `${ids}/${classes}/${elements}`;
  }
  function walk(start, end, context = '') {
    let cursor = start;
    while (cursor < end) {
      const open = css.indexOf('{', cursor);
      if (open < 0 || open >= end) break;
      const head = css.slice(cursor, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < end && depth) {
        if (css[close] === '{') depth++;
        if (css[close] === '}') depth--;
        close++;
      }
      if (
        head.startsWith('@media') ||
        head.startsWith('@supports') ||
        head.startsWith('@container')
      ) {
        walk(open + 1, close - 1, `${context} ${head}`.trim());
      } else if (!head.startsWith('@')) {
        const body = css.slice(open + 1, close - 1);
        // Take direct declarations only; nested selector rules are walked below.
        const direct = body.replace(/\{[^{}]*\}/g, '');
        const properties = [...direct.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map(
          (match) => match[1],
        );
        for (const selector of splitSelectors(head)) {
          const last =
            selector
              .trim()
              .split(/\s+|>|\+|~/)
              .at(-1) ?? '';
          const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
          for (const property of properties) {
            rules.push({
              selector,
              property,
              classes,
              context,
              specificity: specificity(selector),
            });
          }
        }
        if (body.includes('{')) walk(open + 1, close - 1, context);
      }
      cursor = close;
    }
  }
  walk(0, css.length);
  return rules;
}

const rules = new Map(
  oldFiles.map((file) => [
    file,
    parseRules(fs.readFileSync(path.join(root, 'client/styles', file), 'utf8')),
  ]),
);
const newIndex = new Map(newFiles.map((file, index) => [file, index]));
const candidates = new Map();
let flippedFilePairs = 0;
for (let i = 0; i < oldFiles.length; i++) {
  for (let j = i + 1; j < oldFiles.length; j++) {
    const first = oldFiles[i];
    const second = oldFiles[j];
    if (newIndex.get(first) < newIndex.get(second)) continue;
    flippedFilePairs++;
    for (const a of rules.get(first)) {
      if (!a.classes.length) continue;
      for (const b of rules.get(second)) {
        if (
          a.property !== b.property ||
          !b.classes.length ||
          a.specificity !== b.specificity
        )
          continue;
        const common = a.classes.filter((value) => b.classes.includes(value));
        if (!common.length) continue;
        const key = JSON.stringify([
          first,
          a.selector,
          second,
          b.selector,
          a.property,
          a.context,
          b.context,
        ]);
        candidates.set(key, {
          first,
          second,
          property: a.property,
          selectors: [a.selector, b.selector],
          class: common[0],
          contexts: [a.context, b.context],
        });
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      files: oldFiles.length,
      flippedFilePairs,
      candidates: [...candidates.values()],
    },
    null,
    2,
  ),
);

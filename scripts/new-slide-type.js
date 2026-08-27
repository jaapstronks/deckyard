#!/usr/bin/env node

/**
 * Scaffold a file-JS custom slide type — gap 1b of the forker toolkit.
 *
 * The file-JS seam is powerful and undiscoverable: the import path is two
 * levels up (not one), the field `type` vocabulary is a closed set, `enum`
 * needs options, `defaults` must cover the fields, and the CSS seam is
 * `custom/styles/` rather than the core slide bundle. Every one of those is a
 * mistake a first custom type makes, and most of them used to surface only when
 * a slide rendered wrong in front of an audience.
 *
 * So this writes a type that is correct by construction and then PROVES it: the
 * generated file is imported back and run through
 * `validateSlideTypeDefinition()` before the script reports success. If the
 * template ever drifts out of the contract, scaffolding fails here rather than
 * in a fork's deck.
 *
 * Usage:
 *   npm run new:slide-type -- <name> [options]
 *
 *   <name>          registry key + filename, kebab-case (e.g. `acme-hero-slide`)
 *   --label <text>  human label in the picker (default: derived from the name)
 *   --fields <list> comma-separated `key:type` pairs; an enum spells its
 *                   options inline (`status:enum(draft|live)`)
 *                   (default: `heading:string,body:markdown`)
 *   --theme-id <id> bind the type to a theme
 *   --namespace <n> fork namespace (`acme` or `nl.example.slide`)
 *   --no-css        skip the stylesheet stub
 *   --force         overwrite an existing file
 *   --yes           never prompt (for scripts and CI)
 *
 * With a TTY and no flags it asks for the label and the field list; everything
 * has a working default, so pressing Enter through it produces a valid type.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIELD_TYPE_NAMES } from '../shared/slide-types/field-types.js';
import { canonicalTypeName } from '../shared/slide-types/type-id.js';
import {
  CORE_SLIDE_TYPE_NAMES,
  GLOBAL_SLIDE_FIELD_KEYS,
} from '../shared/slide-types/registry.js';
import {
  formatDefinitionReport,
  validateSlideTypeDefinition,
} from '../shared/slide-types/validate-definition.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SLIDE_TYPES_DIR = path.join(REPO_ROOT, 'custom', 'slide-types');
const STYLES_DIR = path.join(REPO_ROOT, 'custom', 'styles');

/** A registry key is one kebab segment — the same grammar as a type id's name. */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The field types the template can emit a default and a renderer line for.
 *
 * A strict subset of `FIELD_TYPE_NAMES` — `items` needs an `itemFields` schema
 * and `csv`/`code`/`color`/`images` need a renderer decision this scaffold has
 * no basis for. Asking for one of those is not an error in the field type, so
 * the message says so and points at the full vocabulary.
 * `tests/new-slide-type-scaffold.test.js` pins that this list stays a subset of
 * the declared types.
 *
 * `enum` was excluded for a fixable reason — it needs `options`, which
 * `key:type` cannot express — so the grammar grew a place to put them
 * (`status:enum(draft|live)`). It is worth the extra parsing because an enum is
 * the field a scaffolded type is most likely to want and the one with the most
 * obvious rendering: a closed set of short values is a status chip, which is
 * `badgeHtml` from the shared partials.
 */
export const SCAFFOLDABLE_FIELD_TYPES = [
  'boolean',
  'enum',
  'image',
  'markdown',
  'number',
  'string',
  'url',
];

/** `status:enum(draft|live)` → the type and its options. */
const ENUM_SPEC_RE = /^enum\(([^)]*)\)$/;

/**
 * Parse `process.argv` into the scaffolder's options.
 *
 * @param {string[]} argv
 * @returns {{name: string, label: string|null, fields: string|null, themeId: string|null, namespace: string|null, css: boolean, force: boolean, yes: boolean}}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    name: '',
    label: null,
    fields: null,
    themeId: null,
    namespace: null,
    css: true,
    force: false,
    yes: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--no-css') out.css = false;
    else if (a === '--force') out.force = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--label') out.label = args[(i += 1)];
    else if (a === '--fields') out.fields = args[(i += 1)];
    else if (a === '--theme-id') out.themeId = args[(i += 1)];
    else if (a === '--namespace') out.namespace = args[(i += 1)];
    else if (!a.startsWith('-') && !out.name) out.name = a;
  }
  return out;
}

/** `acme-hero-slide` → `Acme hero`. The `-slide` suffix is noise in a picker. */
function labelFromName(name) {
  const words = name
    .replace(/-slide$/, '')
    .split('-')
    .filter(Boolean);
  if (!words.length) return name;
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

/** `title` → `Title`; `leftBody` → `Left body`. */
function labelFromKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Parse a `key:type,key:type` list into field descriptors.
 *
 * @param {string} spec
 * @returns {{fields: Array<{key: string, type: string}>, errors: string[]}}
 */
export function parseFields(spec) {
  const fields = [];
  const errors = [];
  const seen = new Set();
  for (const raw of String(spec).split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [key, rawType = 'string'] = entry.split(':').map((s) => s.trim());
    const enumSpec = ENUM_SPEC_RE.exec(rawType);
    const type = enumSpec ? 'enum' : rawType;
    const options = enumSpec
      ? enumSpec[1]
          .split('|')
          .map((o) => o.trim())
          .filter(Boolean)
      : null;
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) {
      errors.push(`"${key}" is not a usable field key (letters and digits)`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`duplicate field key "${key}"`);
      continue;
    }
    if (!SCAFFOLDABLE_FIELD_TYPES.includes(type)) {
      errors.push(
        `"${type}" is not a type this scaffolder can write a renderer for ` +
          `(${SCAFFOLDABLE_FIELD_TYPES.join(', ')}). Add such a field by hand ` +
          `afterwards — the full vocabulary is ${FIELD_TYPE_NAMES.join(', ')}`,
      );
      continue;
    }
    if (GLOBAL_SLIDE_FIELD_KEYS.includes(key)) {
      errors.push(
        `"${key}" is a global slide field every type already gets; a field of ` +
          `that name would shadow it`,
      );
      continue;
    }
    if (type === 'enum' && !options?.length) {
      errors.push(
        `"${key}" is an enum with no options; spell them out as ` +
          `${key}:enum(first|second) — an enum without options is exactly what ` +
          `the definition validator refuses`,
      );
      continue;
    }
    seen.add(key);
    fields.push(options ? { key, type, options } : { key, type });
  }
  if (!fields.length && !errors.length) errors.push('no fields given');
  return { fields, errors };
}

/**
 * The value a field starts at.
 *
 * An enum starts at its first option rather than `''`: an empty string is not
 * in the vocabulary, so a blank default would make every freshly inserted slide
 * fail content validation on a field the author never touched.
 */
function defaultFor({ type, options }) {
  if (type === 'number') return '0';
  if (type === 'boolean') return 'false';
  if (type === 'enum') return `'${options[0]}'`;
  return "''";
}

/**
 * The line inside `renderHtml` that prints one field.
 *
 * Every text-ish value goes through `escapeHtml`, and each element carries
 * `data-inline-field` so the type is one `inline` descriptor away from being
 * click-to-edit in the canvas.
 *
 * An `enum` renders through the shared `badgeHtml` partial rather than a
 * hand-rolled chip: a closed vocabulary of short values IS a status chip, and
 * pointing the scaffold at `partials.js` for it is the difference between a
 * forker finding the library and spelling a fourth `.my-badge` of their own.
 * The partial also brings the empty case (`''`, not an empty element), so the
 * line needs no branch.
 */
function renderLineFor({ key, type }) {
  const val = `content?.${key}`;
  if (type === 'enum') {
    return `          \${badgeHtml(${val}, { field: '${key}' })}`;
  }
  if (type === 'image') {
    return `          \${${val} ? \`<img class="hero-image" src="\${escapeHtml(${val})}" alt="" />\` : ''}`;
  }
  if (type === 'url') {
    return `          \${${val} ? \`<a class="hero-link" href="\${escapeHtml(${val})}">\${escapeHtml(${val})}</a>\` : ''}`;
  }
  if (type === 'number' || type === 'boolean') {
    return `          <p data-inline-field="${key}">\${escapeHtml(String(${val} ?? ''))}</p>`;
  }
  const tag = key === 'heading' || key === 'title' ? 'h2' : 'p';
  return `          <${tag} data-inline-field="${key}">\${escapeHtml(${val})}</${tag}>`;
}

/**
 * The generated module source.
 *
 * @param {{name: string, label: string, fields: Array<{key: string, type: string}>, themeId: string|null, namespace: string|null}} spec
 * @returns {string}
 */
export function moduleSource({ name, label, fields, themeId, namespace }) {
  // `acme-hero-slide` → `.slide-acme-hero`: the suffix is already in `slide`,
  // which is why every core type spells it that way (`comparison-slide` renders
  // `.slide-comparison`). canonicalTypeName() owns that rule.
  const rootClass = `slide-${canonicalTypeName(name)}`;
  const fieldLines = fields
    .map((f) => {
      const optionLine = f.options
        ? `\n      options: [${f.options.map((o) => `'${o}'`).join(', ')}],`
        : '';
      return (
        `    {\n      key: '${f.key}',\n      type: '${f.type}',` +
        `\n      label: '${labelFromKey(f.key)}',${optionLine}\n    },`
      );
    })
    .join('\n');
  const defaultLines = fields
    .map((f) => `    ${f.key}: ${defaultFor(f)},`)
    .join('\n');
  const textish = fields.filter((f) =>
    ['string', 'markdown', 'text'].includes(f.type),
  );
  const labelField = (textish[0] || fields[0]).key;
  // Only import what the generated body actually calls: an unused import is a
  // lint error in the fork's own repo the moment they run eslint.
  const usesBadge = fields.some((f) => f.type === 'enum');
  const usesEscape = fields.some((f) => f.type !== 'enum');
  const imports = [
    usesEscape
      ? "import { escapeHtml } from '../../shared/slide-types/helpers.js';"
      : null,
    usesBadge
      ? "import { badgeHtml } from '../../shared/slide-types/partials.js';"
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `/**
 * ${label} — a fork-local slide type.
 *
 * Generated by \`npm run new:slide-type -- ${name}\`. Everything below is
 * yours to change; the shapes that must hold are enforced by
 * \`shared/slide-types/validate-definition.js\`, which the custom loader runs on
 * this file at every startup.
 *
 * The import path is two levels up: this file's runtime home is
 * \`custom/slide-types/\`, two below the repo root.
 *
 * \`shared/slide-types/partials.js\` holds the shared inline elements —
 * \`eyebrowHtml\` (a small standing label), \`badgeHtml\` (a status chip) and
 * \`highlightHtml\` (a coloured run inside a line). Each returns an HTML string
 * or \`''\`, takes a \`field\` to become click-to-editable, and is styled from
 * theme tokens, so composing one is how this type looks designed on every theme
 * without shipping any colour of its own.
 */

${imports}

export default {
  label: '${label}',${namespace ? `\n  namespace: '${namespace}',` : ''}${themeId ? `\n  themeId: '${themeId}',` : ''}

  // The inspector form is generated from this list — no form code to write.
  // Every \`type\` must be one of the declared field types; see
  // shared/slide-types/field-types.js.
  fields: [
${fieldLines}
  ],

  // A default per field, so a freshly inserted slide is valid immediately.
  defaults: {
${defaultLines}
  },

  // Which field names the slide in the deck outline.
  labelField: '${labelField}',

  // One root element, carrying \`.${rootClass}\`, with every selector in
  // your stylesheet nested under it — that is what keeps a custom type from
  // restyling deck chrome.
  renderHtml(content) {
    return \`
      <div class="slide ${rootClass}">
        <div class="slide-inner">
${fields.map(renderLineFor).join('\n')}
        </div>
      </div>
    \`;
  },

  // Uncomment to make the fields above click-to-edit on the canvas. This object
  // travels to the browser as JSON, so every value must be JSON-safe — a
  // function here is silently dropped. Grammar:
  // client/views/editor/inline-edit/descriptors.js.
  //
  // inline: {
  //   formText: [${fields.map((f) => `'${f.key}'`).join(', ')}],
  // },

  // Uncomment to tell the AI wizard and MCP agents when to reach for this type.
  // \`ai: false\` instead hides it from them entirely.
  //
  // ai: {
  //   category: 'content',
  //   description: 'What this slide is for, in a sentence or two.',
  //   bestFor: ['…'],
  //   notFor: ['…'],
  // },
};
`;
}

/**
 * The stylesheet stub. Lands in `custom/styles/`, the fork CSS seam that loads
 * after all core CSS on every render path — not in `client/styles/slides/`,
 * which is core-owned and whose aggregators are generated.
 *
 * @param {string} name
 * @param {string} label
 * @returns {string}
 */
export function cssSource(name, label) {
  const rootClass = `slide-${canonicalTypeName(name)}`;
  return `/* ${label} — every selector nested under the type's own root, so this
   file cannot restyle anything outside its slides. Colours come from theme
   tokens (--t-*), which is what makes the type look designed on every theme. */

.${rootClass} .slide-inner {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  justify-content: center;
}

.${rootClass} h2 {
  color: var(--t-heading, var(--t-text));
}
`;
}

/** Ask one question with a default; returns the default on empty input. */
async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || fallback;
}

async function main() {
  const opts = parseArgs(process.argv);
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;

  let name = opts.name;
  if (!name && interactive) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    name = (
      await rl.question('Type name (kebab, e.g. acme-hero-slide): ')
    ).trim();
    rl.close();
  }
  if (!NAME_RE.test(name)) {
    fail(
      `"${name || ''}" is not a usable type name.\n` +
        'Use lowercase letters, digits and dashes, starting with a letter or ' +
        'digit — e.g. `acme-hero-slide`.',
    );
  }
  if (CORE_SLIDE_TYPE_NAMES.includes(name)) {
    fail(
      `"${name}" is a core slide type. The registry keeps core and refuses a ` +
        'custom type of the same name unless it declares `override: true`, so ' +
        'pick another name (or add the flag by hand once the file exists).',
    );
  }

  let label = opts.label;
  let fieldSpec = opts.fields;
  if (interactive && (!label || !fieldSpec)) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      label = label || (await ask(rl, 'Label', labelFromName(name)));
      fieldSpec =
        fieldSpec ||
        (await ask(rl, 'Fields (key:type,…)', 'heading:string,body:markdown'));
    } finally {
      rl.close();
    }
  }
  label = label || labelFromName(name);
  const { fields, errors } = parseFields(
    fieldSpec || 'heading:string,body:markdown',
  );
  if (errors.length)
    fail(`Cannot use that field list:\n  - ${errors.join('\n  - ')}`);

  const target = path.join(SLIDE_TYPES_DIR, `${name}.js`);
  if (existsSync(target) && !opts.force) {
    fail(`${rel(target)} already exists. Pass --force to overwrite it.`);
  }
  mkdirSync(SLIDE_TYPES_DIR, { recursive: true });
  writeFileSync(
    target,
    moduleSource({
      name,
      label,
      fields,
      themeId: opts.themeId,
      namespace: opts.namespace,
    }),
  );

  // Prove the scaffold rather than promise it: import what was just written and
  // run the same validator the loader runs at startup.
  const mod = await import(pathToFileURL(target).href);
  const report = validateSlideTypeDefinition(mod.default, name, {
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
    coreNames: CORE_SLIDE_TYPE_NAMES,
  });
  if (report.errors.length) {
    console.error(`\nThe generated type does NOT validate — this is a bug in`);
    console.error(`scripts/new-slide-type.js, not in your input:\n`);
    console.error(formatDefinitionReport(report).join('\n'));
    process.exitCode = 1;
    return;
  }

  const written = [rel(target)];
  let cssFile = null;
  if (opts.css) {
    mkdirSync(STYLES_DIR, { recursive: true });
    cssFile = path.join(STYLES_DIR, `${nextCssPrefix()}-${name}.css`);
    if (existsSync(cssFile) && !opts.force) {
      console.warn(
        `Kept the existing ${rel(cssFile)} (pass --force to replace).`,
      );
    } else {
      writeFileSync(cssFile, cssSource(name, label));
      written.push(rel(cssFile));
    }
  }

  console.log(`\nCreated:`);
  for (const f of written) console.log(`  ${f}`);
  console.log(`\nThe definition validates clean.`);
  if (report.warnings.length) {
    console.log(`Worth a look:\n${formatDefinitionReport(report).join('\n')}`);
  }
  console.log(`\nNext:`);
  console.log(`  1. Restart the server (npm run start).`);
  console.log(`  2. "${label}" appears in the editor's slide picker.`);
  if (cssFile) {
    console.log(
      `  3. Edit ${rel(cssFile)} — custom/styles/ is loaded after all core CSS\n` +
        `     on every render path, so there is no @import to add.`,
    );
  }
  console.log(`\nDocs: docs/developer/slide-types.md`);
}

/** The next free numeric prefix in custom/styles/, so the cascade is explicit. */
function nextCssPrefix() {
  if (!existsSync(STYLES_DIR)) return '10';
  const used = readdirSync(STYLES_DIR)
    .map((f) => /^(\d+)-/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const next = used.length ? Math.max(...used) + 10 : 10;
  return String(next).padStart(2, '0');
}

/** Repo-relative path, for messages a reader can paste. */
function rel(p) {
  return path.relative(REPO_ROOT, p);
}

/** Print and exit non-zero. */
function fail(message) {
  console.error(message);
  process.exit(1);
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not.
// The guard is also what lets tests/new-slide-type-scaffold.test.js import the
// template builders above without scaffolding a type as a side effect.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

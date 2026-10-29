/**
 * Guard: the tenant entity is `organization`, a deck's audience is its
 * `visibility` — one word per meaning (D10+D11, B41-a; register in
 * docs/reference/vocabulary.md).
 *
 * Pins the loser spellings to zero in code so they cannot creep back:
 *
 *   - `'workspace'` as a quoted value (the old visibility value / tab id)
 *   - the old flag family        MULTI_WORKSPACE_ENABLED, isMultiWorkspaceEnabled,
 *                                requireMultiWorkspace, singleWorkspaceScope
 *   - Workspace-identifier forms isWorkspace…, …WorkspaceRole, workspace-role
 *   - scope-as-visibility names  normalizePresentationScope,
 *                                canChangePresentationScope, allowScopeChange
 *   - the old event spellings    presentation.moved_to_workspace,
 *                                presentationMovedToWorkspaceUrl
 *
 * **UI text (D365).** The UI says organization too: no i18n value in any
 * locale and no English `t()` fallback names the tenant with the word for
 * workspace, in English or in the locale's own language. Key names that
 * predate the rule (`list.visibility.workspace`) are identifiers and stay.
 * Unquoted prose in comments is not scanned. `server/db/migrations` is excluded as the
 * historical record (it owns the rename migrations and describes the old
 * names). `scope` itself is not a needle: it legitimately remains the
 * storage-scope concept and a handful of filter/shelf axes listed in
 * docs/reference/vocabulary.md.
 *
 * **Doc prose (B88).** The rule covers docs too, so `docs/reference/**.md` is
 * scanned for the tenant entity spelled "workspace" outside the label rule.
 * Two exemptions: `vocabulary.md` is the register and must name the loser
 * spelling to forbid it; `notion-import.md`
 * describes *Notion's* workspace, a third-party product's own concept rather
 * than ours. Since D365 the needle ignores case: there is no UI label left to
 * cite.
 *
 * Run with: node --test tests/organization-vocabulary.test.js
 */

import test from 'node:test';
import { walkFiles } from './helpers/walk-files.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFallbackSites } from '../scripts/lib/i18n-keys.js';
import { CLIENT_DIR, I18N_DIR, loadLocale } from '../scripts/lib/i18n-fs.js';
import { LOCALE_IDS, REFERENCE_LOCALE } from '../scripts/lib/i18n-locales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const TARGET_DIRS = [
  'client',
  'server',
  'shared',
  'scripts',
  'capture',
  'tests',
];
const EXCLUDED_DIRS = new Set([
  path.join('server', 'db', 'migrations'),
  path.join('client', 'vendor'),
]);
const SELF = 'organization-vocabulary.test.js';

// Needles built from fragments so this guard file does not match its own text.
const W = 'work' + 'space';
const FORBIDDEN = [
  {
    label: `quoted '${W}' value (visibility value is 'organization')`,
    re: new RegExp(`['"]${W}['"]`),
  },
  {
    label: `MULTI_${W.toUpperCase()}_ENABLED (use MULTI_ORG_ENABLED)`,
    re: new RegExp(`MULTI_${W.toUpperCase()}_ENABLED`),
  },
  {
    label: `isMulti${W[0].toUpperCase()}${W.slice(1)}Enabled (use isMultiOrgEnabled)`,
    re: new RegExp(`isMulti${W[0].toUpperCase()}${W.slice(1)}Enabled`),
  },
  {
    label: `requireMulti${W[0].toUpperCase()}${W.slice(1)} (use requireMultiOrg)`,
    re: new RegExp(`requireMulti${W[0].toUpperCase()}${W.slice(1)}`),
  },
  {
    label: `single${W[0].toUpperCase()}${W.slice(1)}Scope (use singleOrganizationScope)`,
    re: new RegExp(`single${W[0].toUpperCase()}${W.slice(1)}Scope`),
  },
  {
    label: `${W}-as-identifier (is${W[0].toUpperCase()}${W.slice(1)}…, ${W}-role — use organization)`,
    re: new RegExp(
      `is${W[0].toUpperCase()}${W.slice(1)}|${W[0].toUpperCase()}${W.slice(1)}Role|${W}-role`,
    ),
  },
  {
    label:
      'normalizePresentation' + 'Scope (use normalizePresentationVisibility)',
    re: new RegExp('normalizePresentation' + 'Scope'),
  },
  {
    label:
      'canChangePresentation' + 'Scope (use canChangePresentationVisibility)',
    re: new RegExp('canChangePresentation' + 'Scope'),
  },
  {
    label: 'allowScope' + 'Change (use allowVisibilityChange)',
    re: new RegExp('allowScope' + 'Change'),
  },
  {
    label: `moved_to_${W} event (use presentation.moved_to_organization)`,
    re: new RegExp(`moved_to_${W}`),
  },
  {
    label: `presentationMovedTo${W[0].toUpperCase()}${W.slice(1)}Url (use presentationMovedToOrganizationUrl)`,
    re: new RegExp(`presentationMovedTo${W[0].toUpperCase()}${W.slice(1)}Url`),
  },
];

function walk(dir) {
  return walkFiles(dir, {
    extensions: ['.js'],
    skipEntry: (entry, full) =>
      entry.isDirectory() && EXCLUDED_DIRS.has(path.relative(repoRoot, full)),
  }).filter((file) => path.basename(file) !== SELF);
}

test('organization vocabulary: no workspace/scope-as-visibility spellings survive in code', () => {
  const violations = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { label, re } of FORBIDDEN) {
          if (re.test(line))
            violations.push(`${rel}:${i + 1}  [${label}]  ${line.trim()}`);
        }
      });
    }
  }
  assert.equal(
    violations.length,
    0,
    `One word per meaning (docs/reference/vocabulary.md):\n  ${violations.join('\n  ')}`,
  );
});

test('the public contract carries visibility, not scope-as-visibility', () => {
  const openapi = fs.readFileSync(
    path.join(repoRoot, 'docs', 'openapi.yaml'),
    'utf8',
  );
  assert.ok(
    !new RegExp(W, 'i').test(openapi),
    `docs/openapi.yaml still mentions ${W}`,
  );
  assert.ok(
    /visibility:\s*\n\s+type: string\s*\n\s+enum: \[private, organization\]/.test(
      openapi,
    ),
    'docs/openapi.yaml must document the visibility field with enum [private, organization]',
  );
});

// ─── UI text (D365) ─────────────────────────────────────────────────────────

// Each locale's word for workspace, the loser of D365. The English needle
// runs in every locale too: an untranslated or borrowed "workspace" is as
// wrong in nl as in en.
const UI_LOSER = {
  da: /arbejdsområde/i,
  de: /arbeitsbereich/i,
  es: /espacio de trabajo/i,
  fi: /työtil/i,
  fr: /espace de travail/i,
  it: /spazio di lavoro|area di lavoro/i,
  nl: /werkruimte/i,
  no: /arbeidsområde/i,
  pl: /przestrze[nń]\S* robocz|obszar\S* robocz/i,
  pt: /espaço de trabalho|área de trabalho/i,
  sv: /arbetsyt/i,
};
const UI_ENGLISH = new RegExp(W, 'i');

test('organization vocabulary: every locale names the tenant organization in the UI (D365)', async () => {
  const violations = [];
  for (const locale of LOCALE_IDS) {
    const strings = await loadLocale(I18N_DIR, locale);
    for (const [key, value] of Object.entries(strings)) {
      if (typeof value !== 'string') continue;
      if (UI_ENGLISH.test(value) || UI_LOSER[locale]?.test(value))
        violations.push(`${locale}  ${key}  ${value}`);
    }
  }
  for (const site of await collectFallbackSites(CLIENT_DIR)) {
    if (UI_ENGLISH.test(site.fallback)) {
      const rel = path.relative(repoRoot, site.file).split(path.sep).join('/');
      violations.push(`${rel}:${site.line}  ${site.key}  ${site.fallback}`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `The UI says organization (D365, docs/reference/vocabulary.md):\n  ${violations.join('\n  ')}`,
  );
});

test('the UI needles cover every locale but the reference', () => {
  const uncovered = LOCALE_IDS.filter(
    (id) => id !== REFERENCE_LOCALE && !UI_LOSER[id],
  );
  assert.deepEqual(
    uncovered,
    [],
    'add the locale word for workspace to UI_LOSER',
  );
});

// ─── doc prose (B88) ────────────────────────────────────────────────────────

const DOC_DIR = path.join('docs', 'reference');
const DOC_EXEMPT = new Set([
  // The register itself: it names the loser spelling in order to forbid it.
  'vocabulary.md',
  // Notion's own workspace concept, not ours.
  'notion-import.md',
]);

// `workspace` naming *our* tenant, in any case: since D365 the UI no longer
// carries a "Workspace" label that prose could cite.
const DOC_FORBIDDEN = [
  {
    label: `${W} as the tenant entity in prose (use organization)`,
    re: new RegExp(`\\b${W}\\b`, 'i'),
  },
];

function referenceDocs() {
  const out = [];
  (function walkDocs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDocs(full);
      else if (entry.name.endsWith('.md') && !DOC_EXEMPT.has(entry.name))
        out.push(full);
    }
  })(path.join(repoRoot, DOC_DIR));
  return out;
}

test('organization vocabulary: reference prose names the tenant organization, not workspace', () => {
  const violations = [];
  for (const file of referenceDocs()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { label, re } of DOC_FORBIDDEN) {
        if (re.test(line))
          violations.push(`${rel}:${i + 1}  [${label}]  ${line.trim()}`);
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `One word per meaning (docs/reference/vocabulary.md):\n  ${violations.join('\n  ')}`,
  );
});

test('the doc-prose exemptions still exist, so the list cannot rot', () => {
  for (const name of DOC_EXEMPT) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, DOC_DIR, name)),
      `${DOC_DIR}/${name} is exempt but no longer exists`,
    );
  }
});

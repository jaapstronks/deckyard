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
 * Deliberately NOT forbidden ("workspace" as prose): user-visible label
 * strings — i18n JSON values and capitalized "Workspace" fallbacks in `t()`
 * calls — are exactly where D11 says the word lives, and unquoted prose in
 * comments may cite the label. `server/db/migrations` is excluded as the
 * historical record (it owns the rename migrations and describes the old
 * names). `scope` itself is not a needle: it legitimately remains the
 * storage-scope concept and a handful of filter/shelf axes listed in
 * docs/reference/vocabulary.md.
 *
 * **Doc prose (B88).** The rule covers docs too, so `docs/reference/**.md` is
 * scanned for the tenant entity spelled "workspace" outside the label rule.
 * Three exemptions, each for its own reason: `vocabulary.md` is the register
 * and must name the loser spelling to forbid it; `collab-research.md` is a
 * deliberately frozen phase-0 snapshot (the same allowlist reason
 * `tests/docs-paths-resolvable.test.js` carries); and `notion-import.md`
 * describes *Notion's* workspace, a third-party product's own concept rather
 * than ours. Capitalized "Workspace" as the UI label stays legal in prose,
 * exactly as it does in code.
 *
 * Run with: node --test tests/organization-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(rel)) continue;
      walk(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.js') &&
      entry.name !== SELF
    ) {
      out.push(full);
    }
  }
  return out;
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

// ─── doc prose (B88) ────────────────────────────────────────────────────────

const DOC_DIR = path.join('docs', 'reference');
const DOC_EXEMPT = new Set([
  // The register itself: it names the loser spelling in order to forbid it.
  'vocabulary.md',
  // A deliberately frozen phase-0 snapshot, allowlisted the same way in
  // tests/docs-paths-resolvable.test.js.
  'collab-research.md',
  // Notion's own workspace concept, not ours.
  'notion-import.md',
]);

// Lower-case `workspace` naming *our* tenant. The capitalized "Workspace" is
// the sanctioned UI label (D11), so it stays legal in prose the way it is in
// code; this needle only fires on the lower-case noun.
const DOC_FORBIDDEN = [
  {
    label: `${W} as the tenant entity in prose (use organization; "Workspace" is the UI label only)`,
    re: new RegExp(`\\b${W}\\b`),
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

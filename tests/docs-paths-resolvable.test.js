/**
 * The guardrail that keeps file paths in the documentation resolvable.
 *
 * Behaviour-preserving reorganisations rot the docs silently: moving
 * `client/lib/x.js` into `client/lib/y/x.js` is green in CI and leaves every doc
 * that named the old path pointing at nothing. The 2026-07-27 docs audit found 21
 * such dead paths — the `client/lib/` split into sub-folders and the storage seam
 * of #408 — and `AGENTS.md` and `CLAUDE.md` were among the offenders, the very
 * files a session reads before structural work. The audit repaired them; this is
 * the gate that stops it coming back.
 *
 * It mirrors `tests/removed-slide-types.test.js` and its two-way honesty: no dead
 * path survives unexplained, and no allowlist entry outlives the reference it
 * excuses.
 *
 * Run with: node --test tests/docs-paths-resolvable.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real top-level directories a cited path can start with. */
const TOP_LEVEL_DIRS = ['assets', 'client', 'docs', 'scripts', 'server', 'shared', 'tests', 'themes'];

/**
 * Gitignored roots that only exist once the app has been installed or run:
 * `server/data/` + `server/uploads/` (created on first run) and
 * `assets/fonts/google/` (fetched by the `postinstall` hook). The docs name them
 * precisely *because* they are not in the tree — backup targets, volume mounts,
 * `chown` targets, the reason the export smoke test wants a normal checkout. They
 * are permanently absent by design, so this is a skip, not an allowlist entry
 * that could ever go stale.
 */
const GITIGNORED_RUNTIME_ROOTS = ['server/data/', 'server/uploads/', 'assets/fonts/google/'];

/**
 * Doc trees this gate does not read and does not require links into.
 *
 * `docs/plans/` is upstream's own: a gitignored symlink to the private planning
 * repo, absent on a fresh clone, so scanning it would fail everywhere and citing
 * into it must not fail here.
 *
 * **A fork adds its own private tree to this list.** That is the whole reason it
 * is a constant. Upstream hardcoded `docs/plans/` in three places, so a fork with
 * a `docs/internal/` failed this gate on every item in it and had to patch the
 * test itself — a patch that then had to be re-defended at every merge. One list,
 * one line to add. (Fork-upgrade finding B6.)
 *
 * A prefix here means three things at once, and they belong together: the tree is
 * not scanned for citations, citations *into* it are skipped, and its docs are
 * not required to be linked from elsewhere.
 */
const EXCLUDED_DOC_TREES = ['docs/plans/'];

/**
 * @param {string} rel repo-relative path
 * @returns {boolean} whether it sits in a tree this gate ignores
 */
const isExcludedDocPath = (rel) => EXCLUDED_DOC_TREES.some((d) => rel.startsWith(d));

/**
 * Docs the gate reads. Prose that ships with the repo, minus the private trees in
 * {@link EXCLUDED_DOC_TREES}: `docs/**` outside those, plus the four anchor files
 * at the root.
 */
const isDocFile = (rel) =>
  rel.endsWith('.md') &&
  (['AGENTS.md', 'CLAUDE.md', 'README.md', 'ROADMAP.md'].includes(rel) ||
    (rel.startsWith('docs/') && !isExcludedDocPath(rel)));

/**
 * Cited paths that resolve to nothing yet are correct as written.
 *
 * Two categories, each keyed with a reason so neither becomes a junk drawer.
 * `<type>.js`-style angle-bracket templates and `client/lib/*` globs never reach
 * here — they are filtered as patterns, not paths. What lands here is the residue
 * that *looks* like a real path.
 */

/**
 * 1. Tutorial placeholders — pedagogical fiction. A how-to names a file the reader
 *    is about to create, so it cannot exist in the tree.
 */
const TUTORIAL_PLACEHOLDERS = {
  'client/lib/slide-runtime/my-slide.js':
    'slide-types.md walks the reader through creating this runtime module',
  'docs/internal/':
    "fork-setup.md's example of a fork's own private doc tree, added to EXCLUDED_DOC_TREES",
  'client/styles/slides/my-slide.css':
    'contributing.md example CSS for a slide type the reader is adding',
  'client/styles/slides/custom/my-title-slide.css':
    'slide-types.md example of fork-custom slide CSS',
  'client/views/editor/editor-form/slide-forms/my-slide.js':
    'slide-types.md example of a slide side-form the reader is adding',
  'server/routes/api/my-feature.js':
    'contributing.md example route for a feature the reader is adding',
  'server/storage/X/index.js':
    'AGENTS.md placeholder for the folder/index.js seam a decomposed store ships as',
  'shared/slide-types/types/my-slide.js':
    'contributing.md example slide-type registry entry the reader is adding',
};

/**
 * 2. Frozen-snapshot docs — a dated report describes the tree as it was. Rewriting
 *    its module paths would falsify it, so any otherwise-dead path cited *only*
 *    from one of these files is excused. A path also cited from a live doc still
 *    fails there.
 */
const FROZEN_SNAPSHOT_DOCS = {
  'docs/reference/collab-research.md':
    'a dated phase-0 research snapshot; its module paths are historical and its banner says so',
};

/**
 * Every git-tracked file, repo-relative. Tracking draws the source/artifact line
 * exactly where `.gitignore` already draws it, and gives a machine-stable oracle
 * for whether a cited path resolves. Falls back to a walk when git is unavailable
 * (a tarball deploy); the guard test below fails loudly on a zero-file scan.
 */
function collectTracked() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split('\0').filter(Boolean);
  } catch {
    // No git: walk the repo.
  }
  const out = [];
  const walk = (relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(REPO_ROOT, relDir || '.'), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk('');
  return out;
}

const TRACKED = collectTracked();
const TRACKED_FILES = new Set(TRACKED);
const TRACKED_DIRS = new Set();
for (const f of TRACKED) {
  let d = f;
  while (d.includes('/')) {
    d = d.slice(0, d.lastIndexOf('/'));
    TRACKED_DIRS.add(d);
  }
}
const DOC_FILES = TRACKED.filter(isDocFile);

/**
 * A cited path resolves if it is a tracked file or a tracked directory.
 *
 * Deliberately *not* an `fs.existsSync` check: the working tree of a machine that
 * has run the app holds gitignored runtime output (`server/data/`, build
 * artefacts, scratch files) that a fresh clone and CI do not. Falling back to disk
 * would make the gate machine-dependent in both directions — a genuinely dead path
 * that happens to exist locally would pass here and fail in CI. `TRACKED` is the
 * one oracle, and on a tarball deploy `collectTracked()` already degrades to a
 * walk.
 */
function pathResolves(rel) {
  const bare = rel.replace(/\/+$/, ''); // docs cite directories as `client/lib/`
  return TRACKED_FILES.has(bare) || TRACKED_DIRS.has(bare);
}

/**
 * Every literal, checkable file path a doc cites in backticks.
 *
 * Skipped as "not a literal path to resolve":
 * - glob / angle-bracket / brace templates (`client/lib/*`, `<type>.js`, `{en,nl}`);
 * - anything under {@link EXCLUDED_DOC_TREES} — upstream's `docs/plans/` is a
 *   gitignored symlink to the private planning repo, absent on a fresh clone,
 *   and a fork adds its own private tree there;
 * - `client/i18n/**` — generated translation payloads, gitignored (the same
 *   exclusion `removed-slide-types.test.js` makes);
 * - the gitignored runtime roots above — absent in CI and on a fresh clone by
 *   design, so a citation of one is correct, not dead.
 */
function citedPaths() {
  const backtick = /`([^`\n]+)`/g;
  const out = []; // { p, doc }
  for (const doc of DOC_FILES) {
    const text = fs.readFileSync(path.join(REPO_ROOT, doc), 'utf8');
    let m;
    while ((m = backtick.exec(text))) {
      let tok = m[1].trim().split(/\s+/)[0]; // a path plus a CLI arg → keep the path
      tok = tok.replace(/[:#].*$/, ''); // drop :line / #anchor
      tok = tok.replace(/[.,;)]+$/, ''); // drop trailing sentence punctuation
      if (!TOP_LEVEL_DIRS.some((d) => tok.startsWith(`${d}/`))) continue;
      if (/[*?<>{}|]/.test(tok) || tok.includes('…')) continue; // a pattern, not a path
      if (isExcludedDocPath(tok)) continue; // a tree this gate does not own
      if (tok.startsWith('client/i18n/')) continue; // generated payloads
      if (GITIGNORED_RUNTIME_ROOTS.some((d) => tok === d || tok.startsWith(d))) continue;
      out.push({ p: tok, doc });
    }
  }
  return out;
}

const CITATIONS = citedPaths();

test('the scan actually sees the docs', () => {
  // A silent zero-file scan would make every assertion below vacuously pass.
  assert.ok(DOC_FILES.length > 20, `expected a populated doc scan, got ${DOC_FILES.length} files`);
  assert.ok(CITATIONS.length > 50, `expected the docs to cite many paths, got ${CITATIONS.length}`);
  assert.ok(pathResolves('client/lib/dom.js'), 'sanity: a known-live path resolves');
});

test('every backtick file path in the docs resolves, or is allowlisted', () => {
  const leftovers = CITATIONS.filter(({ p, doc }) => {
    if (pathResolves(p)) return false;
    if (Object.hasOwn(TUTORIAL_PLACEHOLDERS, p)) return false;
    if (Object.hasOwn(FROZEN_SNAPSHOT_DOCS, doc)) return false;
    return true;
  });
  assert.deepEqual(
    leftovers.map(({ p, doc }) => `${p}  (in ${doc})`),
    [],
    `these documented paths do not exist in the working tree:\n` +
      leftovers.map(({ p, doc }) => `  - ${p}  (in ${doc})`).join('\n') +
      `\n\nEither fix the path, or — if it is deliberate — add it to ` +
      `TUTORIAL_PLACEHOLDERS (a fictional path) or FROZEN_SNAPSHOT_DOCS (a dated ` +
      `snapshot doc) in tests/docs-paths-resolvable.test.js, with a reason.`
  );
});

test('no tutorial placeholder has quietly become real or uncited (the allowlist cannot rot)', () => {
  const cited = new Set(CITATIONS.map(({ p }) => p));
  for (const [p, why] of Object.entries(TUTORIAL_PLACEHOLDERS)) {
    assert.ok(
      cited.has(p),
      `TUTORIAL_PLACEHOLDERS lists "${p}" (${why}) but no doc cites it any more — drop the entry.`
    );
    assert.ok(
      !pathResolves(p),
      `TUTORIAL_PLACEHOLDERS lists "${p}" but that path now exists — it is no longer fiction, drop the entry.`
    );
  }
});

test('every frozen-snapshot doc still exists and still shelters a dead path', () => {
  const docSet = new Set(DOC_FILES);
  for (const [doc, why] of Object.entries(FROZEN_SNAPSHOT_DOCS)) {
    assert.ok(
      docSet.has(doc),
      `FROZEN_SNAPSHOT_DOCS lists "${doc}" (${why}) but it is not a scanned doc — drop the entry.`
    );
    const shelters = CITATIONS.some(
      ({ p, doc: d }) => d === doc && !pathResolves(p) && !Object.hasOwn(TUTORIAL_PLACEHOLDERS, p)
    );
    assert.ok(
      shelters,
      `FROZEN_SNAPSHOT_DOCS lists "${doc}" but every path it cites now resolves — the exemption is moot, drop the entry.`
    );
  }
});

test('every allowlist entry carries a real reason', () => {
  for (const [key, why] of [
    ...Object.entries(TUTORIAL_PLACEHOLDERS),
    ...Object.entries(FROZEN_SNAPSHOT_DOCS),
  ]) {
    assert.ok(
      typeof why === 'string' && why.trim().length > 10,
      `allowlist entry "${key}" needs a real reason, not "${why}"`
    );
  }
});

/**
 * Second half: every doc file is reachable by a link, so the hand-maintained index
 * in `docs/README.md` cannot silently fall behind the folder. This guards *that*
 * a doc is linked, not *where* — the cheap check the item asked for, over a
 * generator.
 */

/** Repo-relative link targets reachable from any scanned doc's markdown links. */
function linkedTargets() {
  const link = /\]\(([^)]+)\)/g;
  const linked = new Set();
  for (const doc of DOC_FILES) {
    const dir = path.dirname(doc);
    const text = fs.readFileSync(path.join(REPO_ROOT, doc), 'utf8');
    let m;
    while ((m = link.exec(text))) {
      let href = m[1].trim().split(/\s+/)[0]; // drop an optional "title"
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue; // URL / anchor
      href = href.replace(/[#?].*$/, '');
      if (!href) continue;
      linked.add(path.normalize(path.join(dir, href)));
    }
  }
  return linked;
}

test('every doc under docs/ is linked from somewhere', () => {
  // README.md files are directory entry points — they do the linking, and are not
  // themselves required to have an inbound link.
  const targets = TRACKED.filter(
    (r) =>
      r.startsWith('docs/') &&
      !isExcludedDocPath(r) &&
      r.endsWith('.md') &&
      path.basename(r) !== 'README.md'
  );
  const linked = linkedTargets();
  const orphans = targets.filter((t) => !linked.has(t));
  assert.deepEqual(
    orphans,
    [],
    `these docs are not linked from any other doc — add them to the index in ` +
      `docs/README.md (or another doc):\n` +
      orphans.map((t) => `  - ${t}`).join('\n')
  );
});

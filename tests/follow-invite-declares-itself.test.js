/**
 * Guard: the follow-along invite declares itself; no module knows her name.
 *
 * B401 showed the form that holds: `library: false` on the type, read by one
 * predicate, instead of `slide.type === 'follow-invite-slide'` in the editor
 * and the library routes. B413 is the sweep over the dozen branches that were
 * still asking by name. Each now asks a facet of the declaration:
 *
 *   - `liveOnly: true` (`isLiveOnlySlideType`, `firstPublicSlide`) — every
 *     output that outlives the session: strip, exports, preview image.
 *   - `liveInvite: true` (`isLiveInviteSlideType`, `liveInviteSlideType`) —
 *     the audience's way in: the editor's suggestion and insertion, the
 *     presenter's join codes and in-place switch, the follow view's
 *     confirmation, the save path's normalization.
 *   - `ai: false` (`agentWithheldTypesRule`) — the prompts' prohibition.
 *
 * The first test is the sweep itself: outside the definition, the registries
 * and the one bespoke form registration, the literal appears in no code of
 * `client/`, `server/` or `shared/` (comments stripped). Putting one branch
 * back turns it red. The rest pins the declarations the readers rely on.
 *
 * Run with: node --test tests/follow-invite-declares-itself.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_SLIDE_TYPE_DEFS,
  SLIDE_TYPES,
} from '../shared/slide-types/registry.js';
import {
  isLiveInviteSlideType,
  isLiveOnlySlideType,
  liveInviteSlideType,
} from '../shared/slide-types/live-session.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';
import { firstPublicSlide } from '../server/utils/public-output.js';
import {
  agentWithheldTypeNames,
  agentWithheldTypesRule,
} from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { buildSlideTypesPrompt } from '../server/utils/openai/slide-types-prompt.js';
import { buildPhase2CatalogPrompt } from '../server/utils/ai/slide-type-catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const INVITE = 'follow-invite-slide';
const SOURCE_TREES = ['client', 'server', 'shared'];
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

/**
 * Where the name may still be spelled out, and why:
 *
 *   - the definition and its companions — it is her name;
 *   - the registry and the two generated companion aggregators — they key
 *     every type by name;
 *   - the bespoke form registration — the one form that is not derived from
 *     `fields[]`, registered by name on purpose (`fields: []` by design);
 *   - the two display-order hints — they name every type on a shelf in the
 *     order the surface prefers and decide nothing about any of them
 *     (membership comes from `group` in the authoring companion;
 *     `tests/follow-invite-insertability.test.js` pins the invite is listed).
 */
const ALLOWED = [
  'shared/slide-types/types/follow-invite-slide.js',
  'shared/slide-types/types/follow-invite-slide/',
  'shared/slide-types/registry.js',
  'shared/slide-types/authoring.js',
  'shared/slide-types/inline-edit.js',
  'client/views/editor/editor-form/slide-form-router.js',
  'client/views/editor/slide-type-picker/data.js',
  'client/views/settings/tabs/slide-types-tab/categories.js',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Drop block and line comments; a `//` after a `:` is a URL, not a comment. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function isAllowed(rel) {
  return ALLOWED.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));
}

test('outside the definition, the registries and the bespoke form, no code names the invite', () => {
  const offenders = [];
  for (const tree of SOURCE_TREES) {
    for (const file of walk(path.join(repoRoot, tree))) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      if (isAllowed(rel)) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (line.includes(INVITE))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a module branches on the invite by name; ask a facet of the declaration instead ' +
      '(liveOnly, liveInvite, ai) — shared/slide-types/live-session.js',
  );
});

test('the invite is the one core type that declares liveInvite, and it is liveOnly', () => {
  const invites = Object.entries(CORE_SLIDE_TYPE_DEFS)
    .filter(([, def]) => def.liveInvite === true)
    .map(([name]) => name);
  assert.deepEqual(invites, [INVITE]);
  assert.equal(CORE_SLIDE_TYPE_DEFS[INVITE].liveOnly, true);

  assert.equal(liveInviteSlideType(), INVITE);
  assert.equal(isLiveInviteSlideType(INVITE), true);
  assert.equal(isLiveOnlySlideType(INVITE), true);
  assert.equal(isLiveInviteSlideType('content-slide'), false);
  assert.equal(isLiveOnlySlideType('content-slide'), false);
  assert.equal(isLiveInviteSlideType(undefined), false);
  // The same seam the registry opens everywhere: a map without an invite
  // type has none to insert.
  assert.equal(liveInviteSlideType({ 'content-slide': {} }), '');
});

test('an invite that would outlive the session is a validator warning', () => {
  const base = { ...SLIDE_TYPES[INVITE] };
  const ok = validateSlideTypeDefinition(base, INVITE);
  assert.deepEqual(
    ok.warnings.filter((w) => /liveInvite|liveOnly/.test(w)),
    [],
  );

  const outliving = { ...base, liveOnly: undefined };
  const report = validateSlideTypeDefinition(outliving, INVITE);
  assert.ok(
    report.warnings.some((w) => /liveInvite: true.*without.*liveOnly/.test(w)),
    report.warnings.join('\n'),
  );

  const spelled = { ...base, liveInvite: 'yes' };
  assert.ok(
    validateSlideTypeDefinition(spelled, INVITE).warnings.some((w) =>
      /`liveInvite` only takes `true`/.test(w),
    ),
  );
});

test('the preview image is rendered from the first slide that outlives the session', () => {
  const invite = { type: INVITE, content: {} };
  const title = { type: 'title-slide', content: { title: 'A' } };
  assert.equal(firstPublicSlide({ slides: [invite, title] }), title);
  assert.equal(firstPublicSlide({ slides: [null, invite, title] }), title);
  assert.equal(firstPublicSlide({ slides: [invite] }), null);
  assert.equal(firstPublicSlide({}), null);
});

test('the prompts forbid the withheld types by declaration, not by name', () => {
  assert.ok(agentWithheldTypeNames().includes(INVITE));
  const rule = agentWithheldTypesRule();
  assert.match(rule, /^IMPORTANT: Do NOT output "/);
  assert.ok(rule.includes(`"${INVITE}"`));
  assert.equal(agentWithheldTypesRule({ 'content-slide': { fields: [] } }), '');

  // Both catalog prompts end with it, so the per-prompt copies could go.
  assert.ok(buildSlideTypesPrompt().trimEnd().endsWith(rule));
  assert.ok(buildPhase2CatalogPrompt().trimEnd().endsWith(rule));
});

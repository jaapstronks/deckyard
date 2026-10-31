/**
 * The launch video's takes: the terminal payoff and the five app clips.
 *
 * What is checkable without a browser is what the take *claims*: that the
 * terminal prints the stack `docker-compose.yml` actually defines, that the
 * audience's votes add up to the result the poll shot photographs, and that
 * the `-nl` and `-en` halves of each pair film the same choreography.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isVideoRecipe, validateRecipe } from '../capture/lib/recipe.js';
import { RECIPES } from '../capture/recipes/index.js';
import composeUp, {
  COMPOSE_COMMAND,
  composeContainers,
  composeOutput,
} from '../capture/recipes/compose-up.js';
import {
  commentResolveTake,
  editorTourTake,
  pollArrivals,
  presenterNotesTake,
  themeColoursTake,
} from '../capture/recipes/_launch-takes.js';
import { MARKETING_POLL_VOTES } from '../capture/recipes/_marketing-deck.js';

/**
 * Drive a take's sequence against a recorder that only remembers.
 * @param {import('../capture/lib/recipe.js').VideoRecipe} take
 */
async function replay(take) {
  /** @type {Array<Record<string, unknown>>} */
  const steps = [];
  await take.record.sequence({
    hold: async (ms) => void steps.push({ kind: 'hold', ms }),
    move: async (selector, o = {}) =>
      void steps.push({ kind: 'move', selector, ...o }),
    click: async (selector, o = {}) =>
      void steps.push({ kind: 'click', selector, ...o }),
    type: async (selector, text, o = {}) =>
      void steps.push({ kind: 'type', selector, text, ...o }),
  });
  return steps;
}

const LAUNCH_TAKES = [
  'compose-up',
  ...[
    'editor-tour',
    'theme-colours',
    'poll-votes',
    'comment-resolve',
    'presenter-notes',
  ].flatMap((take) => [`${take}-nl`, `${take}-en`]),
];

test('every launch take is registered as a valid video recipe', () => {
  const byId = new Map(RECIPES.map((r) => [r.id, r]));
  for (const id of LAUNCH_TAKES) {
    const recipe = byId.get(id);
    assert.ok(recipe, `${id} is not in RECIPES`);
    assert.ok(isVideoRecipe(recipe), `${id} should be a video recipe`);
    assert.deepEqual(validateRecipe(recipe), [], id);
  }
});

test('the terminal prints the containers docker-compose.yml defines', () => {
  const containers = composeContainers();
  assert.deepEqual([...containers].sort(), [
    'deckyard-app',
    'deckyard-caddy',
    'deckyard-postgres',
  ]);
  const lines = composeOutput(containers);
  assert.equal(lines[0], '[+] Running 3/3');
  // Compose starts the database first and the app waits for its health check.
  assert.match(lines[1], /deckyard-postgres\s+Healthy$/);
  assert.ok(lines.slice(2).every((line) => / Started$/.test(line)));
});

test('a renamed service changes what the terminal prints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-up-'));
  const file = path.join(dir, 'docker-compose.yml');
  fs.writeFileSync(
    file,
    "services:\n  web:\n    container_name: 'acme-web'\n  db:\n    container_name: acme-postgres\n",
  );
  assert.deepEqual(composeContainers(file), ['acme-web', 'acme-postgres']);
  fs.writeFileSync(file, 'services:\n  web:\n    image: x\n');
  assert.throws(() => composeContainers(file), /No container_name/);
  fs.rmSync(dir, { recursive: true });
});

test('the terminal take types the README command, then moves to the result', async () => {
  const steps = await replay(composeUp);
  const typed = steps.find((s) => s.kind === 'type');
  // The trailing newline is the Enter that starts the output.
  assert.equal(typed?.text, `${COMPOSE_COMMAND}\n`);
  assert.deepEqual(
    steps.filter((s) => s.label).map((s) => s.label),
    ['command', 'started'],
  );
  assert.equal(steps[0].kind, 'hold');
  assert.equal(steps[steps.length - 1].kind, 'hold');
});

test('the arriving votes end on the result the poll shot photographs', () => {
  const opening = [1, 1, 4, 1];
  const arrivals = pollArrivals(opening, MARKETING_POLL_VOTES);
  const tally = [...opening];
  for (const option of arrivals) tally[option] += 1;
  assert.deepEqual(tally, MARKETING_POLL_VOTES);
  // A fixed order, so two runs grow the bars the same way.
  assert.deepEqual(pollArrivals(opening, MARKETING_POLL_VOTES), arrivals);
  // Spread, not grouped: the first few votes do not all go to one option.
  assert.ok(new Set(arrivals.slice(0, 8)).size > 1);
});

test('both halves of each app pair film the same choreography', async () => {
  for (const factory of [
    editorTourTake,
    themeColoursTake,
    commentResolveTake,
    presenterNotesTake,
  ]) {
    const nl = await replay(factory('nl'));
    const en = await replay(factory('en'));
    assert.deepEqual(en, nl, factory.name);
    assert.equal(nl[0].kind, 'hold', `${factory.name} opens on a still`);
    assert.equal(
      nl[nl.length - 1].kind,
      'hold',
      `${factory.name} ends on slack`,
    );
    assert.equal(
      nl.filter((s) => s.label).length >= 1,
      true,
      `${factory.name} gives the camera at least one keyframe`,
    );
  }
});

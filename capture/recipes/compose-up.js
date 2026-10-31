/**
 * Take: **"on your own server, in five minutes"** — the launch video's payoff.
 *
 * A terminal: `docker compose up -d` is typed, the stack comes up, the prompt
 * returns. It is the only take that films no app screen, and it is still a
 * recipe rather than a screen recording for the same reasons every other clip
 * is one: the runner's event log gives the composition its camera, the
 * schedule makes two runs land on the same frames, and a re-shoot is a command
 * instead of an afternoon.
 *
 * **The terminal is a page this recipe draws, and what it prints is read from
 * the repo.** The container lines are the `container_name`s in
 * `docker-compose.yml`, in file order, so a renamed or added service changes
 * the take the next time it is recorded instead of leaving the video claiming
 * a stack that no longer exists. What the recipe does stage is time: compose
 * pulls and builds for minutes on a first run, and the clip has four bars. The
 * lines are the ones `up -d` ends on, not a sped-up recording of the wait.
 * (The recipe hash only covers `capture/`, so a compose edit does not mark
 * this take stale; it is picked up on the next re-record.)
 *
 * The page is drawn on `about:blank`, not on a route of the capture server:
 * an app route boots the app (whose timers outlive `document.open`) and sends
 * a content-security policy, and `/health` is JSON, which Chrome shows as
 * text whatever is written into it. So `navigate` only proves the server is
 * up, and the terminal carries everything it needs: JetBrains Mono, which
 * `npm install` downloads into `assets/fonts/google/`, inlined as data URIs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIDEO_VIEWPORT } from '../lib/record.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** The command the clip is about, exactly as the README gives it. */
export const COMPOSE_COMMAND = 'docker compose up -d';

/** The shell prompt in front of it: a fresh clone, nothing else. */
const PROMPT = '~/deckyard $';

/** The input the command is typed into. */
export const COMMAND_INPUT = '#terminal-command';

/** The state word of the line compose prints last, once every container is up. */
export const LAST_STATE = '.terminal-line.is-last .terminal-state';

/**
 * Milliseconds between Enter and each output line. The first line is compose
 * announcing the plan; each container then reports in file order, the database
 * slowest because the app waits for its health check.
 */
const LINE_DELAYS_MS = [250, 900, 600, 450];

/**
 * Container names from `docker-compose.yml`, in the order the file lists them.
 *
 * A line scan rather than a YAML parse: the capture harness takes no new
 * dependency, and `container_name:` is a flat scalar in that file.
 *
 * @param {string} [file]
 * @returns {string[]}
 */
export function composeContainers(
  file = path.join(REPO_ROOT, 'docker-compose.yml'),
) {
  const names = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s+container_name:\s*['"]?([\w.-]+)['"]?\s*$/.exec(line);
    if (match) names.push(match[1]);
  }
  if (names.length === 0)
    throw new Error(`No container_name in ${path.relative(REPO_ROOT, file)}`);
  return names;
}

/**
 * The lines `docker compose up -d` ends on for these containers: a summary,
 * then one check per container, in the order compose starts them. The bundled
 * database comes first and reports `Healthy`, because the app's `depends_on`
 * waits for its health check; the others report `Started` in file order.
 * (Ordering by the `-postgres` suffix rather than by resolving `depends_on`
 * is the same no-parser trade as {@link composeContainers}.)
 *
 * @param {string[]} containers
 * @returns {string[]}
 */
export function composeOutput(containers) {
  const isDb = (/** @type {string} */ name) => name.endsWith('-postgres');
  const ordered = [
    ...containers.filter(isDb),
    ...containers.filter((name) => !isDb(name)),
  ];
  const width = Math.max(...ordered.map((name) => name.length));
  return [
    `[+] Running ${containers.length}/${containers.length}`,
    ...ordered.map((name) => {
      const state = isDb(name) ? 'Healthy' : 'Started';
      return ` ✔ Container ${name.padEnd(width)}  ${state}`;
    }),
  ];
}

/** The vendored JetBrains Mono, by weight. */
const FONT_DIR = path.join(REPO_ROOT, 'assets/fonts/google/jetbrains-mono');

/**
 * One weight of JetBrains Mono as a `data:` URI.
 * @param {400 | 700} weight
 */
function fontDataUri(weight) {
  const file = path.join(FONT_DIR, `jetbrains-mono-${weight}-latin.woff2`);
  if (!fs.existsSync(file))
    throw new Error(
      `${path.relative(REPO_ROOT, file)} is missing; run npm install (postinstall downloads it)`,
    );
  return `data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * The page: one terminal filling the frame, prompt waiting.
 * @returns {string}
 */
const terminalHtml = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Terminal</title>
<style>
  @font-face {
    font-family: 'JetBrains Mono';
    font-weight: 400;
    src: url('${fontDataUri(400)}') format('woff2');
  }
  @font-face {
    font-family: 'JetBrains Mono';
    font-weight: 700;
    src: url('${fontDataUri(700)}') format('woff2');
  }
  html, body { margin: 0; height: 100%; background: #0f1115; }
  body {
    box-sizing: border-box;
    padding: 200px 160px;
    color: #d7dae0;
    font: 400 26px/1.6 'JetBrains Mono', ui-monospace, monospace;
  }
  .terminal-line { white-space: pre; min-height: 1.6em; }
  .terminal-prompt { color: #7fb4ff; font-weight: 700; margin-right: 0.6em; }
  .terminal-check { color: #5fd38d; }
  .terminal-state { color: #5fd38d; }
  #terminal-command {
    font: inherit; color: inherit; background: transparent;
    border: 0; outline: 0; padding: 0; width: 24ch; caret-color: #d7dae0;
  }
</style>
</head>
<body>
  <div class="terminal-line"><span class="terminal-prompt">${PROMPT}</span><input id="terminal-command" autocomplete="off" spellcheck="false"></div>
  <div id="terminal-output"></div>
</body>
</html>`;

/**
 * Wire Enter on the command input: freeze the typed command, print the output
 * on {@link LINE_DELAYS_MS}, then return the prompt. Runs in the page.
 *
 * @param {{ lines: string[], delays: number[], prompt: string }} script
 */
function installCompose({ lines, delays, prompt }) {
  const input = document.getElementById('terminal-command');
  const out = document.getElementById('terminal-output');
  if (!(input instanceof HTMLInputElement) || !out)
    throw new Error('terminal page did not render');

  /** @param {string} text @param {string} [extra] */
  const addLine = (text, extra = '') => {
    const line = document.createElement('div');
    line.className = `terminal-line ${extra}`.trim();
    const check = text.match(/^( ✔ )(.*?)(Healthy|Started)$/);
    if (check) {
      const mark = document.createElement('span');
      mark.className = 'terminal-check';
      mark.textContent = check[1];
      const state = document.createElement('span');
      state.className = 'terminal-state';
      state.textContent = check[3];
      line.append(mark, check[2], state);
    } else {
      line.textContent = text;
    }
    out.append(line);
    return line;
  };

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    input.readOnly = true;
    input.style.caretColor = 'transparent';
    let at = 0;
    lines.forEach((text, i) => {
      at += delays[i] ?? delays[delays.length - 1];
      setTimeout(
        () => addLine(text, i === lines.length - 1 ? 'is-last' : ''),
        at,
      );
    });
    setTimeout(() => {
      const next = addLine('');
      const p = document.createElement('span');
      p.className = 'terminal-prompt';
      p.textContent = prompt;
      next.append(p);
    }, at + 400);
  });
}

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default {
  id: 'compose-up',
  kind: 'video',
  viewport: VIDEO_VIEWPORT,

  navigate: '/health',
  waitFor: 'body',

  async action(page) {
    await page.goto('about:blank');
    await page.setContent(terminalHtml(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(installCompose, {
      lines: composeOutput(composeContainers()),
      delays: LINE_DELAYS_MS,
      prompt: PROMPT,
    });
  },

  record: {
    fps: 30,
    /** @param {import('../lib/recipe.js').Recorder} rec */
    async sequence(rec) {
      // The empty prompt first: a terminal waiting is the "before".
      await rec.hold(600);
      // The trailing newline is Enter. The camera pushes in on the command
      // while it is typed — overlay a lands here.
      await rec.type(COMMAND_INPUT, `${COMPOSE_COMMAND}\n`, {
        label: 'command',
      });
      // Compose reports in; the last container line lands ~2.2s after Enter.
      await rec.hold(2600);
      // Second keyframe on the result, so the camera moves to "Started"
      // under overlay b instead of staying on the command.
      await rec.move(LAST_STATE, { label: 'started' });
      // Slack: four bars is ~7.9s at the launch track's tempo, and the cut
      // trims this hold rather than the clip running out of film.
      await rec.hold(3600);
    },
  },
};

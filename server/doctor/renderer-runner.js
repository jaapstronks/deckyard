/**
 * Doctor check for the renderer runner: is the runner reachable through
 * `RENDERER_RUNNER_SOCKET`, and has the operator registered the renderer this
 * image carries? Every release changes the bundle hash, so a deploy without
 * the registration step is a red line here rather than refused publications.
 *
 * The probe is one real request with the current renderer hash and an empty
 * edition. An unregistered hash is refused at admission without a job (D364),
 * so the probe never costs the runner an instance.
 */

import { envStr } from '../config/utils.js';
import {
  EDITION_INPUT_SCHEMA,
  RENDERER_BUNDLE_ERRORS,
  RUNNER_SOCKET_ENV,
  openCurrentRendererBundle,
  renderEditionInBundle,
  runnerSocketPath,
} from '../render/renderer-bundle/index.js';
import { ok, fail, skip } from './finding.js';

const RUNBOOK = 'docs/ops/renderer-runner.md';

/** The first twelve hex characters, enough to tell two identities apart. */
const short = (hash) => `${hash.slice(0, 12)}…`;

/**
 * @typedef {import('./finding.js').DoctorContext & {
 *   openCurrent?: typeof openCurrentRendererBundle,
 *   render?: typeof renderEditionInBundle,
 * }} RendererRunnerContext
 */

/** @type {import('./finding.js').DoctorCheck} */
export const rendererRunnerCheck = {
  id: 'renderer-runner',
  label: 'Renderer runner',
  /** @param {RendererRunnerContext} ctx */
  async run({
    openCurrent = openCurrentRendererBundle,
    render = renderEditionInBundle,
  }) {
    if (!envStr(RUNNER_SOCKET_ENV))
      return skip(
        `${RUNNER_SOCKET_ENV} is not set; frozen-edition rendering refuses.`,
      );
    const socket = runnerSocketPath();
    if (!socket)
      return fail(
        `${RUNNER_SOCKET_ENV} is not an absolute Unix socket path.`,
        `Set ${RUNNER_SOCKET_ENV}=/run/deckyard-render/broker.sock (the broker socket as the container sees it); a host:port is not accepted.`,
      );
    let bundle;
    try {
      bundle = await openCurrent();
    } catch (err) {
      return fail(
        `This installation carries no verifiable render bundle: ${err.message}`,
        'The Docker image builds one into renderer-store/; in a checkout run node scripts/build-renderer-bundle.js --store renderer-store.',
      );
    }
    try {
      const { runnerId } = await render(bundle.rendererHash, {
        schema: EDITION_INPUT_SCHEMA,
        presentation: { slides: [] },
      });
      return ok(
        `runner ${short(runnerId)} renders ${short(bundle.rendererHash)} via ${socket}`,
      );
    } catch (err) {
      if (err?.code === RENDERER_BUNDLE_ERRORS.UNKNOWN)
        return fail(
          `The runner does not have this installation's renderer ${bundle.rendererHash}.`,
          `On the runner host, export it from the running container and register it: scripts/export-renderer-bundle.sh <container> <directory>, then the register command it prints (${RUNBOOK} § Registering a release).`,
        );
      if (err?.code === RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE)
        return fail(
          `The runner at ${socket} is not available.`,
          `On the runner host: systemctl status deckyard-render-supervisor.service deckyard-render-broker.service; the supervisor starts at boot once enabled (sudo systemctl enable --now deckyard-render-supervisor.service). In the container: is /run/deckyard-render mounted, and does the process run as the runner's caller uid (${RUNBOOK} § Production installation on a Coolify host)?`,
        );
      return fail(
        `The runner refused the probe: ${err?.code || err?.message || err}.`,
      );
    }
  },
};

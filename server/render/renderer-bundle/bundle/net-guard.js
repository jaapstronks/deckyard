/**
 * The network seal inside a render worker.
 *
 * Node's permission model (`--permission`) closes the filesystem outside the
 * bundle, `child_process`, `worker_threads` and native addons, but it has no
 * network dimension: a module in the worker could still open a socket. So the
 * seal has two halves, and they answer different questions.
 *
 *   - **Build time, in `scripts/build-renderer-bundle.js`:** the closure scan
 *     refuses a bundle in which any module imports a networking builtin or an
 *     npm client. That is what makes the renderer *incapable*, and it is the
 *     half that matters, because it holds for every future build.
 *   - **Run time, here:** a resolution hook refuses those specifiers anyway and
 *     the network globals are removed. That is what makes an escape *visible*:
 *     a renderer that tries to reach the network throws instead of succeeding
 *     quietly, in production and in the test that proves the seal.
 *
 * `module.registerHooks()` is used rather than `module.register()` on purpose:
 * the latter runs its hooks on a worker thread, which `--permission` denies, so
 * it cannot be the seal of a sealed worker. This one is synchronous and
 * in-thread.
 *
 * The seal is installed before the render entry is imported, so no module in
 * the closure can have captured a socket API beforehand.
 */

import { registerHooks } from 'node:module';

/**
 * Specifiers a sealed renderer may not resolve.
 *
 * Networking builtins under both spellings (`node:net` and bare `net`), plus
 * the process-escape builtins the permission model already denies at call time
 * - denying them at resolve time turns a runtime `ERR_ACCESS_DENIED` deep in a
 * module into a refusal naming the module that asked.
 */
export const SEALED_SPECIFIERS = Object.freeze([
  'dgram',
  'dns',
  'dns/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'tls',
  'child_process',
  'cluster',
  'worker_threads',
]);

const BLOCKED = new Set(
  SEALED_SPECIFIERS.flatMap((name) => [name, `node:${name}`]),
);

/** Network globals a sealed renderer has no use for. */
const SEALED_GLOBALS = Object.freeze([
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'navigator',
]);

/** Set once the seal is installed, so the worker can report it. */
let sealed = false;

/**
 * Install the seal. Idempotent.
 *
 * @returns {{specifiers: string[], globals: string[], keptGlobals: string[]}}
 *   What was sealed, and which globals could not be removed. `keptGlobals` is
 *   reported rather than ignored: on a runtime where one of them is
 *   non-configurable the worker says so, and the isolation test can see it.
 */
export function sealNetwork() {
  if (!sealed) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (BLOCKED.has(specifier)) {
          const err = new Error(
            `renderer_bundle_network_sealed: ${specifier} (imported by ${context?.parentURL || 'the worker'})`,
          );
          err.code = 'ERR_RENDERER_BUNDLE_NETWORK_SEALED';
          throw err;
        }
        return nextResolve(specifier, context);
      },
    });
    sealed = true;
  }
  const removed = [];
  const kept = [];
  for (const name of SEALED_GLOBALS) {
    if (name in globalThis) {
      try {
        delete globalThis[name];
        removed.push(name);
      } catch {
        // A non-configurable global stays. Recorded rather than swallowed: the
        // build-time refusal is what guarantees nothing in the closure reaches
        // for it, and this says the runtime half did not hold.
        kept.push(name);
      }
    }
  }
  return {
    specifiers: [...BLOCKED].sort(),
    globals: removed,
    keptGlobals: kept,
  };
}

/** Whether the resolution seal is installed in this process. */
export function isNetworkSealed() {
  return sealed;
}

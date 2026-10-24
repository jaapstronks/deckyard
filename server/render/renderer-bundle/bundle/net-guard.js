/**
 * Diagnostic import filter for the trusted-fixture render proof, NOT a sandbox.
 * process.getBuiltinModule() bypasses resolution hooks and can open sockets.
 * Removing globals and scanning imports do not establish network isolation.
 * Production execution is refused by host.js pending an external boundary.
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
        // diagnostic reports removal failures without claiming isolation.
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

/**
 * Loader hooks for the broker double: when `runner/broker.js` imports one of
 * the modules below, it gets this folder's stand-in instead. Nothing else is
 * redirected, so protocol, channel and policy are the shipped modules, and
 * `broker.js` itself runs byte for byte as installed.
 */

const STANDINS = Object.freeze({
  './paths.js': new URL('./paths.js', import.meta.url).href,
  'node:fs': new URL('./fs.js', import.meta.url).href,
  'node:worker_threads': new URL('./worker-threads.js', import.meta.url).href,
});

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, next) {
  if (
    context.parentURL?.endsWith('/renderer-bundle/runner/broker.js') &&
    Object.hasOwn(STANDINS, specifier)
  )
    return { url: STANDINS[specifier], shortCircuit: true };
  return next(specifier, context);
}

/**
 * Stand-in for `node:fs` under the broker double: the real module, except
 * that handing the socket to root is not possible without being root.
 */

export * from 'node:fs';

export function chownSync() {}

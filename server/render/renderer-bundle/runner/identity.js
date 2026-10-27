import { sha256Hex } from '../manifest.js';

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
}

/** Runtime identity is independent of JSON property order and installation
 * nonce. It includes all executable/image bytes, modes, policies and mappings. */
export function runnerIdentity(config) {
  const { callerUid, callerGid, subuid, subgid, build, files, serviceFiles } =
    config;
  return sha256Hex(
    JSON.stringify(
      ordered({
        schema: 'deckyard.renderer-runner.identity/1',
        callerUid,
        callerGid,
        subuid,
        subgid,
        build,
        files,
        serviceFiles,
      }),
    ),
  );
}

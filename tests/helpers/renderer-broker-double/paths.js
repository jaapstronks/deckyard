/**
 * Stand-in for `runner/paths.js` under the broker double: every path in the
 * scratch directory the test names in `BROKER_DOUBLE_DIR`, an installation
 * whose caller is this process's own uid, and a native control that admits
 * that peer. `jobPaths` and `isInternalId` are the shipped ones.
 */

import { lstatSync, openSync } from 'node:fs';

export {
  isInternalId,
  jobPaths,
} from '../../../server/render/renderer-bundle/runner/paths.js';

const dir = process.env.BROKER_DOUBLE_DIR;

export const PATHS = Object.freeze({
  store: `${dir}/store`,
  socket: `${dir}/broker.sock`,
  supervisor: `${dir}/supervisor.sock`,
});

export function trustedPath(absolute) {
  return lstatSync(absolute);
}

export function loadInstallation() {
  return {
    callerUid: process.getuid(),
    callerGid: process.getgid(),
    build: { selfTestHash: process.env.BROKER_DOUBLE_SELF_TEST_HASH },
    runnerId: process.env.BROKER_DOUBLE_RUNNER_ID,
  };
}

export function loadControl() {
  return {
    assertProducerIo() {},
    peer() {
      return { uid: process.getuid(), pidfd: openSync('/dev/null', 'r') };
    },
    disconnected() {
      return false;
    },
  };
}

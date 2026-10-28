/**
 * Child entry of the broker double (`tests/renderer-runner-admission.test.js`):
 * install the hooks, then start the shipped broker. Root, the native control
 * addon, the producer Worker and the socket chown are the only stand-ins
 * (`hooks.js`); admission, the queue, framing and the lifecycle channel are
 * the real code.
 */

import { register } from 'node:module';

register('./hooks.js', import.meta.url);
const { startBroker } =
  await import('../../../server/render/renderer-bundle/runner/broker.js');
await startBroker();

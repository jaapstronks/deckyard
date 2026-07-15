/**
 * Entry point for the vendored collaboration bundle (client/vendor/collab.js).
 *
 * The client is no-build vanilla ESM, so the Yjs/Hocuspocus client libraries
 * are bundled once into a single ESM file and checked in — same philosophy as
 * client/vendor/qrcode-generator.js. Regenerate with:
 *
 *   npm run vendor:collab
 *
 * after bumping the yjs/@hocuspocus/provider dependencies.
 */

export {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
export * as Y from 'yjs';

/**
 * Server-side binding of the shared deck ⇄ Y.Doc codec.
 *
 * The codec itself lives in shared/collab/deck-ydoc.js and is Y-agnostic
 * (the client binds it to the vendored bundle instead). Phase-2 persistence
 * (Hocuspocus onLoadDocument/onStoreDocument) and the server-as-collaborator
 * seam consume it from here.
 */

import * as Y from 'yjs';
import { createDeckYdocCodec } from '../../shared/collab/deck-ydoc.js';

export const deckYdocCodec = createDeckYdocCodec(Y);
export { Y };

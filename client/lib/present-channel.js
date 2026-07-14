/**
 * Local cross-window sync for the two-window presenter view.
 *
 * The presenter (master) window and the clean projector window are same-origin
 * and live in the same browser, so we sync them over a `BroadcastChannel` —
 * instant and local, no server round-trip. This is deliberately separate from
 * the SSE present-session (which syncs cross-*device* follow/companion): a
 * second window on the same machine doesn't need the network.
 *
 * Message shape: `{ kind: 'state' | 'hello' | 'bye' | 'hl' | 'codes', state? }`.
 * `state` = `{ slideIndex, stepIdx, stepParagraphs }` (for 'state'); for 'hl'
 * it carries a highlighter mirror event in slide-space (see highlighter.js);
 * for 'codes' it carries the session's follow codes `{ nl, en }` so the
 * projector can render follow-invite/poll/feedback join codes.
 *
 * Falls back to a no-op channel when `BroadcastChannel` is unavailable (very old
 * browsers); the feature simply doesn't sync there rather than throwing.
 *
 * @param {string} presentationId
 * @returns {{
 *   postState: (state: object) => void,
 *   postHighlighter: (ev: object) => void,
 *   postCodes: (codes: object) => void,
 *   sendHello: () => void,
 *   onState: (cb: (state: object) => void) => void,
 *   onHighlighter: (cb: (ev: object) => void) => void,
 *   onCodes: (cb: (codes: object) => void) => void,
 *   onHello: (cb: () => void) => void,
 *   onBye: (cb: () => void) => void,
 *   close: () => void,
 * }}
 */
export function createPresentChannel(presentationId) {
  const name = `deckyard:present:${String(presentationId || '')}`;
  const hasBC = typeof BroadcastChannel !== 'undefined';
  /** @type {BroadcastChannel | null} */
  const bc = hasBC ? new BroadcastChannel(name) : null;

  let stateCb = null;
  let hlCb = null;
  let codesCb = null;
  let helloCb = null;
  let byeCb = null;

  if (bc) {
    bc.onmessage = (ev) => {
      const msg = ev?.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'state' && msg.state) stateCb?.(msg.state);
      else if (msg.kind === 'hl' && msg.state) hlCb?.(msg.state);
      else if (msg.kind === 'codes' && msg.state) codesCb?.(msg.state);
      else if (msg.kind === 'hello') helloCb?.();
      else if (msg.kind === 'bye') byeCb?.();
    };
  }

  const post = (kind, state) => {
    if (!bc) return;
    try {
      bc.postMessage(state ? { kind, state } : { kind });
    } catch {
      // ignore serialization / closed-channel failures
    }
  };

  return {
    postState: (state) => post('state', state),
    postHighlighter: (ev) => post('hl', ev),
    postCodes: (codes) => post('codes', codes),
    sendHello: () => post('hello'),
    onState: (cb) => {
      stateCb = cb;
    },
    onHighlighter: (cb) => {
      hlCb = cb;
    },
    onCodes: (cb) => {
      codesCb = cb;
    },
    onHello: (cb) => {
      helloCb = cb;
    },
    onBye: (cb) => {
      byeCb = cb;
    },
    close: () => {
      post('bye');
      try {
        bc?.close();
      } catch {
        // ignore
      }
    },
  };
}

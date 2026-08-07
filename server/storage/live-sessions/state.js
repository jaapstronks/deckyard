/**
 * The live sessions this process holds.
 *
 * Keyed by session id. Each value carries both the persisted fields (deck,
 * slide state, control flag, follow codes — see `db.js`) and the hot ones that
 * only mean anything in this process: the SSE client sockets, their heartbeat
 * timers, and the pending persist timer.
 *
 * @type {Map<string, any>}
 */
export const sessions = new Map();

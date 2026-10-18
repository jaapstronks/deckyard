/**
 * Authorization lease per collab connection (B767).
 *
 * Write permission can end while a socket stays open: a collaborator removed,
 * a deck made private or handed over, an organization left, a session
 * revoked. Re-checking on the client's next message is no boundary, because
 * the server keeps broadcasting other writers' updates to a client that
 * stays silent. So the server holds the boundary on the way out: a
 * connection's authorization is a lease of `ttlMs`, and once it has run out
 * every outgoing message waits until a fresh check renews it. A check that
 * fails closes the connection and drops what was held, so nothing written
 * after the lease ran out reaches a user who lost the right.
 *
 * There is no timer per connection: the check runs when a message is due
 * (outgoing, or incoming through `renew()`), so a quiet document costs
 * nothing and a revoked client is closed by the first update it would have
 * received. The only timer is the deadline on a running check, so a hanging
 * lookup closes the connection instead of holding messages without bound.
 *
 * The lease wraps `connection.send`: Hocuspocus 4 routes every message to a
 * connection through it (document broadcasts, sync replies, awareness) and
 * offers no hook on the way out.
 */

/**
 * @typedef {Object} AuthorizationLease
 * @property {() => Promise<boolean>} renew - Check again if the lease has run
 *   out (at most one check at a time); resolves whether the connection may go
 *   on. A refusal has closed it.
 * @property {() => Promise<boolean>} check - Withdraw the lease and check
 *   again now: for a revocation that is known to have just happened. Messages
 *   wait until it succeeds.
 * @property {() => void} dispose - Stop gating, drop held messages and
 *   cancel the deadline of a running check; called when the connection
 *   closes.
 */

/**
 * Put a connection's outgoing messages behind an authorization lease.
 *
 * @param {{ send: (message: Uint8Array) => void }} connection - A Hocuspocus
 *   connection; its `send` is replaced.
 * @param {Object} opts
 * @param {number} opts.ttlMs - How long a successful check holds.
 * @param {number} opts.authorizedAt - When the connection was authorized
 *   (the lease's first start).
 * @param {() => Promise<unknown>} opts.authorize - Rejects when the
 *   connection's user may no longer have the document.
 * @param {() => void} opts.onRefused - Close the connection.
 * @param {() => number} [opts.now=Date.now]
 * @returns {AuthorizationLease}
 */
export function attachAuthorizationLease(
  connection,
  { ttlMs, authorizedAt, authorize, onRefused, now = Date.now },
) {
  const deliver = connection.send.bind(connection);
  let validUntil = authorizedAt + ttlMs;
  let held = [];
  let pending = null;
  let ended = false;
  // Deadlines of running checks, cleared when the check settles or the
  // connection closes.
  const deadlines = new Set();
  // A forced check supersedes the checks before it: one that started before
  // a revocation must not renew the lease after it.
  let generation = 0;

  const valid = () => now() < validUntil;

  function refuse() {
    if (ended) return;
    // Ended before the close, so the close message itself goes out.
    ended = true;
    held = [];
    onRefused();
  }

  /** One authorization round trip, bounded by the lease length. */
  function runCheck() {
    const checkedAt = now();
    const round = generation;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('authorization check timed out')),
        ttlMs,
      );
      timer.unref?.();
      deadlines.add(timer);
    });
    return Promise.race([authorize(), deadline])
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        clearTimeout(timer);
        deadlines.delete(timer);
        if (ended) return false;
        if (round !== generation) return renew();
        if (!ok) {
          refuse();
          return false;
        }
        validUntil = Math.max(validUntil, checkedAt + ttlMs);
        const queued = held;
        held = [];
        for (const message of queued) deliver(message);
        return true;
      });
  }

  function startCheck() {
    const run = runCheck().finally(() => {
      if (pending === run) pending = null;
    });
    pending = run;
    return run;
  }

  function renew() {
    if (ended) return Promise.resolve(false);
    if (valid() && !pending) return Promise.resolve(true);
    return pending || startCheck();
  }

  /** Withdraw the lease at once and hold everything until a fresh check. */
  function check() {
    if (ended) return Promise.resolve(false);
    generation += 1;
    validUntil = -Infinity;
    return startCheck();
  }

  connection.send = (message) => {
    // Held messages keep their order: once one waits, the rest wait too.
    if (ended || (valid() && held.length === 0)) {
      deliver(message);
      return;
    }
    held.push(message);
    renew();
  };

  return {
    renew,
    check,
    dispose() {
      ended = true;
      held = [];
      for (const timer of deadlines) clearTimeout(timer);
      deadlines.clear();
    },
  };
}

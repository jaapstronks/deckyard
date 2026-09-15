# Slide locks

Per-slide edit exclusivity for the editor when collaborative live edits are
off (`COLLAB_LIVE_EDITS` unset, the default). With live edits on, slide locks
are not used at all: CRDT merging replaces exclusivity and presence covers
awareness (`collab-editor-binder.md`). Author locks (`lockedByAuthor`) are a
separate, permanent flag and work in both modes.

## When a lock is taken

A lock is taken on the **first real change** to a slide, not on selection
(D112). Opening a deck or clicking through its slides leaves no lock behind.

| Moment                               | What happens                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Deck opens, slide selected           | No lock. The slide's content fingerprint is recorded; the shell shows the banner if someone else holds the slide.   |
| Edit that changes the selected slide | Lock requested once (`POST …/slides/:id/lock`); later edits only restart the idle clock.                            |
| Edit that leaves the slide as-is     | Deck title, settings, language: no lock.                                                                            |
| Change to a slide another user holds | Refused: not saved, a toast names the holder, and the slide is restored from the server.                            |
| Switch to another slide              | Pending edits are saved, then the held lock is released.                                                            |
| No change for 2 minutes              | Pending edits are saved, then released (checked on the 30 s refresh tick, so between 2:00 and 2:30).                |
| Tab hidden                           | Pending edits are saved, then released. The next edit asks again.                                                   |
| Tab closed                           | `release-all` on `beforeunload`; the 2-minute server TTL covers a lost request.                                     |
| Viewing a slide another user holds   | The lock state is fetched again on selection and on each 30 s tick, so a lock that expired silently stops blocking. |

"Changes the slide" is decided by comparing the selected slide's
`slideFingerprint` (`shared/slide-fingerprint.js`) with the one last seen: at
selection, after each edit, and whenever the local copy is rebased onto server
truth (save response, adopted remote update, silent wake-up refresh; the save
manager's `onServerTruth` hook). Nearly every `markDirty()` call passes no
slide id, so the call itself cannot tell a slide edit from a deck edit.

A refused change is taken back in two places: the slide is replaced with the
server copy, and the save manager forgets it as a pending edit and re-bases it
on that copy (`adoptServerSlide`). Without the second step the next save would
read the holder's change as "both changed" and block the editor on a conflict.

Only a take or a release is broadcast. A lock whose holder vanished (crashed
tab, sleeping laptop) simply expires on the server, so while the selected slide
shows as held the client asks `GET …/slide-locks` again rather than trusting
its last event.

## Where it lives

- `client/views/editor/slide-lock-manager.js` — lock state, the fingerprint
  check (`onSlideEdited`), selection (`onSlideSelected`), idle/hidden release,
  SSE lock events. Acquire and release requests run through one ordered queue.
- `client/views/editor/editor-controller.js` — calls `onSlideEdited` from its
  `markDirty` wrapper; `onLockFailed` shows the toast and calls
  `restoreSlideFromServer` (`slide-lock-restore.js`). `getSlideLockKind` is the
  state seam editing surfaces read to block edits before they happen.
- `server/storage/slide-locks.js` — acquire (atomic upsert), refresh, release,
  TTL 2 minutes.
- `server/storage/presentations/crud/enforce-slide-locks.js` — the guarantee:
  a save that changes a slide another user holds is refused with 423,
  whatever the client did. Correctness never depends on when the client took
  its lock; the client side is about not blocking people who only look.

## Not covered by the client lock

Edits from the slide list to a slide that is **not** selected (hide,
delete, context-menu actions) take no lock and rely on the server's 423.

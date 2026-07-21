# Comments & notifications: the three-layer model

Shipped 2026-07-17 (PR stack #52–#56, migrations 042–045). This documents
the durable semantics; the API/MCP surface is in `comments-api.md`.

## The model in one paragraph

Thread status (`open` / `resolved` / `dismissed`) is **shared** state:
Resolve means "we agree, this is settled" and affects everyone. Personal
follow-up lives in the **events inbox** behind the notification bell: each
inbox item has `read_at` ("seen", drives the badge) and `archived_at`
("handled", drops it from the default list) — two fields, so "seen but
still to do" exists. **Subscriptions** decide which events become inbox
items for whom. Nothing in the inbox ever touches shared thread status.

## Data model

| Table | Migration | Purpose |
|-------|-----------|---------|
| `comment_thread_reads` | 042 | Per-user read-state per thread (`user_email`, top-level `comment_id`, `last_read_at`; PK user+comment, org-scoped). Drives the unread dots and the "waiting for me" filter. Guests have no account and no read-state. |
| `presentation_comments.mentions` | 043 | JSONB list `[{name, email}]`, parsed server-side from body markup `@[Name](user:email)` at create **and** update — single source of truth for every write path (app, REST v1, MCP). Parser: `shared/comment-mentions.js`. |
| `presentation_subscriptions` | 044 | Per-deck override (`level`: `watching` \| `participating` \| `mentions_only` \| `mute`). No row = use the user's global default (`settings.notifications.defaultLevel`). |
| `user_notifications.archived_at` | 045 | "Handled" timestamp next to `is_read`/`read_at`. Archiving always also marks read; the badge counts unread **unarchived** items only. |

## Event → recipients (the subscription resolver)

`server/services/comment-subscriptions.js` is the one place that decides
who receives a comment event. Candidates, most specific reason first:

1. **mention** — the comment @mentions you. Always delivers, at every
   level (muting a busy deck never silences being addressed directly).
   Mentions only ever resolve to **existing accounts** (org-scoped
   lookup); an arbitrary address in the markup is stored but never
   notified or emailed.
2. **reply** — you wrote the parent comment.
3. **participating** — you own/created the deck or wrote in the thread.
4. **watching** — you have an explicit per-deck watching override, or you
   are a collaborator whose effective level is `watching` (this is how
   the global "watching" default actually delivers).

Effective level: per-deck override → global default → `participating`.
The level filters the candidates: `watching` passes everything,
`participating` passes reply+participating, `mentions_only` and `mute`
pass only mentions. For comment events those last two currently behave
identically; the distinction is intent and future event types.

Notification type follows the recipient's reason (`comment_mention` /
`comment_reply` / `comment_created`), so "Replies to your comments" in
the settings means exactly that — a third-party reply on your own deck
arrives as `comment_created`.

## Channels

- **In-app** (bell + per-user SSE): every write path — app routes, public
  API v1, MCP.
- **Email** (Brevo): app + REST v1. Gated per recipient on `emailEnabled`
  and per-type `emailByType.{comment_created,comment_reply,comment_mention}`.
  Mention markup is stripped from bodies/excerpts.
- **Slack/Discord webhook**: app + REST v1. Channel-level: it fires from
  the pre-subscription recipient set, so one user's mute cannot silence a
  shared channel. Payload body is markup-stripped.
- **MCP** currently triggers only the in-app side (no request origin to
  build links from) — known gap, not a contract.

Settings writes merge per key: a partial `notifications` PUT never resets
stored opt-outs.

## Inbox semantics

- Filters: All / Mentions / Unread / Archived. "Archive all" only shows
  on the All lens (elsewhere it would archive items outside the view).
- **Auto-archive on own reply**: replying in a thread archives your open
  inbox items for that thread (you handled it); new activity in the
  thread creates a fresh unarchived item. Runs on every write path with
  an actor, even when nobody else is left to notify.
- Mentions added by **editing** a comment notify the newly added users
  (diffed against the pre-edit list, so re-saving never re-notifies).

## Deck-activity notifications ("someone worked on your deck")

Separate from comments: when a collaborator **adds slides** to a deck you own
or collaborate on, you get one bundled bell notification, not a ping per slide.

- **Activity feed (layer 1)** — the save route emits a granular `slide.added`
  activity event (`recordSlidesAdded`), so the workspace Activity feed shows
  "… added N slides to *Deck*" instead of a generic "updated". Feed-only, no
  inbox load.
- **Bundled bell notification (layer 2)** — `server/services/deck-activity-notifications.js`
  fans out a `deck_activity` inbox notification to the deck's members.
  - **Recipients**: owner + `createdBy` + collaborators, **actor always
    excluded** (you never get notified of your own edits). Subscription levels
    are respected by treating deck-activity as a `participating`-grade signal
    (reusing `levelAllows`): the owner's default level delivers; `mute` and
    `mentions_only` opt out; an explicit `watching` override delivers.
  - **Bundling — coalesce-on-write, 60 min window** (env
    `DECK_ACTIVITY_NOTIFY_WINDOW_MIN`): a slide-add looks for an existing
    **unread, unarchived** `deck_activity` row for the same
    `(recipient, deck, actor)` created inside the window
    (`findUnreadDeckActivityNotification`). Found → bump the count, refresh
    the title, move it back to the top and re-mark unread
    (`refreshDeckActivityNotification`); the window extends on each edit. Not
    found → one new row. So an actor making 40 edits in an hour yields **one**
    unread notification ("*Riley* added 40 slides to *Deck*"), not 40. No job
    or queue: the coalescing happens on the write itself.
  - **Live**: pushes `notification:new` (the bell dedupes by id, so a coalesced
    bump replaces the row rather than stacking) followed by an authoritative
    `notification:counts` so the badge stays correct across coalescing.
  - Clicking navigates to the deck (`/app/<id>`). No new columns — it rides the
    existing `user_notifications.data` JSONB
    (`{ presentationTitle, slideCount, kind: 'slide_added' }`).
  - **Known limitation**: the coalesce is a per-recipient read-modify-write, not
    one atomic statement, so two concurrent saves by the same actor to the same
    deck could momentarily produce two rows / a slightly-off count. The save
    route's If-Match revision check already serialises same-deck saves, so this
    is an edge, not the hot path.
- **Per-deck on/off (layer 3)** — not built; deferred until layer 2 is in use.

Copy note: the only trigger today is slide-adds, so the title reads "added N
slides"; a future edit trigger would generalise it.

## The comment composer

All four composers (editor main + reply, share-viewer main + reply) are the
same component: `createRichCommentInput` in `client/lib/comment-rich-input.js`.
It is a `contenteditable`, not a `<textarea>`, so a mention can show as a chip
**while typing** instead of as raw `@[Name](user:email)` markup.

**The storage format did not change.** The composer is a view over the same
canonical string:

- `getValue()` walks the DOM back to markup (chip → `mentionMarkup`, `<br>` and
  block wrappers → `\n`). This is what gets posted.
- `setValue(body)` is the inverse, so an existing body re-hydrates into chips.

`serialize(deserialize(x)) === x` is the load-bearing invariant — pinned by
`tests/comment-rich-input.test.js`. Break it and bodies drift every time one is
re-hydrated. Two subtleties it protects:

- A **trailing `<br>`** is the browser's filler that makes an empty last line
  visible; it must not read back as a newline. `deserialize` emits the same
  filler, so both sides agree.
- **Shift+Enter is deliberately left to the browser.** It already inserts a
  plain break and places the caret correctly (blocks only come from *plain*
  Enter, which the component intercepts to submit). Hand-rolling it silently
  loses the newline: a caret anchored between child nodes gets normalised back
  into the preceding text, so the next keystroke lands on the wrong side.

Other invariants: chips are `contenteditable="false"` and deleted as a unit by
backspace; **paste is forced to plain text**, so no HTML can enter the composer
and reach the body.

The mention autocomplete (`client/lib/mention-autocomplete.js`) works through a
small **caret adapter** — `getTextBeforeCaret()` + `replaceQueryWithMention()` —
so the same search, ranking and keyboard nav drive both the contenteditable
(inserts a chip) and a plain textarea (`textareaCaretAdapter`, inserts markup).
The `@`-query is recomputed from the text before the caret on every keystroke
rather than remembered, so a moved caret cannot leave a stale anchor behind.

Autocomplete is wired in the **editor only**: guests have no account, so they
are neither mentionable nor able to mention. The share viewer gets the same
composer without it.

### Links

A body may also carry `[label](url)`. `splitCommentSegments` is the full
grammar (text + mentions + links) and drives both surfaces; `splitMentionSegments`
still exists for callers that only care about mentions. **Mentions are matched
first** — `@[Name](user:…)` also matches the bare link shape once the `@` is
consumed, so running links first would turn every mention into a link.

`safeLinkUrl` is an **allowlist**: `http://`, `https://`, `mailto:`, and no
embedded control characters (that is how `java\nscript:` slips past a prefix
check). Anything else is not a link — the markup stays visible as literal
text, which is the harmless outcome. Comment bodies are written by anyone who
can comment, guests included, so this is a security boundary, not a nicety.
Rendered anchors carry `rel="noopener noreferrer nofollow"`.

Unlike a mention chip, a link in the composer is **not atomic**: the label
stays editable, so you can retype the words without reopening the dialog. The
URL rides on `data-link-url` and is what serialisation reads back (the composer
node deliberately carries no `href`, so a stray Cmd/Ctrl+click cannot navigate
away mid-compose). Emptying the label drops the link rather than serialising
`[](url)`, which would come back as literal text.

**Known limitation — parentheses in a URL.** `LINK_RE` reads the URL as
`[^()\s]+`, so a target that itself contains `(` or `)` (e.g.
`https://en.wikipedia.org/wiki/Foo_(bar)`) links and stores fine but does not
round-trip: on the next parse the regex stops at the inner `(` and the whole
`[label](url)` degrades to literal text. This is the classic
markdown-link-parsing hard case; acceptable while link demand is light, and the
fix (balanced-paren or angle-bracket URLs) waits for actual need.

The link button (`client/lib/comment-toolbar.js`) lives beside Post rather than
in a bar of its own, so the composer keeps its height. It snapshots the
selection on `mousedown` via `rememberSelection()` — by the time the dialog is
open the live selection is gone, and closing a modal restores focus to the
composer, which puts a *fresh* caret at position 0. That is why a snapshot
wins over the live selection, and why it is cleared again on the next
keydown/mousedown: a stale range would otherwise hijack the next mention
insert or backspace.

## Deliberate non-features

- No explicit assignment: mention = passing the ball. Could become a
  checkbox on top of mentions if practice demands it.
- No full inbox page (popover only) — optional later.
- Guests: no account → not mentionable, no read-state, no subscriptions;
  email stays their channel.

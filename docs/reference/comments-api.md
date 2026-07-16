# Comments via the public API v1 and MCP

Agents and scripts can read reviewer feedback on a deck and respond to it —
as the owner of the API key (or MCP session). This closes the loop for the
scenario: *"deck X has new comments → analyze them → reply 'good point,
fixed in slide 7' → resolve"*.

Requires the **database storage backend**; the file backend has no comment
store (all endpoints/tools return empty results or a clear error there).

## Key scopes

Two dedicated scopes gate comment access (Settings → API Keys):

| Scope | Grants |
|-------|--------|
| `comments:read` | Read comments on presentations the key owner can read |
| `comments:write` | Create comments/replies, resolve/reopen/dismiss |

Existing keys don't have these scopes and get a `403 API key lacks required
scope` until recreated (or granted the scope).

## Payload: slide context and snapshots

Comments are only useful to an agent with context. Every comment payload
carries:

- **`slide`** — the commented slide *as the deck is now*: `null` when the
  comment has no slide anchor, `{ "deleted": true }` when the slide has been
  removed, otherwise `{ index, number, type, title, deleted: false }`.
- **`slideSnapshot`** — the slide `{ id, type, content }` *as it was when
  the comment was created* (stored at create time, migration 041). `null`
  for comments that predate snapshots — the API reports that honestly
  rather than reconstructing.
- **`editUrl`** — a deep link into the editor, anchored to the commented
  slide via `?slideId=` (the editor and the view/comment viewer both open
  on that slide).

The difference between `slide` and `slideSnapshot` is deliberate: a
reviewer's remark may be about content that has since changed; the snapshot
shows what they saw, the context shows where it lives now.

## REST endpoints (public API v1)

Authenticate with `Authorization: Bearer dk_live_…`. Full schemas in the
OpenAPI spec (`/api/v1/docs`).

```sh
# New comments since a date, with slide context
curl -s -H "Authorization: Bearer $KEY" \
  "https://your-host/api/v1/presentations/$DECK/comments?status=open&since=2026-07-15"

# Reply to a comment as the key owner
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"body":"Good point — fixed in slide 7.","parentId":"'$COMMENT'"}' \
  "https://your-host/api/v1/presentations/$DECK/comments"

# New top-level comment anchored to a slide (stores a slide snapshot)
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"body":"This chart needs a source.","slideId":"'$SLIDE'"}' \
  "https://your-host/api/v1/presentations/$DECK/comments"

# Resolve it (owner/creator only)
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"resolved"}' \
  "https://your-host/api/v1/comments/$COMMENT/status"
```

Semantics:

- **List** (`GET …/comments`) — filters `status` (`open|resolved|dismissed|all`),
  `slideId`, `since` (ISO 8601); replies come nested under their parent.
  Needs read access to the deck.
- **Create** (`POST …/comments`) — author is always the key owner. Needs
  *comment* permission (owner/creator, workspace member, or collaborator
  with comment rights or higher) — deliberately weaker than deck `write`.
  `slideId` must exist in the deck; `parentId` must be a comment on the
  same deck.
- **Status** (`POST /comments/:id/status`) — body `{ "status": "resolved" |
  "open" | "dismissed" }`. Transitions follow the app: `open→resolved`,
  `open→dismissed`, `resolved→open`; anything else is a `409`. Only the
  presentation owner/creator may change status (same `canResolveComment`
  rule as the editor UI).

Mutations fire the same side effects as in-app comments: activity events,
owner/parent-author notifications (create only) and SSE broadcasts, so open
editors update live.

## MCP tools

Read (shipped earlier, now enriched with `slide` context, `slideSnapshot`,
slide-anchored `editUrl`, and a `since` filter):

- `list_comments` — one deck, filters `status`/`slideId`/`since`.
- `list_recent_comments` — cross-deck, filters `scope`/`authorEmail`/`status`/`since`.

Write (this release):

- `add_comment` — `{ presentationId, body, slideId? }`; new top-level
  comment as the acting user, snapshot stored when anchored to a slide.
- `reply_to_comment` — `{ presentationId, commentId, body }`; replying to a
  reply attaches to the same top-level thread.
- `set_comment_status` — `{ presentationId, commentId, status }`; same
  transition and owner-only rules as REST.

The acting user is the SSE session owner (API key owner) or the configured
stdio owner email; write tools refuse to run without one (a comment needs
an author). Access rules are identical to the REST endpoints.

## Storage notes

- `presentation_comments.slide_snapshot` (JSONB, migration
  `041_comment_slide_snapshot.js`) holds the snapshot; only the affected
  slide, never the whole deck, to keep rows small. No retention concerns
  beyond normal comments — it's user content that dies with the comment row
  (FK cascade).
- Comments live only in Postgres (`server/storage/presentation-comments.js`
  wraps everything in `withDbGuard`); the file backend has no comments
  table, so there was no second backend to migrate.

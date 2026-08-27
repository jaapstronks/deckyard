# Architecture Overview

This repo is intentionally **simple, dependency-light, and modular**:

- Plain Node.js server (no Express, no framework)
- Vanilla ESM client (no bundler)
- Shared rendering logic in `shared/`

---

## High-Level Directory Structure

```
deckyard/
├── client/              # Browser UI (vanilla ESM, no build step)
│   ├── views/           # Page controllers (editor, presenter, follow, etc.)
│   ├── lib/             # Browser utilities + slide mounting/cleanup
│   ├── styles/          # CSS organized by layer
│   └── i18n/            # Translation files per locale
│
├── server/              # Node.js HTTP server
│   ├── routes/          # HTTP handlers (API + static)
│   │   ├── api/         # REST API endpoints
│   │   └── public-api/  # API key authenticated endpoints (v1)
│   ├── mcp/             # MCP server (stdio + SSE transports, 27 tools)
│   ├── collab/          # Real-time collaboration (Yjs/Hocuspocus over WebSocket)
│   ├── storage/         # Data persistence layer (direct Kysely on getDb())
│   ├── export/          # Export format builders (PNG, PDF, PPTX, HTML)
│   ├── render/          # Server-side rendering (Puppeteer for screenshots)
│   ├── auth/            # Authentication (sessions, sandbox mode)
│   ├── db/              # PostgreSQL client + migrations
│   ├── config/          # Environment, feature flags, paths
│   ├── services/        # Domain services (SSE broadcast, notifications)
│   ├── jobs/            # Background jobs (cleanup, digest emails, bulk export)
│   ├── integrations/    # Third-party APIs (Brevo, Giphy, Unsplash)
│   ├── analytics/       # Usage analytics
│   ├── media/           # Media handling
│   ├── i18n/            # Server-side i18n helpers
│   ├── data-sandbox/    # Sandboxed evaluation for live data sources
│   └── utils/           # HTTP helpers, middleware, LLM clients
│
├── shared/              # Code used by both client + server
│   ├── slide-types/     # Slide type definitions (schema, defaults, rendering)
│   ├── collab/          # Yjs deck-document codec (shared client/server)
│   ├── markdown.js      # Markdown to safe HTML
│   └── sanitize.js      # HTML sanitization
│
├── themes/              # Core theme JSON files
├── custom/themes/       # Organization-specific themes (gitignored)
├── custom/slide-types/  # Organization-specific slide types (gitignored)
├── custom/assets/       # Organization-specific assets (gitignored)
├── assets/              # Fonts, icons, images
└── docs/                # Documentation
```

### Extension Directories (Protected from Updates)

The `custom/` directories are gitignored in the OSS repo, so they persist through upstream updates:

| Directory             | Purpose                       | Loaded At           |
| --------------------- | ----------------------------- | ------------------- |
| `custom/slide-types/` | Custom slide type definitions | Server startup      |
| `custom/themes/`      | Custom theme JSON configs     | Runtime (on demand) |
| `custom/assets/`      | Custom fonts, images, logos   | Static file serving |

These directories enable organizations to customize without modifying core code. See:

- `docs/developer/slide-types.md` - Custom slide types + AI integration
- `docs/developer/themes.md` - Custom themes

---

## Request Handling: Handler Chain Pattern

The server uses a functional handler chain pattern instead of a framework:

```javascript
// server/routes/api/index.js
export async function handleApi(ctx) {
  // Each handler returns true if it handled the request
  if (await handleAuth(ctx)) return;
  if (await handlePublicEndpoints(ctx)) return;

  // Auth check for protected routes
  const user = getUserFromRequest(ctx.req);
  if (!user) return unauthorized(ctx.res);
  ctx.user = user;

  // Protected routes
  if (await handlePresentations(ctx)) return;
  if (await handleExport(ctx)) return;
  if (await handleMedia(ctx)) return;

  return notFound(ctx.res);
}
```

Each handler checks the URL pattern and returns `true` if it handled the request, or `false` to pass to the next handler.

### Route authorization

Authorization uses **direct helpers**, not wrappers
(`server/utils/route-middleware.js`): a handler calls one, and branches on what
it gets back. The helper sends the error response itself, so a falsy return
means "already answered, stop here".

```javascript
import { withPresentationAuth } from '../../utils/route-middleware.js';

export async function handleSlideLockAcquire(
  { repoRoot, req, res, authedUser } = {},
  id,
  slideId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({
    repoRoot,
    id,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true; // 404/403 already sent

  // Handle the request…
  return true;
}
```

Permissions are `read` | `write` | `delete` | `manage`. Sibling
helpers cover the other shapes: `withPresentationReadAuth`,
`withPresentationCommentAuth` (guest access via share links), `canManage`, and
the custom-HTML capability checks.

There is deliberately **no composition/wrapper family**. One existed alongside
these helpers for months with zero call sites and was removed rather than
adopted (2026-08-05) — a second dispatch form for the same job is what the beta
stance rules out. Dispatch itself is the route table; keep new routes on the
direct helpers.

---

## Storage Layer

### One backend, one adapter

PostgreSQL is the only storage backend; the old `file` backend (JSON on disk)
was removed in 1.x. Old file data imports once with `npm run db:import`.

```javascript
// Storage mode validation (server/config/database.js)
STORAGE_MODE = postgres; // unset means postgres; "file" stops the boot
```

`postgres` is the only accepted value, spelled exactly like that — anything
else (including `postgresql`, and the removed `file`) stops the boot with an
explanation rather than falling back to a backend the operator did not ask
for.

The layer is flat, and it is not a dispatch:

- **Facades** (`server/storage/<domain>/`) are what routes and jobs call. Each
  takes a **storage scope** as its first argument, reduces it to a context
  (`toStorageContext()`), and issues its queries through direct Kysely on
  `getDb()` (`server/db/client.js`). The scope is where the organization comes
  from — see [tenant-isolation.md](../reference/tenant-isolation.md).
- **Lifecycle** is a thin module (`server/storage/lifecycle.js`):
  `initializeStorage()` / `closeStorage()` over the shared Kysely pool. There is
  no adapter class, no mixins, no singleton to dispatch through — B79/D34
  stripped that; one backend, reached one way.

There is no base class to implement and no capability probing left: a single
backend either has a query path or the call is a bug.

### On-disk state

- Uploads: `/server/uploads/{filename}`
- Deck thumbnails: `/server/data/deck-thumbs/` — a derived, regenerable cache.
- No domain data is written to `/server/data/` as JSON any more. Settings, email
  templates, image-library usage, present sessions, follow codes, questions,
  interactions and feedback all persist in PostgreSQL. What remains under
  `/server/data/` is the thumbnail cache plus the import source the migration
  chain reads from on an upgrading install.

### PostgreSQL Storage

- Uses Kysely ORM for type-safe queries
- Connection pooling (configurable min/max)
- SSL support with certificate validation
- Migrations in `/server/db/migrations/`

---

## Authentication

### Session Flow

1. User logs in (password or magic link)
2. Server creates HMAC-SHA256 signed token
3. Token stored in HttpOnly, Secure cookie
4. Each request: parse cookie → verify signature → validate session

```
Token = base64url(payload) + '.' + base64url(HMAC-SHA256(payload))
Payload = { email, role, name, exp, v }
```

### Security Features

- Timing-safe signature comparison
- Session invalidation on password change (version key)
- Cookie domain for cross-subdomain SSO
- Rate limiting per IP

### Sandbox Mode

Guest authentication for public demos:

- Per-visitor ephemeral session
- No login required
- 24-hour TTL for data cleanup
- Watermarked exports

---

## MCP Server

Deckyard is MCP-native: `server/mcp/` exposes the full presentation lifecycle
(27 tools + 7 guided prompts) to AI agents, over two transports:

- **stdio** (`npm run mcp`, `server/mcp/index.js`) — for local clients like
  Claude Desktop; owner set via `DECKYARD_MCP_OWNER_EMAIL`.
- **Streamable HTTP/SSE** (`POST /mcp` on the main server, `server/mcp/sse.js`)
  — for remote agents, authenticated with API keys.

Tools live in `server/mcp/tools.js` and reuse the same storage + validation
layer as the REST API (per-deck authorization via
`server/mcp/presentation-access.js`). Forks can add their own tools through
`custom/mcp-tools.js` (see `docs/reference/mcp-server.md`).

---

## Real-Time Collaboration (Yjs / WebSocket)

Optional, behind `COLLAB_ENABLED` / `COLLAB_LIVE_EDITS` (default off). A
Hocuspocus server is mounted on the same HTTP port at `/collab`
(`server/collab/mount.js`); the deck is mirrored into a Yjs document
(`shared/collab/deck-ydoc.js`) for presence (avatars, slide focus, field
focus) and — with the second flag — live co-editing with per-user undo.
Server-side persistence flushes CRDT state back to the normal storage layer
(`server/collab/persistence.js`, Postgres table `presentation_ydocs`,
migration 040). With the flags off, this entire subsystem is inert and the
classic save path (below, SSE + revision merge) is unchanged.

Details: `docs/reference/collab-presence.md`, `collab-deck-doc.md`,
`collab-editor-binder.md`, and ADR 001.

---

## Real-Time Features (SSE)

Server-Sent Events power the non-CRDT real-time updates:

### Comment Events

```javascript
// server/services/comment-events.js
// In-memory map: presentationId → Set<Response>

addClient(presentationId, res); // Subscribe
broadcastToPresentation(id, 'comment:created', data); // Broadcast
// Heartbeat every 30s prevents proxy timeout
```

### Follow-Along (Presenter Sessions)

```
1. Presenter creates session → returns sessionId
2. Audience enters 4-letter code → resolves to session
3. Audience subscribes via SSE
4. Presenter updates state → broadcast to all followers
5. Interactive slides (polls, quizzes) update in real-time
```

---

## Export Pipeline

Export uses a factory pattern (`server/export/pipeline.js`):

```javascript
// Pipeline stages:
1. prepareExportContext()  // Load presentation, auth check, language projection
2. Format-specific builder  // PNG, PDF, PPTX, HTML, etc.
3. sendExportResponse()    // Download headers + buffer
```

### Supported Formats

| Format | Engine            | Notes                             |
| ------ | ----------------- | --------------------------------- |
| JSON   | Native            | Deck format for import/export     |
| HTML   | Embedded          | Standalone with all assets inline |
| PDF    | Puppeteer         | Print-to-PDF or slide screenshots |
| PNG    | Puppeteer + Sharp | 1600x900px default, 1-3x scaling  |
| PPTX   | pptxgenjs         | PowerPoint with embedded images   |
| Notes  | Markdown/DOCX     | Speaker notes extraction          |

### PNG Rendering Flow

```
1. Build HTML with embedded fonts + images
2. Launch Puppeteer (headless Chromium)
3. Render slide at 1600x900px
4. Screenshot to PNG buffer
5. Compress with Sharp (optional scaling)
```

---

## The Slide Type Pipeline

Slide types are the single source of truth for schema, defaults, and rendering:

```
1. Slide type definitions: shared/slide-types/types/*.js
2. Registry: shared/slide-types/registry.js
3. Server exposes metadata: GET /api/slide-types
4. Shared rendering: shared/slide-types.js
5. Client mounts HTML: client/lib/slide-runtime/slide-render.js
```

### Slide Type Structure

```javascript
export default {
  label: 'Content Slide',
  fields: [
    { key: 'title', label: 'Title', type: 'string', required: true },
    { key: 'body', label: 'Body', type: 'markdown' },
    {
      key: 'background',
      label: 'Background',
      type: 'enum',
      options: ['lime', 'mist'],
    },
  ],
  defaults: {
    title: 'New slide',
    body: '',
    background: 'lime',
  },
  renderHtml: (content, slide, ctx) => `
    <div class="slide slide-content ${bgClass(content?.background)}">
      <div class="slide-inner">
        <h2 dir="auto">${esc(content?.title)}</h2>
        <div class="body" dir="auto">${markdownToSafeHtml(content?.body)}</div>
      </div>
    </div>
  `,
};
```

---

## Critical Convention: Lifecycle & Cleanup

Slides can have runtime behavior (timers, event listeners, SSE connections). If you add side-effects:

1. **Attach in client runtime** (not in shared renderers)
2. **Return a cleanup function** so `client/lib/slide-runtime/slide-render.js` can dispose when slides change

```javascript
// client/lib/slide-runtime.js
export function attachSlideRuntime(slideEl) {
  const timer = setInterval(() => {
    /* ... */
  }, 1000);

  // Return cleanup function
  return () => {
    clearInterval(timer);
  };
}
```

---

## Module Structure Conventions

Two rules keep server modules from drifting into "similar things in arbitrarily
different places". They are the server counterpart of the client-structure
convention; apply them to `server/` and, by extension, anywhere the same shapes
recur.

### One noun, one form — a folder as soon as a domain has ≥ 2 members

A domain is expressed **either** as a single flat file **or** as a folder with an
`index.js` barrel — never as a folder living next to flat siblings of the same
noun. The moment a domain grows a second module, it becomes a folder and the
flat siblings move in.

```
# Wrong — folder next to flat siblings of the same noun
server/storage/presentations/          # crud/, slides.js, ownership.js, …
server/storage/presentation-cache.js   # same noun, arbitrarily left flat
server/storage/presentation-comments.js

# Right — one form for the domain
server/storage/presentations/
  index.js                             # the single barrel
  cache.js
  comments.js
  slides.js
  …
```

A domain that is still a single module stays a flat file; it graduates to its own
folder only when a second member appears. Inside
the folder, `index.js` holds the domain's primary facade; other members are
imported directly by path (`storage/presentations/i18n.js`) — the folder groups
the domain, it does not force everything through one re-export barrel. What is
ruled out is a **flat re-export shim next to the folder** that forwards into the
folder's `index.js` (two barrels for one thing); collapse those into one.

### Config accessors live only in `server/config/`

Anything that reads environment or derives configuration (an accessor, a parsed
list, a resolved path, a feature-flag read) belongs in `server/config/`. Other
directories consume config; they do not define their own config-reading helper.
A `config.js` under `utils/`, `media/`, or `llm/` that reaches into `process.env`
is a second home for the same responsibility — fold it into `server/config/`.

Shared parsers back this up: use `envList` from `server/config/` for
comma-separated env values rather than hand-rolling another split/trim/filter.

---

## Key Architectural Decisions

| Decision                 | Rationale                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| No framework             | Minimal dependencies, full control                                                        |
| Functional middleware    | Composition over inheritance, explicit data flow                                          |
| Storage abstraction      | Swappable backends with a one-shot file→Postgres import path (`db:import`)                |
| In-memory SSE            | Fast, no message queue (sessions reset on restart)                                        |
| Atomic file writes       | Temp + rename prevents corruption                                                         |
| Puppeteer rendering      | Server-side PNG/PDF at request time                                                       |
| Feature flags            | Toggle AI, uploads, demo mode per deployment                                              |
| Session versioning       | Invalidate all sessions on password change                                                |
| Slide-level locks        | Concurrent editing with per-slide acquisition (phased out when `COLLAB_LIVE_EDITS` is on) |
| Collab as optional layer | Yjs/Hocuspocus behind a flag; flag-off path byte-identical to classic saves               |
| MCP alongside REST       | Agents use the same storage/validation layer as the UI                                    |
| Rate limiting            | Token bucket per IP for abuse prevention                                                  |

# Development Setup

## Requirements

- **Node.js 22+** (per `engines` in `package.json`; CI runs on 22)
- No build step required (vanilla ESM)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/jaapstronks/deckyard.git
cd deckyard

# Install dependencies
npm install

# Start the development server
npm start

# Open in browser
open http://localhost:4177
```

---

## Environment Configuration

### Minimal Setup (No Auth, File-Based Storage)

Copy the example and start:

```bash
cp .env.example .env
npm start
```

No environment variables are required for basic development.

### Development Environment Variables

Create `.env` with only the variables you need:

```bash
# Server
PORT=4177                    # Default port
HOST=127.0.0.1              # Default host
NODE_ENV=development        # Development mode

# Debugging
DEBUG_LOG=1                 # Server-side debug logging
DEBUG_LOG_CLIENT=1          # Client-side debug (injects window.__DEBUG_LOG__=true)

# Authentication (optional for development)
AUTH_ENABLED=true
AUTH_SECRET=dev-secret-key-change-in-production
AUTH_ADMIN_EMAIL=admin@example.com
AUTH_DEV_BYPASS=true        # Skip auth in dev (NEVER use in production)
SECURE_COOKIES=false        # Allow HTTP cookies in dev

# AI Features (optional - pick one or more)
OPENAI_API=sk-...
OPENAI_MODEL=gpt-4o
CLAUDE_API=sk-ant-...
CLAUDE_MODEL=claude-sonnet-5
# CLAUDE_MODEL_PLAN=claude-opus-4-8  # optional: stronger model for the deck outline step
MISTRAL_API=...
MISTRAL_MODEL=mistral-large-latest

# Media Services (optional)
UNSPLASH_ACCESS_KEY=...     # Stock images
GIPHY_API_KEY=...           # GIF search
IMAGEKIT_PRIVATE_KEY=...    # Image CDN
IMAGEKIT_PUBLIC_KEY=...
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/youraccount

# Notion Integration (optional)
NOTION_SECRET=...
NOTION_FEATURE=true
```

---

## NPM Scripts

| Script                                    | Description                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm start`                               | Start development server                                                                    |
| `npm test`                                | Run the node test suite                                                                     |
| `npm run lint`                            | ESLint gate; CI runs it before the tests                                                    |
| `npm run format` / `npm run format:check` | Prettier (write / check); the check gates CI next to lint — see `docs/developer/linting.md` |
| `npm run test:pg`                         | Storage-layer suite against a real PostgreSQL (see `docs/developer/pg-test-suite.md`)       |
| `npm run mcp`                             | Start the MCP server over stdio (for Claude Desktop etc.)                                   |
| `npm run vendor:collab`                   | Rebuild the vendored Yjs/Hocuspocus client bundle                                           |
| `npm run seed:bg-demo`                    | Seed the background-contrast demo deck                                                      |
| `npm run audit`                           | Code audit report (file sizes, complexity)                                                  |
| `npm run db:migrate`                      | Run pending database migrations                                                             |
| `npm run db:migrate:down`                 | Rollback last migration                                                                     |
| `npm run db:migrate:status`               | Show migration status                                                                       |
| `npm run db:import`                       | Import file data into PostgreSQL                                                            |
| `npm run i18n:audit`                      | Find hardcoded copy that bypasses `t()`, and orphan keys                                    |
| `npm run i18n:sync`                       | Sync missing keys across locales (`-- --dry-run` to preview)                                |
| `npm run i18n:validate`                   | Validate translation files                                                                  |

---

## Database Setup

### Default: PostgreSQL

`STORAGE_MODE` defaults to `postgres`, so a checkout expects a database. The
quickest one is the bundled compose service (`docker compose -f
docker-compose.yml -f docker-compose.local.yml up -d postgres` publishes it on
port 5433); any local PostgreSQL works too.

```bash
# 1. Set environment variables (STORAGE_MODE only if you want it explicit)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=deckyard
DATABASE_USER=deckyard
DATABASE_PASSWORD=your-password
DATABASE_SSL=false           # Use false for local development

# 2. Create database
createdb deckyard

# 3. Run migrations
npm run db:migrate

# 4. Check status
npm run db:migrate:status
```

Or let compose do it:
`docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`
starts a bundled `postgres:16`, applies pending migrations at boot
(`scripts/docker-entrypoint.sh`), and publishes the database on host port 5433.
See `docs/ops/self-hosting.md`.

### Importing Data: File to PostgreSQL

For data left behind by the removed disk-JSON store. It reads an old data
directory from disk and covers every domain that lived there (presentations,
image library, slide library, published, tags, slide collections,
slide-library usage). The import stays after the teardown, and is idempotent —
running it twice imports nothing the second time.
Presentation versions (DB migration 053) and derived ydoc collab-state are
intentionally not imported.

```bash
# Dry run (see what would be imported, with per-domain counts)
npm run db:import -- --dry-run

# Import with reset (clear existing data first)
npm run db:import -- --reset

# Standard import
npm run db:import
```

---

## Debugging

### Server Logs

```bash
# Enable debug logging
DEBUG_LOG=1 npm start
```

Look for log prefixes:

- `[Server]` - HTTP request handling
- `[Storage]` - Data persistence
- `[DB]` - Database operations
- `[Auth]` - Authentication events

### Client Debugging

```bash
# Enable client debug mode
DEBUG_LOG_CLIENT=1 npm start
```

This injects `window.__DEBUG_LOG__ = true` in the browser.

### Browser Tools

- **Console**: Direct debugging (no source maps needed)
- **Network tab**: API request/response inspection
- **Application tab**: Cookie inspection

---

## Project Structure for Development

Key directories to know:

```
client/
├── views/           # Page controllers (start here for UI changes)
│   ├── editor/      # Presentation editor
│   ├── presenter/   # Presenter mode
│   └── follow/      # Audience follow-along
├── lib/             # Utilities (API, DOM, routing)
└── styles/          # CSS (organized by layer)

server/
├── routes/api/      # API endpoints (start here for backend changes)
├── storage/         # Data persistence
└── config/          # Environment and feature flags

shared/
└── slide-types/     # Slide type definitions (schema + rendering)
    └── types/       # Individual slide type modules
```

---

## Common Issues & Troubleshooting

### Port 4177 Already in Use

```bash
# Find and kill the process
lsof -ti:4177 | xargs kill -9

# Or use a different port
PORT=4178 npm start
```

### PostgreSQL Connection Fails

```bash
# Verify connection settings
psql postgresql://user:password@localhost:5432/deckyard -c "SELECT 1"

# For local development, ensure:
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

### The dev-bypass identity

`AUTH_DEV_BYPASS=true` signs every request in as one real database user,
`dev@local.test` (`server/auth/dev-bypass.js`), created on first use. The
address used to be `dev@local`; a single-label domain fails `validateEmail`,
so nothing that validates an address — creating an API key, most of all —
worked on a bypass machine. `.test` is reserved by RFC 2606 and never
resolves.

**If your dev database predates the change**, it holds a `dev@local` row and
the bypass will create a _second_ user beside it, at which point your decks
look like they vanished. One statement repairs it:

```sql
UPDATE users SET email = 'dev@local.test' WHERE email = 'dev@local';
```

Run it before starting the server on the new build. The row keeps its
`users.id`, which is the only key identity matching uses
(`shared/identity-match.js`), so everything stamped with it stays yours. A
fresh dev database needs nothing.

### AUTH_DEV_BYPASS in Production

If you see this error:

```
SECURITY WARNING: AUTH_DEV_BYPASS is enabled in production!
```

Remove or set `AUTH_DEV_BYPASS=false` in production.

### Postinstall Script Fails

```bash
# Clear cache and reinstall
npm cache clean --force
rm -rf node_modules
npm install
```

The postinstall script vendors Lucide icons, vendors DOMPurify into
`client/vendor/dompurify/` (`npm run vendor:dompurify` re-runs just that step
after a dependency bump), and downloads Google Fonts.

### File Upload Issues

```bash
# Check upload directory permissions
chmod 755 server/uploads

# Verify uploads aren't disabled
# Remove UPLOADS_ENABLED=false (or legacy DISABLE_UPLOADS=true) if present
```

### Missing Translations

```bash
node scripts/i18n-fill.js en          # write missing EN keys from fallbacks
node scripts/i18n-fill.js --report nl # dump missing NL keys for translation
npm run i18n:validate                 # validate all translation files
```

Only `en` and `nl` are gated; the other ten locales fall back to English by
design.

---

## Testing

### Automated tests

`npm test` runs the node test suite (`tests/**/*.test.js`, using the built-in
`node --test` runner). CI runs the same suite on every push and PR.

The storage layer additionally runs against a real PostgreSQL in the
`test-postgres` CI job (`npm run test:pg`); it is deliberately outside
`npm test` - see [pg-test-suite.md](pg-test-suite.md).

### Testing storage behaviour without PostgreSQL

The suite has no live database, yet the storage/identity/auth modules reach
PostgreSQL exclusively through `getDb()` behind `isDatabaseAvailable()`
(`server/storage/utils/db-guard.js`). To exercise their real query behaviour
instead of grepping source, install the in-memory double:

```js
const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');

const db = createFakeDb({ users: [/* seed rows */] });
__setTestDb(db); // every storage module now runs against the double
// ... call the storage function under test ...
__setTestDb(null); // uninstall in afterEach
```

**Reach for it when** you need to assert what the storage layer _does_ against
the DB — which rows it writes, which tables it reads, which lookups it skips.

**What it deliberately models** (tests depend on these):

- **UNIQUE constraints** — the globally unique `users.email` and the
  `(user_id, organization_id)` membership pair throw a pg-shaped
  `UniqueViolationError` (code `23505`), so a path that wrongly re-inserts an
  existing person fails loudly.
- **`db.__queryLog` / `touchedTables(db, op?)`** — every table touched, in order,
  so a test can assert what was _not_ queried (e.g. single-organization mode issues
  no membership lookups at all).
- **`db.__tables`** — direct access to the backing rows for arrange/assert.
- **jsonb round-trip** — columns written via the `jsonb()` helper read back as
  parsed objects, exactly like production.

**What it is not**: not a Kysely implementation. It supports only the query
shapes the storage layer actually uses (the `selectFrom`/`insertInto`/
`updateTable`/`deleteFrom` chains, joins, `where`/`orderBy`/`limit`/`offset`,
`db.fn.count()`). An unsupported operator or predicate throws on purpose rather
than pretending — if a new storage query needs a shape the double lacks, extend
`tests/helpers/fake-db.js`.

### Manual Testing

Beyond the test suite, UI changes should be verified by hand:

1. **Browser testing** - Open the app and test features
2. **Server logs** - Watch stdout for errors
3. **Network tab** - Inspect API responses

### PostgreSQL storage test

The storage layer reaches PostgreSQL through direct Kysely; exercise it against a
throwaway database with the real-PostgreSQL suite (see
[pg-test-suite.md](pg-test-suite.md)):

```bash
# Requires a throwaway PostgreSQL named by DATABASE_URL, migrated first
DATABASE_URL=postgres://…/deckyard_pg_tests npm run test:pg
```

### Concurrent Voting Load Test

```bash
# Test SSE and voting under load
node scripts/test-concurrent-votes.js <presentationId> [numClients] [voteRounds]
```

Requirements:

- Server running
- Presentation open in presenter mode
- Navigated to a poll or likert slide

---

## Development Tips

### No Bundler

The client is vanilla ESM - no bundler, no build step. Changes are immediate:

1. Edit a `.js` file in `client/`
2. Refresh the browser
3. See changes (no compilation)

### Debugging Slide Types

Slide types are in `shared/slide-types/types/`. To debug:

1. Find the slide type file
2. Check `renderHtml()` for rendering issues
3. Check `fields[]` for editor form issues
4. Server restart required after changes to `shared/`

### Code Style

ESLint gates CI (`npm run lint` runs before the tests) - see
[linting.md](linting.md). On top of what the linter enforces:

- Small modules with clear boundaries
- Escape all user content with `esc()` or `markdownToSafeHtml()`
- Return cleanup functions from client side-effects
- Prefer explicit over implicit

### Adding Dependencies

This project is intentionally dependency-light. Before adding a package:

1. Can you write it in < 100 lines?
2. Is it a single-purpose package?
3. Does it have minimal dependencies itself?

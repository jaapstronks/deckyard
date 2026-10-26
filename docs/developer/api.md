# Public API Developer Guide

This guide covers the internal architecture of the Deckyard Public API for contributors working on the codebase.

## Architecture Overview

The Public API is a REST API (v1) that provides programmatic access to Deckyard presentations. It uses API key authentication and is separate from the internal session-based API.

```
server/routes/public-api/
├── v1/
│   ├── index.js        # Main router, auth, rate limiting
│   ├── middleware.js   # Authentication, rate limits, tracking
│   ├── presentations.js # CRUD operations
│   ├── slides.js       # Slide-level operations
│   ├── translate.js    # Translation endpoints
│   ├── comments.js     # Comments (comments:read / comments:write permissions)
│   ├── publishing.js   # Publish/unpublish
│   ├── slide-library.js # Slide library
│   ├── exports.js      # Export handlers (JSON, HTML, PPTX, PDF)
│   ├── ai.js           # AI generation endpoints
│   └── resources.js    # Themes, slide types, image library
```

### Related Files

| File                                   | Purpose                              |
| -------------------------------------- | ------------------------------------ |
| `server/storage/api-keys.js`           | API key CRUD and validation          |
| `server/storage/api-usage.js`          | Usage tracking and rate limit checks |
| `server/routes/api/api-keys.js`        | Internal API for key management      |
| `server/db/migrations/029_api_keys.js` | Database schema                      |
| `docs/openapi.yaml`                    | OpenAPI 3.0.3 specification          |

## Authentication Flow

1. Client sends `Authorization: Bearer dk_live_xxx` header
2. `authenticateApiKey()` extracts and validates the token
3. Token is SHA-256 hashed and looked up in `api_keys` table
4. Only active keys (where `revoked_at IS NULL`) are accepted
5. `last_used_at` is updated on successful authentication
6. API key data is attached to request context as `ctx.apiKey`

### API Key Format

```
dk_live_<32-character-base64url-token>
```

- Prefix: `dk_live_` (for live environment)
- Token: 24 random bytes encoded as base64url
- Only the hash is stored in the database
- First 8 chars after prefix stored as `key_prefix` for display

## Rate Limiting

### Per-Minute Limits (Shared Limiter)

`checkRequestRateLimit()` in `server/routes/public-api/v1/middleware.js` awaits the shared `consumeRequestLimit()` token bucket, keyed by API key id (`api:<id>`). It uses Redis when configured and reachable, with a per-process memory fallback when Redis is unavailable. See [Redis runtime configuration](../reference/jobs-and-queues.md#config--flags) for the existing connection settings. Memory buckets are local to each server process; Redis shares the bucket across processes.

### Daily Limits (Database)

Tracked in `api_usage_daily` table:

- `request_count` - Total requests
- `ai_request_count` - AI endpoint calls
- `export_count` - Export operations

### Tier Configuration

`TIER_LIMITS` in `server/storage/api-keys.js` is the source of truth for per-minute requests, daily AI calls and daily exports. A value of `-1` means unlimited; consult that export for the current tiers and values.

## Permissions

API keys can have granular permissions:

| Permission            | Access                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `read`                | List/get presentations, themes, slide types                            |
| `write`               | Create, update, delete presentations                                   |
| `export`              | Export presentations                                                   |
| `ai`                  | Use AI generation endpoints                                            |
| `comments:read`       | Read comments on accessible presentations                              |
| `comments:write`      | Create comments/replies and change comment status                      |
| `collaborators:read`  | See who has access to presentations the key's owner manages (MCP only) |
| `collaborators:write` | Grant organization members access to those presentations (MCP only)    |

Check permissions with:

```js
if (!requirePermission(ctx, 'write')) return true;
```

## Adding New Endpoints

1. **Create handler** in appropriate file (presentations.js, exports.js, etc.)
2. **Add route** in the handler's main function
3. **Use middleware helpers**:
   - `requirePermission(ctx, 'read')` - Check the key's permissions
   - `apiSuccess(ctx, data)` - 200 response with rate limit headers
   - `apiCreated(ctx, data)` - 201 response
   - `apiError(ctx, status, message)` - Error response
4. **Track usage** if needed:
   - `trackRequest(ctx)` - Standard request
   - `trackAiRequest(ctx)` - AI request (counts toward daily limit)
   - `trackExportRequest(ctx)` - Export (counts toward daily limit)
5. **Update OpenAPI spec** in `docs/openapi.yaml`

### Example Handler

```js
async function handleMyEndpoint(ctx) {
  const { storageScope, authedUser } = ctx;

  // Check the key's permissions
  if (!requirePermission(ctx, 'read')) return true;

  // Tutorial placeholder: implement the domain operation in server/services/.
  const data = await myOperation(storageScope, { actor: authedUser });

  // Return response (includes rate limit headers automatically)
  await apiSuccess(ctx, { result: data });
  return true;
}
```

The example above is a handler skeleton: `myOperation` is a tutorial placeholder. Shared domain operations belong in [services](../reference/services-layer.md); pass the middleware-provided `storageScope` and resolved actor. Storage calls take that [StorageScope](../reference/storage-scope.md) first, never a bare repository path.

## Database Schema

### api_keys

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  owner_email VARCHAR(320) NOT NULL,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,      -- First 8 chars for display
  key_hash VARCHAR(64) NOT NULL,        -- SHA-256 hash for validation
  tier VARCHAR(20) DEFAULT 'free',
  permissions JSONB DEFAULT '["read", "write"]',
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,               -- NULL = active
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### api_usage_daily

```sql
CREATE TABLE api_usage_daily (
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  request_count INTEGER DEFAULT 0,
  ai_request_count INTEGER DEFAULT 0,
  export_count INTEGER DEFAULT 0,
  PRIMARY KEY (api_key_id, date)
);
```

## Testing

### Create Test API Key

Prefer **Settings → API keys** in a running development instance. For a local operator script, run the following from the repository root against a migrated development database. Set `TEST_ORGANIZATION_ID` to the existing development organization's UUID and `TEST_OWNER_EMAIL` to an existing member's email. This script is a trusted operator path: it states the chosen organization and actor explicitly; disabling authentication does not establish either one or verify membership. Use only an organization and member you control. See [StorageScope](../reference/storage-scope.md) for request and non-request entry points.

```bash
TEST_ORGANIZATION_ID='<development-organization-uuid>' \
TEST_OWNER_EMAIL='test@example.com' \
node --env-file=.env --input-type=module <<'JS'
import { createApiKey } from './server/storage/api-keys.js';
import { initializeDatabase, closeDatabase } from './server/db/client.js';

const organizationId = process.env.TEST_ORGANIZATION_ID;
const actorEmail = process.env.TEST_OWNER_EMAIL;
if (!organizationId || !actorEmail) {
  throw new Error('Set TEST_ORGANIZATION_ID and TEST_OWNER_EMAIL');
}
const scope = { repoRoot: process.cwd(), organizationId, actorEmail };

try {
  await initializeDatabase();
  const result = await createApiKey(scope, {
    name: 'Test Key',
    ownerEmail: actorEmail,
    permissions: ['read', 'write', 'export', 'ai'],
  });
  if (!result.ok) throw new Error(`API key creation failed: ${result.reason}`);
  // result.key is returned once; keep it in a local secret store if needed.
  // Print only non-secret metadata, never the raw key or the whole result.
  console.log({ id: result.id, name: result.name });
} finally {
  await closeDatabase();
}
JS
```

Do not insert a key with SQL: use the storage operation so validation, hashing and organization assignment follow the same contract. To obtain a key for the curl examples below, the settings UI displays it once; keep it out of logs and source control and revoke it after testing.

### Test Endpoints

```bash
export API_KEY="dk_live_your_key_here"

# Health check
curl http://localhost:4177/api/v1/ -H "Authorization: Bearer $API_KEY"

# List presentations
curl http://localhost:4177/api/v1/presentations -H "Authorization: Bearer $API_KEY"

# Create presentation
curl -X POST http://localhost:4177/api/v1/presentations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "theme": "amethyst"}'
```

### Interactive Documentation

Swagger UI is available at `/api/v1/docs` when the server is running.

## Error Handling

Use `apiError()` for consistent error responses:

```js
// Not found
await apiError(ctx, 404, 'Presentation not found');

// Forbidden
await apiError(ctx, 403, 'Access denied to this presentation');

// Bad request with details
await apiError(ctx, 400, 'Validation failed', { details: errors });
```

## Security Considerations

- API keys are never stored in plaintext (only SHA-256 hash)
- Keys can be revoked instantly via soft delete (`revoked_at` timestamp)
- Rate limiting prevents abuse
- Per-key permissions limit access
- Presentations are listed through the key owner's collection (`listPresentationPage`: decks they own or made, matched on `users.id`, plus organization-visible decks), one page at a time with `limit` and `cursor`; the predicate is part of the query, so a page never holds a deck the owner cannot open

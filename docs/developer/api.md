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
│   ├── exports.js      # Export handlers (JSON, HTML, PPTX, PDF)
│   ├── ai.js           # AI generation endpoints
│   └── resources.js    # Themes, slide types, image library
```

### Related Files

| File | Purpose |
|------|---------|
| `server/storage/api-keys.js` | API key CRUD and validation |
| `server/storage/api-usage.js` | Usage tracking and rate limit checks |
| `server/routes/api/api-keys.js` | Internal API for key management |
| `server/db/migrations/029_api_keys.js` | Database schema |
| `docs/openapi.yaml` | OpenAPI 3.0.3 specification |

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

### Per-Minute Limits (In-Memory)

Uses token bucket algorithm in `server/utils/rate-limit.js`:

```js
allowRequest(`api:${apiKey.id}`, {
  capacity: limits.requestsPerMinute,
  refillPerSec: limits.requestsPerMinute / 60,
});
```

### Daily Limits (Database)

Tracked in `api_usage_daily` table:
- `request_count` - Total requests
- `ai_request_count` - AI endpoint calls
- `export_count` - Export operations

### Tier Configuration

Defined in `server/storage/api-keys.js`:

```js
export const TIER_LIMITS = {
  free: { requestsPerMinute: 60, aiCallsPerDay: 10, exportsPerDay: 50 },
  pro: { requestsPerMinute: 300, aiCallsPerDay: 100, exportsPerDay: 500 },
  enterprise: { requestsPerMinute: 1000, aiCallsPerDay: -1, exportsPerDay: -1 },
};
```

Value of `-1` means unlimited.

## Scopes

API keys can have granular permissions:

| Scope | Access |
|-------|--------|
| `read` | List/get presentations, themes, slide types |
| `write` | Create, update, delete presentations |
| `export` | Export presentations |
| `ai` | Use AI generation endpoints |

Check scopes with:

```js
if (!requireScope(ctx, 'write')) return true;
```

## Adding New Endpoints

1. **Create handler** in appropriate file (presentations.js, exports.js, etc.)
2. **Add route** in the handler's main function
3. **Use middleware helpers**:
   - `requireScope(ctx, 'scope')` - Check permissions
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
  const { repoRoot, apiKey, url } = ctx;

  // Check scope
  if (!requireScope(ctx, 'read')) return true;

  // Do work
  const data = await myOperation(repoRoot);

  // Return response (includes rate limit headers automatically)
  await apiSuccess(ctx, { result: data });
  return true;
}
```

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
  scopes JSONB DEFAULT '["read", "write"]',
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

```bash
# Via Node.js (when auth is disabled)
node -e "
import('./server/storage/api-keys.js').then(async ({ createApiKey }) => {
  const result = await createApiKey({
    name: 'Test Key',
    ownerEmail: 'test@example.com',
    scopes: ['read', 'write', 'export', 'ai'],
  });
  console.log(result);
});
"
```

Or insert directly into database if needed.

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
  -d '{"title": "Test", "theme": "deckyard"}'
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
- Scope-based permissions limit access
- Presentations are filtered by ownership (API key owner email)

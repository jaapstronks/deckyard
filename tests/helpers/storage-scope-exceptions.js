// D331: authorization is the token itself, or the data is instance telemetry.
// Individual exports, never whole modules: credential/account reads and audit
// rows in the same modules still need a scope. Reasons are reviewed evidence.
export const STORAGE_SCOPE_EXCEPTIONS = new Map([
  [
    'server/storage/api-keys.js :: validateApiKey',
    'token: resolves the presented API key before a request scope exists',
  ],
  [
    'server/storage/analytics/reports.js :: getAnalyticsReportByToken',
    'token: resolves the globally unique analytics-report share token',
  ],
  [
    'server/storage/analytics/view-sessions.js :: getViewSessionByToken',
    'token: resolves an anonymous viewer session capability',
  ],
  [
    'server/storage/analytics/view-sessions.js :: updateViewSession',
    'token: updates the anonymous session identified by its capability',
  ],
  [
    'server/storage/analytics/view-sessions.js :: endViewSession',
    'token: ends the anonymous session identified by its capability',
  ],
  ...['magic-link', 'password-reset'].flatMap((module) =>
    [
      ['isRateLimitedByEmail', 'token: abuse limit on pre-auth token issuance'],
      ['isRateLimitedByIp', 'token: abuse limit on pre-auth token issuance'],
      [
        module === 'magic-link' ? 'createMagicToken' : 'createResetToken',
        'token: issues a pre-auth capability for delivery to the verified mailbox',
      ],
      [
        module === 'magic-link' ? 'validateMagicToken' : 'validateResetToken',
        'token: validates the presented capability',
      ],
      [
        module === 'magic-link' ? 'consumeMagicToken' : 'consumeResetToken',
        'token: atomically consumes the presented capability',
      ],
      [
        'cleanupExpiredTokens',
        'token: expires only rows of this capability lifecycle',
      ],
    ].map(([name, reason]) => [
      `server/storage/${module}.js :: ${name}`,
      reason,
    ]),
  ),
  [
    'server/storage/share-links/crud.js :: validateShareLink',
    'token: validates the presented public share token',
  ],
  [
    'server/storage/share-links/crud.js :: verifyShareLinkAccess',
    'token: checks the presented share token and password',
  ],
  [
    'server/storage/share-links/guests.js :: getGuestBySessionToken',
    'token: resolves the presented guest session capability',
  ],
  [
    'server/storage/share-links/guests.js :: verifyGuestEmail',
    'token: consumes the emailed guest verification capability',
  ],
  ...[
    'incrementUsage',
    'getTodayUsage',
    'getUsageHistory',
    'checkAiRateLimit',
    'checkExportRateLimit',
    'getRateLimitHeaders',
    'cleanupOldUsage',
  ].map((name) => [
    `server/storage/api-usage.js :: ${name}`,
    'telemetry: instance API-key quota counters, no organization-owned records',
  ]),
  ...[
    'recordInstanceHealth',
    'countInstanceHealth',
    'countDeckView',
    'readInstanceHealth',
    'readFirstInstanceHealthDay',
    'pruneInstanceHealth',
  ].map((name) => [
    `server/storage/instance-health.js :: ${name}`,
    'telemetry: instance usage counters, no person/deck/organization in stored rows',
  ]),
]);

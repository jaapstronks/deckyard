// Central place to derive a display-friendly name for a logged-in user.
// Used by AI and external integrations (e.g. Notion) that want a stable
// "human-ish" identifier even when auth users don't have names configured.

export function getDisplayNameForUser(authedUser) {
  const name = String(authedUser?.name || '').trim();
  return name;
}

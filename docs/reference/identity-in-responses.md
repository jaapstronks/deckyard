# Identity in API responses

How a Deckyard API response names a person, and when it may disclose an
address. Normative for `server/routes/api/**` and the storage mappers behind
it. The rule about _comparing_ identities is a different one and lives in
`shared/identity-match.js`; this document is only about what a payload says.

## The rule

> A response names a person with `{ id, displayName }`. An email crosses the
> boundary only where the viewer has a claim on it.

```jsonc
{
  "id": "…",
  "updatedBy": { "id": "2f1c…", "displayName": "Jaap Stronks" },
}
```

- `id` — the stable `users.id`, or `null` for someone with no user record on
  this instance (an external collaborator, a legacy row). A defined absence,
  not an error.
- `displayName` — what to render. Never empty; a field that names nobody is
  `null` in its entirety rather than an identity with a blank name.

A viewer has a claim on an address when it is **their own**, when they
**addressed that person** (a collaborator they invited, a share-link guest
they mailed), when it is **the owner of something they can already open**, or
when they are **an admin of the organization** the person belongs to. Every
other display of a person uses the pair.

## Where the pair is built

`server/storage/display-identity.js`:

| function                                     | use                                                  |
| -------------------------------------------- | ---------------------------------------------------- |
| `toDisplayIdentity(id, email, lookup)`       | a row with an id column beside the address           |
| `toStoredActorIdentity(email, name, lookup)` | an event row with a denormalized actor name          |
| `resolveDisplayNames(stamps)`                | one batched name lookup per read, passed as `lookup` |

`toDisplayIdentity` is synchronous and total: a mapper always gets the
canonical shape, so a read path that forgets the lookup degrades to a name
derived from the address (`shared/display-name.js`) rather than leaking one.
Resolve **before** mapping — the address is the lookup key, and by the time an
object is mapped it is deliberately gone.

Resolutions are memoized in-process for 60 seconds. Writes that change a name
(`writeUserSettings`, an admin `updateUser`) clear the memo, so a rename lands
immediately.

## Avatars

The display name arrives with the payload; only the profile _image_ still
needs a fetch. `GET /api/users/profiles?ids=<uuid>,<uuid>` answers it, keyed
on the stable id and scoped to the caller's organization. It does not accept
addresses, and therefore cannot be used to probe whether one exists.

`createAvatar()` takes a ready `name` plus an optional `seed` (any stable
identifier) that is hashed for the initials colour. It no longer derives a
name from an address.

## Implementation status

The rule is enforced by `tests/response-identity-shape.test.js`, which scans
the storage return literals and `serveJson` payloads for address-shaped keys
and bare display stamps. It carries two allowlists, each entry with a reason.

Not every surface is converted yet. The remaining entries are marked
`STILL TO CONVERT` in that test and share one blocker: the address is not only
displayed there, it is also **compared** — by a client mirror deciding which
affordance to show, or by a server guard falling back to the address for rows
whose id column is a defined `NULL`. Converting those means retiring the email
fallback in the matching rule first, which is a decision about legacy rows
rather than a rename. Deck `createdBy`/`trashedBy`, the library and collection
creator stamps, the comment author and the slide-lock holder are in that set.

Converted today: deck `updatedBy` (every list and single read, including the
shared-with-me list and the popular board), version `createdBy`, notification
and activity-event `actor`, and the library/collection `updatedBy`.

## Public API v1

`/api/v1/*` exposes **ids only** — `ownerId`, `createdById`, `updatedById` —
and returns `ownerEmail` solely to an API key that belongs to the owner. It
carries no `displayName`: a machine consumer resolves names itself if it wants
them. See `docs/openapi.yaml`.

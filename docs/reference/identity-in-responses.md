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
(`writeUserSettings`, an admin `updateUser`, the SSO login name refresh) clear
the memo, so a rename lands immediately. A batch keeps its own answers: a memo
cleared halfway through one response cannot turn a resolved name back into a
derived one.

## Avatars

The display name arrives with the payload; only the profile _image_ still
needs a fetch. `GET /api/users/profiles?ids=<uuid>,<uuid>` answers it, keyed
on the stable id and scoped to the caller's organization. It does not accept
addresses, and therefore cannot be used to probe whether one exists; a value
that is not uuid-shaped is dropped before storage sees it (`server/utils/uuid.js`).

`createAvatar()` takes a ready `name` plus an optional `seed` (any stable
identifier) that is hashed for the initials colour. It no longer derives a
name from an address.

## Implementation status

The rule is enforced by `tests/response-identity-shape.test.js`, which scans
the storage return literals and `serveJson` payloads for address-shaped keys
and bare display stamps. It carries two allowlists, each entry with a reason.

**The address is no longer a key.** `matchesIdentity` (`shared/identity-match.js`)
compares `users.id` and nothing else since decision D22 (a): a stamp whose id
column is a defined `NULL` — a legacy row, an external collaborator — names
nobody, and no address is consulted to rescue it. That fallback was the reason
an address had to travel at all, because the client mirrors could not answer "is
this mine?" without one. With it gone, the remaining conversions are renames
rather than decisions. See `permission-model.md` § _Identity: which key decides_
for the rule and its two boundary cases (the auth-off operator, the dev bypass).

What is left is marked `STILL TO CONVERT` in that test: the **comment author**
and the **slide-lock holder**. Comments additionally need an `author_user_id`
column before their author can be named by id.

Converted: deck `ownerId` aside, every person a deck names — `createdBy`,
`updatedBy`, `trashedBy` — plus the library and collection creator/trasher, the
share-link issuer, the admin authoring stamps (custom slide types, font
families, analytics reports), version `createdBy`, notification and
activity-event `actor`, and the collab SSE `slides.updated` actor (which carries
`actorId` alone).

**The owner is the one address that stays.** `ownerEmail` travels on a deck the
reader can already open, so the owner keeps a flat `ownerId` beside it while
everyone else on the deck is a `{ id, displayName }` pair. That asymmetry is the
claim rule, not an oversight: the id in the pair is still what
`shared/identity-match.js` compares (`createdBy.id`), and a table with no id
column of its own (share links, custom slide types, font families, analytics
reports) resolves the id from the address at read time — see
`toStoredActorIdentity` in `server/storage/display-identity.js`.

One behaviour follows from that: a deck's **notification recipients** are its
owner and its collaborators. A creator who is not the owner used to be added by
address; there is no address to add any more, and after an ownership transfer
that person is a collaborator anyway.

## Public API v1

`/api/v1/*` exposes **ids only** — `ownerId`, `createdById`, `updatedById` —
and returns `ownerEmail` solely to an API key that belongs to the owner. It
carries no `displayName`: a machine consumer resolves names itself if it wants
them. See `docs/openapi.yaml`.

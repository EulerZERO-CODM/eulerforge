# The optional server

Euler's Forge is local-first. Every studio, save, reopen and export works with no account and no
network. This document describes the **optional** server that Phase 7 adds for people who want their
projects on a machine they control, and it is precise about what that server is and is not.

## What it is

A small set of Next.js route handlers (`src/app/api/**`) over a dependency-free JSON file store
(`src/server/store.ts`), implementing:

| Endpoint                                | Method            | Purpose                                                              |
| --------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `/api/auth/register`                    | `POST`            | Create an account and start a session in one response                |
| `/api/auth/login`                       | `POST`            | Sign in; identical answer for a bad password and an unknown email    |
| `/api/auth/logout`                      | `POST`            | Revoke this session and clear the cookie                             |
| `/api/auth/session`                     | `GET`             | `{ account: Account \| null }`; anonymous is a state, not an error    |
| `/api/account`                          | `GET/PATCH/DELETE`| Profile rename; delete the account and everything it owns            |
| `/api/account/password`                 | `POST`            | Change password; revokes every other session                         |
| `/api/documents`                        | `GET`             | Summaries of the signed-in account's documents, newest first         |
| `/api/documents/:id`                    | `GET/PUT/DELETE`  | Read, revision-checked save, delete                                  |
| `/api/documents/:id/shares`             | `GET/POST`        | List links; create one (the token is returned once)                  |
| `/api/documents/:id/shares/:shareId`    | `DELETE`          | Revoke a link                                                         |
| `/api/shared/:token`                    | `GET`             | Read-only document for a link holder, no session required            |
| `/api/catalogue`                        | `GET`             | Paginated catalogue with licence and provenance                       |
| `/api/server/status`                    | `GET`             | What this server offers, its schema version and limits                |

The interface for it is the settings page (`/settings` → *Account and sync*). Nothing else in the
application changes when it is absent.

## Architecture choice (ADR-0027)

**Route handlers in the existing Next.js app, not a separate service.** The app is a single Next.js
build; adding a second deployable would mean a second build, a second dependency tree and a second
deploy target for one optional feature. Route handlers share the platform's own schema
(`forgeDocumentSchema`), so a document the app could not open cannot be stored.

**A JSON file store, not a database.** The goal of this phase is to make the remote boundary real and
testable without inventing infrastructure the repository cannot run. The store serialises every
operation through one in-process queue, writes atomically (temporary file then rename), and keeps
`meta.json` with a schema version. The trade is explicit: **one process per data directory**. A
second instance, or several Node workers, would race on the files. For anything beyond a single
instance, replace `ForgeStore` with a database adapter — the route handlers only use its methods.

**Cookies, not bearer tokens in JavaScript.** A session is 256 random bits in an `HttpOnly`,
`SameSite=Lax` cookie; the server stores only its SHA-256 digest. Nothing in the client bundle can
read a session token, and revocation is a delete rather than a denylist.

**Passwords with scrypt.** The Node standard library's `scrypt` (N = 32768, r = 8, p = 1) with a
random 16-byte salt per password; parameters are stored with the hash so they can be raised later
without invalidating existing accounts. Verification is constant-time, and a malformed record fails
closed.

## Running it locally

```bash
npm ci
cp .env.example .env.local
npm run dev                          # http://localhost:3000
```

Open `/settings`, create an account under *Account and sync*, and the endpoints become usable. By
default the data lives in `.data/` beside the app (git-ignored); set `FORGE_DATA_DIR` to put it
somewhere else:

```bash
FORGE_DATA_DIR=/var/lib/eulerforge npm run start
```

There is **no secret to configure**. Passwords are user-chosen and hashed, session tokens are
generated per sign-in, and share tokens are generated per link. `.env.example` says so, and no
credential is read from the environment anywhere in `src/server/**`.

### Data directory layout

```
.data/
  meta.json                 { schemaVersion, createdAt }
  accounts.json             [{ id, email, displayName, password: { algorithm, N, r, p, salt, hash }, … }]
  sessions.json             [{ tokenHash, accountId, createdAt, expiresAt }]
  shares.json               [{ id, tokenHash, documentId, ownerId, createdAt, expiresAt }]
  documents/
    index.json              [{ id, ownerId, title, documentTypeId, revision, …, bytes }]
    <document-id>.json      { id, ownerId, revision, updatedAt, document }
```

Ids from the client are validated against `^[A-Za-z0-9._-]{1,120}$` before they become file names.

### Migrations

`meta.json` carries `SERVER_SCHEMA_VERSION`. On start-up the store creates missing files and refuses a
directory written by a newer build (`503` with a sentence) rather than silently downgrading it.
Migrations are forward-only and apply in order; there is no downgrade path, and a restore from backup
is the documented way back. Bumping the version is a code change with a new step in
`ForgeStore.init`: no data is rewritten in place without it.

## Tests

The server is tested by calling the **real route handlers** with real `Request` objects and a
temporary data directory — not by mocking fetch:

```bash
npx vitest run src/server        # 25 tests
```

They cover: cookie attributes, password hashing never storing the plaintext, duplicate-email and
validation messages, identical answers for a wrong password and an unknown email, session expiry and
revocation, cross-origin refusal, rate limiting, revision conflicts with the server's revision in the
`409`, schema validation before storage, **cross-account isolation in both directions** (another
account's document is `404`, not `403`), share creation/listing/revocation and expiry, account
deletion cascading to documents, shares and sessions, catalogue paging and filters, and the status
endpoint not leaking the data directory.

The sync *plan* is tested separately (`src/core/account/sync.test.ts`) because it is a pure function:
upload, download, in-sync, conflict-with-no-history, conflict-after-both-changed, and the fact that a
corrupt timestamp can never beat a server copy that has changed.

## Deployment

This repository does not deploy the server anywhere, and nothing here implies it is deployed.

To run it:

1. Build with `npm ci && npm run build`, run `npm run start` on a host you control.
2. Give it a persistent volume and point `FORGE_DATA_DIR` at it. A container without a volume loses
   every account and document on restart.
3. Terminate TLS at a reverse proxy (Caddy, nginx, your platform's ingress). The session cookie is
   marked `Secure` automatically when `X-Forwarded-Proto: https` is present; without TLS it is not,
   and it should not be used over plain HTTP beyond localhost.
4. Run exactly **one** instance per data directory. The store is single-process by design.
5. Back up by copying the data directory while the server is idle. Restore by putting it back; the
   schema version decides whether the build accepts it.

Not implemented, and not claimed: multiple instances, a real database, email delivery (verification,
password reset), OAuth, multi-factor authentication, team roles, real-time collaboration, presence,
billing or payments. The learn/Learning hub, studios and exports do not need any of it.

## Threat model and limits

- **Rate limiting is in-process.** Ten failed sign-ins per client+email per ten minutes, five
  registrations per client per hour. It stops a scripted loop against one instance; it does not
  survive a restart and does not coordinate across instances.
- **No email verification.** Anyone who can reach the endpoint can register an address they do not
  own. That is acceptable for a self-hosted tool and is written down rather than implied.
- **Share links are bearer capabilities.** Anyone with the link can read the saved snapshot until it
  expires or is revoked. The token is shown once; the server keeps a digest.
- **The share page is read-only.** It offers the project file as a download; it does not edit the
  shared copy, and no editing UI is implied.
- **No audit log.** Document access is not recorded beyond the stored `updatedAt` timestamps.

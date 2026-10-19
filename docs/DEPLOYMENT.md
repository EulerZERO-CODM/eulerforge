# Deployment: a Next.js app with an optional server

Euler's Forge is a browser-first application. A deployment is a Next.js build and, optionally, the
account server's data directory. Nothing here is required for the studios: local projects, editing,
reopening and export all work with no environment variables and no network.

This document records what a host needs, what the code refuses to do, and what has actually been
verified. It is deliberately separate from `docs/SERVER.md`, which describes the server's API and
threat model.

## What a host has to provide

| Requirement | Detail |
| --- | --- |
| Node.js | 22.12 or newer (`.nvmrc` pins 22.22.3; CI also runs 24.x) |
| Install | `npm ci` from the lockfile |
| Build | `npm run build` (Next.js 16, type-checking enabled) |
| Start | `npm start`, or the platform's own Next.js runtime |
| Filesystem | Writable only if the optional account server is used, and only a single writer — see below |

No database, queue, cache, email provider or payment provider is required, because none is
implemented.

## Environment variables

The full list with comments is `.env.example`. The three groups have different threat models.

### Public build-time values (`NEXT_PUBLIC_*`)

These are **inlined into the client bundle at build time**. Changing one requires a redeploy; setting
it only at runtime has no effect. Never put a secret in this group.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_FORGE_SITE_URL` | `http://localhost:3000` | Absolute origin used in metadata; must be the preview/production origin |
| `NEXT_PUBLIC_FORGE_CATALOG_SOURCE` | `sample` | `sample` or `empty`; no remote catalogue adapter exists |
| `NEXT_PUBLIC_FORGE_TELEMETRY` | `off` | `off` is the only accepted value |
| `NEXT_PUBLIC_FORGE_ENVIRONMENT` | `development` | `development`, `preview` or `production`; a label, not a security control |

### Server-only values

Read by route handlers or the server runtime. Unprefixed on purpose: Next.js does not inline them
into the browser bundle.

| Variable | Required | Meaning |
| --- | --- | --- |
| `FORGE_DATA_DIR` | No | Directory for the account server's JSON store. Defaults to `.data/` beside the app |
| `ASSISTANT_PROVIDER_URL` | No | OpenAI-compatible chat-completions URL |
| `ASSISTANT_PROVIDER_KEY` | No | Provider key, held only by the server |
| `ASSISTANT_PROVIDER_MODEL` | No | Model name sent to the provider |

The assistant variables are read together: with none set, the deterministic native planner is the
only planner and the panel says so. A partial configuration produces a readable
"provider not configured" error rather than a crash.

### Serverless platforms

Serverless filesystems do not survive an instance. On a host that sets `VERCEL` or
`AWS_LAMBDA_FUNCTION_NAME`, the account routes therefore answer **503** with an explanation instead of
writing accounts to a directory that will disappear. This is what a preview deployment should do:

- the studios, local saving, reopening and export are unaffected;
- accounts, sync and share links are **unavailable in the preview**, and the UI reports that;
- a self-hosted container with a real volume can set `FORGE_DATA_DIR` and use the file store, with
  exactly one process, as documented in `docs/SERVER.md`.

A multi-instance deployment would need a database adapter. None is implemented, and the JSON store
must not be presented as one.

## Vercel

The project builds with the default Next.js preset; no `vercel.json` is needed. Suggested settings:

- Framework preset: **Next.js**
- Install command: `npm ci`
- Build command: `npm run build`
- Node.js version: **22.x**
- Output: the default `.next`

Preview environment variables:

```
NEXT_PUBLIC_FORGE_SITE_URL=https://<preview-host>
NEXT_PUBLIC_FORGE_ENVIRONMENT=preview
```

Do not set `FORGE_DATA_DIR` to an ephemeral path on a serverless preview, and do not set
`ASSISTANT_PROVIDER_*` in a preview that other people can reach unless the quota is intentional. When
those variables are absent, the provider disclosure panel says that no model is configured.

### Status of the preview

On the audit branch (`arena/83956338-eulerforge`) the production build succeeds locally
(`npm run build`) and the full local gates (`npm run verify`) pass. **No Vercel deployment was created from this environment**, so there is no deployed URL,
deployment log or smoke-test result to report. A preview must be imported from the repository by a
person with access to the Vercel account; after it builds, the checks that matter are:

1. `/studios` lists five studios and each route loads;
2. Design: place a shape, save, reload the page, confirm the document is restored;
3. Photo: import a PNG, move one adjustment, export, confirm the browser downloads a file;
4. `/platform-status` and `/roadmap` render the ledger without a server;
5. `/settings` reports storage state and the account server as unavailable;
6. no `ASSISTANT_PROVIDER_KEY` or provider URL appears in the browser bundle or a network response.

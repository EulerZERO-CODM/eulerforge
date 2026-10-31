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

## Browser verification

The claims that only a real browser can settle — canvas pixels, pointer capture, real downloads, real
decoding, WebGL2 fallback — are covered by the Playwright suite in `e2e/` (84 tests in 15 files), run
against the production build by the `Browser (Chromium)` CI job.

On the audit branch the suite was executed in the development container against this head's
production build, with the repository's own `playwright.config.ts` — no local override, no changed
timeouts, `retries: 0`:

```
npx playwright test       84 passed
```

The container cannot reach Playwright's browser CDN and has no system NSS, so the browser was the
Chromium 153 binary shipped inside the `@sparticuz/chromium` package, with that package's own NSS/NSPR
libraries and SwiftShader (without them the browser starts but has no WebGL2, and Photo Studio's
GPU-parity tests fail honestly rather than silently); nothing in the repository was changed to
accommodate it beyond pointing Playwright's browser cache at that binary. The suite covers, among
other things: project creation and reopening, layer
selection and pointer and keyboard transforms, undo and redo, snapping, text wrapping, PNG/JPEG/SVG/zip
export with the downloaded bytes decoded again, Photo Studio's WebGL2 and CPU parity, Video Studio's
import, scrubbing, frame export and recording, the assistant's multi-step tasks, and the honest
reporting of a browser that refuses storage.

`e2e/readiness.spec.ts` adds the promises a first-time user relies on:

- **a phone-sized screen** (390 × 844): the drawer is the navigation, the page never scrolls
  sideways, and a project can be created, edited, saved, reloaded and exported to a real 320 × 240
  PNG from that layout;
- **no optional server**: every `/api/**` request is failed at the network layer, and the studios,
  saving, reopening and export still work while the account panel says *"Working locally, as
  designed"*;
- **damaged saved data**: a truncated index produces a sentence with the recovery step (clear it in
  Settings › Local data) and a link to that screen, is not deleted behind the user's back, and the
  product is fully usable again after the deliberate reset;
- **the narrowest phone** (320 × 568): every destination fits without a sideways scroll, and so does
  the Design workspace with a real project open — the densest screen in the product;
- **every destination exists**: each lesson the Learning hub links to is a page with one top-level
  heading, and a stale or mistyped URL is a truthful `404` with a heading of its own rather than a
  blank render.

## Vercel

The project builds with the default Next.js preset; no `vercel.json` is needed. Suggested settings:

- Framework preset: **Next.js**
- Install command: `npm ci`
- Build command: `npm run build`
- Node.js version: **22.x** or **24.x** (CI verifies both; the linked project runs 24.x)
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

**There is no preview deployment. The Vercel project cannot currently produce one, and this was
verified rather than assumed.** The audit branch (`arena/83956338-eulerforge`) builds and passes its
gates, and its build was verified in preview configuration locally (see below), but no hosted preview
URL exists and none is claimed here.

The project `eulerforge-preview` (`prj_lo9EFheigszfnWCZHN3iiYvuSuHL`) is connected correctly:

- **Git**: `github` → `EulerZERO-CODM/eulerforge` (repository id 1415088821);
- **Production Branch**: `main`;
- **Framework preset**: Next.js, install `npm ci`, build `npm run build`, output `.next`, root the
  repository, Node.js 24.x;
- **Environment**: `NEXT_PUBLIC_FORGE_ENVIRONMENT=preview` and
  `NEXT_PUBLIC_FORGE_SITE_URL=https://eulerforge-preview-git-arena-83956338-eulerforge-euler-zero.vercel.app`
  for the `preview` target only. Nothing is set for `production`, no provider key or data directory is
  set anywhere, and no secret is stored in the repository;
- **`gitProviderOptions.createDeployments` is `disabled`**, and the project has no production
  deployment.

That last pair is what blocks a preview. Every deployment requested for this branch has come back
`target: "production"`, whichever way it was requested:

| Attempt | How | Returned | Outcome |
| --- | --- | --- | --- |
| 1 | deployment API, git source, no target | `production` | deleted before it initialised |
| 2 | push to the branch (Git integration) | `production`, `PROMOTED`, aliases assigned | deleted, aliases removed |
| 3 | deployment API, git source, `target: "preview"` | `production` | deleted before it initialised |
| 4–6 | pushes of later commits on this branch | `production`; one completed and was promoted before it could be deleted | deleted |

Every push to this branch therefore creates one production-target deployment that has to be deleted
again. That includes the pull request's own `Vercel` check, which reports `fail` because it points at a
deployment deleted by this rule — it is not a build failure, and it cannot go green until the project
can produce a preview.

The target field is not honoured for git-sourced deployments of this project, and because the project
had no production deployment the first of them was promoted to the production alias. Deploying this
branch therefore creates a production deployment, which is outside what this work is allowed to do, so
the work stopped instead of retrying. The Git integration is *not* a safe preview path on this
project: an earlier version of this document claimed non-`main` branches were deployed as previews, and
that claim was wrong.

What an operator can do to enable a real preview (none of it may be done automatically from this
branch):

1. In the Vercel dashboard open the project → **Settings → Git** and re-enable deployments for the
   repository (this is the `createDeployments` setting above). With it disabled, Git only builds the
   production branch and any requested deployment is treated as the production one.
2. Confirm **Settings → Git → Production Branch** is still `main`, then push or re-run a deployment for
   `arena/83956338-eulerforge`. The result must report `target: "preview"` and get a
   `<branch>-<project>.vercel.app` alias.
3. Check the deployment's *target* before using it. If it reports `production`, delete it: it does not
   belong to this work.

#### What was verified instead

The same commit was built and served in preview configuration (`NEXT_PUBLIC_FORGE_ENVIRONMENT=preview`,
`NEXT_PUBLIC_FORGE_SITE_URL` set to the branch alias, `VERCEL=1` so the server follows the serverless
contract, `next start`), and exercised in Chromium:

- `/`, `/studios`, every studio route — the five implemented studios plus the 3D entry that is
  marked exploratory — `/projects`, `/platform-status`, `/roadmap`, `/settings`, `/assets`, `/learn`,
  `/create` answer 200; an unknown studio slug answers 404;
- `/api/server/status` reports `available: false` with the "filesystem is not persistent" sentence,
  `/api/documents` answers 503 with the same sentence, `/api/auth/session` returns
  `account: null` with that sentence, `/api/catalogue` still serves the bundled sample, and
  `/api/shared/<bad token>` answers 404;
- the readiness suite (phone, narrowest phone, first visit, damaged storage, API unreachable) passes
  6/6, as does the rest of the browser suite listed under *Browser verification*.

This is evidence about the build, not about a hosted URL: nothing here proves the Vercel CDN serves
those routes, because no deployment exists to serve them. Run the checklist below against the real
preview URL the moment one exists.

#### One configuration trap this caught

Preview configuration exposed a real defect that CI could not: `src/config/env.ts` read the public
variables by passing `process.env` into a parser as a value, so Next.js never inlined
`NEXT_PUBLIC_*` into the client bundle. The browser fell back to the defaults
(`development`, `http://localhost:3000`) while the server used the configured values, producing a
React hydration mismatch on every page (`#418`) and a footer naming the wrong environment. With no
`NEXT_PUBLIC_*` set — as in CI — both sides agreed on the default, so the defect was invisible. It is
fixed by reading each variable through a literal `process.env.NEXT_PUBLIC_*` member expression, and
`src/config/env.test.ts` guards both the values and the literal-reference contract.

**Set these variables for the build as well as the runtime.** Vercel passes them to both, but a
hand-rolled build that sets them only for `next start` renders a mismatched footer, because the server
component reads them at request time while the client takes the value inlined at build time.

After the repository is connected and a preview deployment exists, the checks that matter are:

1. `/studios` lists five implemented studios plus the exploratory 3D entry, and each route loads;
2. Design: place a shape, save, reload the page, confirm the document is restored;
3. Photo: import a PNG, move one adjustment, export, confirm the browser downloads a file;
4. `/platform-status` and `/roadmap` render the ledger without a server;
5. `/settings` reports storage state and the account server as unavailable;
6. no `ASSISTANT_PROVIDER_KEY` or provider URL appears in the browser bundle or a network response.

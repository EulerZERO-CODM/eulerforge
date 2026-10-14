# Working in this repository

Conventions for humans and coding agents editing Euler's Forge. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the map and
[docs/DECISIONS.md](docs/DECISIONS.md) before changing a boundary.

## Commands you must be able to run

```bash
npm ci                 # reproducible install from package-lock.json
npm run verify         # format:check → lint → typecheck → test → build  (same as CI)
npm run dev            # development server
npm run test:e2e       # Playwright against the production build (npm run build first)
```

`npm run test:e2e` is the only way to check anything that depends on real browser behaviour — native
pointer capture, the browser's own canvas rasteriser, a file download. jsdom supplies none of the
three, so a unit test over those paths proves nothing about them (ADR-0018). Run `npm run test:e2e`
before claiming such a capability works, and if Chromium is unavailable, say that the check was not
run rather than implying it passed.

`npm run typecheck` is expected to pass with or without a dev server running (`.next/dev/types` is
excluded from the type-check project for that reason — see ADR-0003).

Run `npm run verify` before proposing a change. Never claim a command passed without running it, and
never weaken a check to make something pass.

## Non-negotiable rules

1. **Nothing fake.** Every visible control either works, or is disabled/unavailable with the reason
   next to it. Do not add placeholder editors, fabricated analytics, fake success messages or dead
   links. If a capability is not built, mark it `planned` and say so (ADR-0010).
2. **Never present a fallback as durable.** If browser storage is unavailable, the app keeps working
   in memory but every surface must say so — no "Saved" indicator, badge or copy without checking
   `storageStatus`, and no two-way `isVolatile()` test on copy that makes a *claim*: an uninspected
   browser is undetermined, not durable (ADR-0006). Equally, a zoom level must render the geometry it claims: do not cap a
   canvas with CSS and leave the control offering it (ADR-0015).
3. **Do not weaken the type system.** No `any`, no non-null assertions to silence the compiler, no
   `@ts-expect-error` without a comment explaining the upstream bug, no disabling strict flags. Prefer
   fixing the model: `exactOptionalPropertyTypes` usually means a conditional spread is missing.
4. **Do not silence lint.** Fix the cause or add a narrow, commented disable. Blanket rule
   exclusions in `eslint.config.mjs` need a reason in the commit message.
5. **Respect the layers.** `src/core/**` stays framework-free (no React, no DOM, no storage).
   Components never import `src/core/persistence/**` — ESLint enforces it.
6. **Documents are immutable.** Mutate through `applyDocumentPatch` / `DocumentSession.commit`, never
   in place.
7. **Route integrity.** Every href a user can click must resolve to a page under `src/app`. Tests for
   this live in `src/testing/routes.ts` and the shell/studios/learning suites; extend them rather than
   eyeballing.
8. **Honesty in content.** Lessons and copy must not imply that unbuilt studios work. Planned studios
   and formats are labelled. Sample assets stay labelled as samples (ADR-0008).
9. **Accessibility is not optional.** Keyboard reachability, visible focus, labels on icon-only
   controls, and `prefers-reduced-motion` support are part of done (ADR-0014).

## Style

- TypeScript strict; `type` aliases for data shapes, `interface` only where a module is *meant* to be
  implemented elsewhere.
- Comments explain *why*, not *what*. If a rule or a workaround looks odd, the comment says which
  constraint forced it and which document records the decision.
- ASCII only in source files. Prettier owns formatting; run `npm run format` rather than hand-aligning.
- Import order is handled by convention: external packages, then internal absolute-ish relative
  imports, then types.
- Keep components presentational. Business rules belong in `src/core/**`, orchestration in
  `src/state/**`.

## Adding things

| Adding…              | Also do                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| A route              | Add it to `NAV_GROUPS` if it belongs in navigation; add a link from the surface that needs it.          |
| A studio             | Definition in `src/core/studios/definitions.ts`, honest `availability`, owned document type.            |
| A lesson/concept     | Content in `src/core/learning/content.ts`; exercise links must point at real routes.                    |
| A capability claim   | Entry in `src/core/platform/status.ts` with `verification` evidence.                                    |
| A roadmap item       | `src/core/platform/roadmap.ts` with dependencies and measurable completion criteria.                    |
| A dependency         | Justify it in the PR description; prefer platform features. Record anything architectural.              |
| A browser-only claim | A spec in `e2e/**` that reads persisted state or downloaded bytes; `docs/ROADMAP.md` lists what it still does not reach. |
| A new ADR            | Append to `docs/DECISIONS.md` with context, decision, reasoning and consequences.                      |

## Tests

- Domain behaviour: `src/**/*.test.ts`. Component behaviour: `src/**/*.test.tsx` (Testing Library with
  the in-memory service graph from `src/testing/forge-services.ts`).
- Test names describe the user-visible guarantee ("refuses an empty name, keeps the saved value"),
  not the implementation.
- Failures found by a test are fixed in the source, not by relaxing the assertion. If a test
  expectation was wrong, say so in the commit message.

## Commits and pull requests

- Conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), imperative mood.
- A commit should leave the repository green. If it cannot, say which gate is failing and why.
- PR description: what changed, why, which gates were run, and what remains unimplemented.

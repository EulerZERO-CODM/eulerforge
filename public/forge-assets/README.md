# Forge sample graphics

Every file in this directory was authored for this repository by the project itself (see
`docs/DECISIONS.md` → ADR-0017). They exist so the Design Studio can *place a real graphic and
export it*, not to look like a stock library: there are ten files, each small and hand-written, and
each is listed in the asset catalogue with its licence (`forge-sample`) and provenance.

The SVGs use no external references, no embedded fonts and no scripts, so they render identically in
the browser canvas and in the offscreen export canvas. Sizes are declared in `viewBox` units and
match the `intrinsicWidth`/`intrinsicHeight` recorded in `src/core/assets/data.ts`.

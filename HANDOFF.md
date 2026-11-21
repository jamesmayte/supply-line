# HANDOFF — Supply Line

_Update at the end of every session._

## Status

- Phase 0, **M0.1 done** (project kit): strict TS, Vitest, Zod content schema, biome 1 sample content,
  content validation tests, CI (tests + typecheck) and a GitHub Pages workflow for the harness.
- **M0.2 done** (grid and path):
  - `core/grid.ts`: `buildGrid(map)`, `tileAt`, tile kinds (ground/rock/spawn/path/bridge/core/ore + oreId).
  - `core/path.ts`: `buildPath(map)` through tile centres; `positionAt(path, d)`, `reachedEnd`.
    Enemy position = one number (distance along path). Scrapyard 1 path = 24 tiles.
  - `core/placement.ts`: `canPlaceBuilding` / `canPlaceTower` (extractors on ore only; nothing on
    path/bridge/core/rock; occupancy set), `routeLink` (L-route, horizontal bend tried first, path crossable
    only at bridges, rock blocks, length ≤ tier `maxLength` from content).
  - `tests/grid.test.ts`: 19 tests. Total 28 green, typecheck clean.

## Next

**M0.3 — Factory graph** (see `docs/build-plan.md`). Prompt in `docs/kickoff-prompts.md`, Session 2.

## Decisions so far

- Portrait, 9-tile-wide grid, fixed enemy path, graph-rate factory (no item entities).
- Sim at 10 Hz fixed tick, seeded RNG, pure `/core`.
- Harness = Vite + Canvas on GitHub Pages so playtests happen on a phone.
- Engine for Phase 2: Godot 4 (not started until Phase 1 gate passes).

## Open questions from M0.2

- Can a link's route pass over tiles holding other buildings/towers or ore? Currently **yes** (only rock
  and non-bridge path block). Easy to tighten by passing the occupancy set into `routeLink`.
- Link length = Manhattan distance between the two buildings' tiles.

## Open questions (from spec §11)

- Auto-routed vs player-drawn links · build during waves? · cards + meta vs handcrafted ·
  share core with Factory Front? · 9 tiles wide enough? · free+unlock vs premium · final name.

- Repo is **public during Phases 0–1** for free GitHub Pages; switch back to **private before Phase 2**
  (see build-plan). Keep secrets, paid assets and signing keys out while public.

## One-time setup (James)

- Repo Settings → General → Danger Zone → Change visibility → Public.
- Repo Settings → Pages → Source: **GitHub Actions**.
- Harness URL once deployed: https://jamesmayte.github.io/supply-line/

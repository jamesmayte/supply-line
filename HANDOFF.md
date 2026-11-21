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
- **M0.3 done** (factory graph):
  - `core/factory.ts`: `FactoryState` (nodes + links, plain JSON), `makeFactoryCtx(content, grid)`,
    `stepFactory(state, ctx, dt)` = power → production → transport. Per node: `utilisation` (0..1),
    `status` (working / starved / backlogged / unpowered / idle), cumulative `produced`. Per link: `flow`/s.
  - `core/factoryBuild.ts`: `applyFactoryCommand` — `place`, `link`, `unlink`, `remove`. Bad commands
    return the unchanged state + a reason. Uses M0.2 placement + link routing.
  - Content: new `outputPorts` on buildings (default 1, hub 3).
  - `tests/factory.test.ts`: balanced chain hits 1 → 0.5 → 2/s from content; one smelter split to two
    assemblers starves both at 50%; tier-1 cap holds 3 ore/s to 2/s; unpowered / no-coal / out-of-radius
    smelters make nothing; command validation. Total 48 green, typecheck clean.

## Next

**M0.4 — Towers and ammo** (see `docs/build-plan.md`). Prompt in `docs/kickoff-prompts.md`, Session 3.
Towers become link targets (accept their ammo items); the tests' `drain()` helper is the stand-in until then.

## Decisions so far

- Portrait, 9-tile-wide grid, fixed enemy path, graph-rate factory (no item entities).
- Sim at 10 Hz fixed tick, seeded RNG, pure `/core`.
- Harness = Vite + Canvas on GitHub Pages so playtests happen on a phone.
- Engine for Phase 2: Godot 4 (not started until Phase 1 gate passes).

## Decisions in M0.3 (easy to change, flag if wrong)

- Continuous model: buffers hold fractional amounts, recipes run fractionally per tick.
- Contested items/space are shared **in proportion to demand** (hub splits evenly between equal links).
- Generators burn fuel continuously (dt / secondsPerItem per tick) whether or not anything needs power.
- Power radius = **square** (Chebyshev distance ≤ 3), so it highlights cleanly on the grid.
- Build costs and research locks are **not enforced yet** (no economy in the sim until later milestones).
- Removing a building destroys its buffered items.

## Open questions from M0.2

- Revisit once the harness exists (James, M0.3):
  can a link's route pass over tiles holding other buildings/towers or ore? Currently **yes** (only rock
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

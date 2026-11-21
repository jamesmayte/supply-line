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

- **M0.4 done** (towers and ammo):
  - Towers are factory nodes (`towerId` set) placed with the new `placeTower` command (`canPlaceTower`).
    Their input buffer **is the magazine** (content `magazine`, 20), shared across ammo types, starts empty
    and fills only from links. Towers accept only their `ammo` items, have 1 input port and no outputs.
  - `core/towers.ts`: `stepTowers(state, ctx, dt, engaged?)` runs after `stepFactory`. A cooldown
    (1 / content `fireRate`) gates shots and each shot spends one whole round, so
    **effective fire rate = min(stated, supply)** with no special case. Per tower: cumulative `shots`, `cooldown`,
    status `working` / `starved` (empty) / `idle` (not engaged). Helpers: `loadedAmmo`, `magazineCount`.
  - `tests/towers.test.ts` (10 tests). Measured over 30 s on scrapyard_1:
    - **Fed** (2 chains → hub → tier-2 link, 4 bullets/s): **3.00 shots/s** (stated rate).
    - **Underfed** (1 chain, 2 bullets/s): **2.00 shots/s** (supply rate).
    - **Empty**: 0 shots, `starved`. A full magazine cut off fires exactly 20 rounds, then stops.
  - Total 58 green, typecheck clean.

- **M0.5 done** (enemies and waves):
  - `core/game.ts`: `GameState` (plain JSON: tick, seed + rng, phase, wave clock, core HP, enemies, factory,
    kills / leaked / damageDealt, last tick's rejected commands). `makeGameCtx(content, mapId)`,
    `newGame(content, mapId, seed)`, and the single entry point **`step(state, input[], dt, ctx)`**.
    Tick order: commands → spawn → move enemies (leaks hit the core) → factory → towers fire → settle.
  - Phases: `build` → `startWave` → `wave` → `build` … → `won`; `lost` when core HP hits 0 (state then frozen).
    Factory commands work in any phase (spec: build during waves allowed).
  - Waves spawn from content (`delay` + k·`spacing` per group). Enemies move at content `speed` (tiles/s).
  - Targeting: live enemy **furthest along the path** within `range` (Euclidean from the tower's tile centre),
    ties → lower id. Instant hit, retarget every shot. Damage = tower damage × ammo multiplier,
    × (1 − armour) unless armour-piercing. Splash hits others within `splash` of the target. Air rules from content.
  - `stepTowers` now takes a per-shot `fire` callback (replaces M0.4's `engaged` set). Status `idle` = loaded,
    nothing in range.
  - `core/hash.ts`: FNV-1a over the JSON state. Determinism test: same seed + inputs ⇒ identical hash.
  - `tests/game.test.ts` (14 tests). Total 72 green, typecheck clean.
  - Sanity run, scrapyard_1, **one** 2 bullets/s chain → Gunner at (6,8), 30 s warm-up:
    | wave | kills | leaked | core HP |
    | --- | --- | --- | --- |
    | 1 | 5 | 1 | 95 |
    | 2 | 4 | 6 | 65 |
    | 3 | 10 | 2 | 61 |
    | 4 | 11 | 9 | 16 |
    | 5 | 3 | 4 | 0 (lost) |

## Next

**M0.6 — The interlock test** ⭐ (see `docs/build-plan.md`). Prompt in `docs/kickoff-prompts.md`, Session 5.
Run A = the one-chain build above; run B = two chains. Assert B kills more / loses less core HP; record numbers.

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

## Decisions in M0.4 (easy to change, flag if wrong)

- Towers live in `FactoryState.nodes` (not a separate list), so links and transport needed no new code paths.
- Magazine starts **empty**; a freshly built tower does nothing until the factory feeds it.
- Shots are whole rounds; ammo arrives fractionally, so a tower fires as soon as 1 full round is loaded.
- **Shots can't be banked**: idle or empty towers' cooldown stops at 0 (no burst from waiting).
- Towers fire their first listed ammo type that's loaded (matters once a tower takes 2 ammo types).
- Until M0.5, "engaged" is a set of tower ids passed to `stepTowers` (omitted = all engaged).
  Damage and range are in content but unused until enemies exist.
- Tower input ports = 1 (constant in `factoryBuild.ts`). Could move into the tower schema if towers should differ.
- Tower `utilisation` isn't set (per-tick shots are too noisy). The harness can compute a rate from `shots`.

## Decisions in M0.5 (easy to change, flag if wrong)

- `step` takes `ctx` (static content lookups) as a 4th argument rather than closing over it.
- **The seeded RNG isn't used yet**: nothing in the spec so far needs randomness. Seed + rng live in the state
  and the hash, ready for crits / spawn jitter / card draws. I didn't invent random behaviour to use it.
- Hits are instant (no projectiles). Damage counts only HP removed, so overkill isn't counted.
- Enemies spawn at distance 0 and move on the tick they spawn.
- Leaked enemies are removed once they deal core damage. No partial waves: a wave ends when all have
  spawned and none are alive.
- No economy yet: build costs and `startingStock` still aren't enforced.

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

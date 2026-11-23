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
  - Sanity run (at M0.5's enemy HP, since doubled in M0.6), scrapyard_1, **one** 2 bullets/s chain → Gunner at (6,8), 30 s warm-up:
    | wave | kills | leaked | core HP |
    | --- | --- | --- | --- |
    | 1 | 5 | 1 | 95 |
    | 2 | 4 | 6 | 65 |
    | 3 | 10 | 2 | 61 |
    | 4 | 11 | 9 | 16 |
    | 5 | 3 | 4 | 0 (lost) |

- **M0.6 done** (the interlock test ⭐): `tests/interlock.test.ts`.
  - Scrapyard 1, seed 1, 30 s build break, then 5 waves with no input. Both runs: one hub feeding
    **3 Gunners** at (6,8), (4,8), (2,7) over tier-2 links. **Run A** = 1 bullet chain (2/s). **Run B** = 2 chains (4/s).
  - Asserts: same towers on the same tiles; B fires more, kills > 1.2× A, leaks less, keeps more core HP,
    gets at least as far; both runs reproduce their hash.
  - Results (kills / leaked / core HP after each wave):
    | wave | A: 1 chain | B: 2 chains |
    | --- | --- | --- |
    | 1 | 6 / 0 / 100 | 6 / 0 / 100 |
    | 2 | 5 / 5 / 75 | 10 / 0 / 100 |
    | 3 | 11 / 1 / 73 | 12 / 0 / 100 |
    | 4 | 10 / 10 / 23 | 13 / 7 / 65 |
    | 5 | 4 / 5 / **0, lost** | 8 / 2 / **35, won** |
    | total | **36 kills, 21 leaked** | **49 kills, 9 leaked** |
  - Total 78 green, typecheck clean.

### What M0.6 found (read this before the gate)

The first attempt used **one** Gunner, as M0.5's sanity run did, and **A and B were identical** (same 215 shots).
- A Gunner only has a target ~40% of the time. Between engagements one chain refills its magazine, so in a fight it fires at its full stated rate. The tower is the limit, not the factory.
- With M0.5's HP, **adding a tower beat doubling the factory**:

| Gunners | 1 chain | 2 chains |
| --- | --- | --- |
| 1 | lost w5, 33 kills | identical |
| 2 | won, 56 kills, 70 HP | won, 57 kills, 85 HP |
| 3 | won, 56 kills, 70 HP | won, 58 kills, 100 HP |

- **Magazine size barely mattered** (5 vs 20 changed little). The fix that made the factory matter: enough
  towers that demand (3 × 3 = 9 shots/s) exceeds supply, plus enemies tough enough to need sustained fire
  → **enemy HP doubled** in `content/biome1.ts` (James's call, M0.6).
- **Risk for the real game:** towers are free (build costs aren't enforced), so a player can stack towers
  instead of building factory. The pillar holds only while tower count is limited. The economy (towers cost
  ingots: "cheap to place, expensive to keep firing") is what should make that trade real. Worth deciding
  before/during Phase 1.

- **M0.7 done** (build costs, added to the plan after M0.6):
  - `GameState.stock` starts as the map's `startingStock` (scrapyard_1: 20 iron ingots).
  - `place` / `placeTower` pay the content `buildCost`: **stockpile first, then hubs** (lowest id first).
    Can't afford → rejected with a reason, nothing changes. Placement errors are checked first and never charge.
    Removing refunds nothing. Helpers: `costOf`, `spendable` (stock + hub contents).
  - Interlock rewritten: the shared build costs exactly the 20 starting ingots. Run B sends chain A's ingots
    into the hub (smelter → hub), and at 21 s re-links smelter → assembler and buys chain B (9 ingots) from
    the hub. Same 30 s build break for both.
    - At wave 1, B has 14 buildings but only 11.7 rounds per Gunner (A: 19.8). Both score 6 kills in wave 1.
      After that B's 4/s takes over, and the totals match M0.6: **A 36 kills / lost, B 49 kills / won with 35 HP**.
  - `tests/game.test.ts` +6 economy tests. Total 85 green, typecheck clean.

## Phase 0 gate: ✅ passed

James (after M0.7): go with the suggestion. Phase 0 passes, and towers now cost ingots so they compete with ammo.

## Phase 1

- **M1.1 done** (render):
  - `harness/main.ts`: fixed 10 Hz sim loop (accumulator, max 20 steps/frame), 1×/2× speed, pause.
    **Auto-pauses when the tab is hidden** (invariant 5) and doesn't catch up on return.
  - `harness/render.ts`: Canvas 2D, reads state only. The map fits between the top and bottom bars
    (tile size limited by width and height). Draws:
    - Tiles, with speckled ore and a dashed path line.
    - Buildings with a letter (E extractor, S smelter, A assembler, H hub, **P generator**), a status-coloured
      border (green working, red starved, amber backlogged, grey unpowered) and a utilisation bar
      (hubs: fill level).
    - Towers with a faint range circle and a magazine ring that **flashes red when empty**.
    - Links along their L-routes, with cosmetic dots coloured by item, moving at the link's flow rate.
    - Enemies interpolated between ticks, with HP bars (armoured get an outline).
  - HTML top bar: wave n/5, core HP, ingots, kills, next/current wave makeup.
    Bottom bar: **1 chain / 2 chains** demo switch, Start wave, Pause, 1×/2×. Won / Core destroyed banner.
  - Until touch input (M1.2) the harness plays the interlock builds. They now live in
    `content/scenarios.ts`, shared with `tests/interlock.test.ts`, so the demo is exactly what the test asserts.
  - Checked in headless Chromium at iPhone 13 size: no console errors, the whole map fits, the run B
    expansion appears at ~21 s, and starved Gunners flash red.
  - Debug: `sl.state` in the browser console is the current game state.

### What to try on the phone (once merged to main and Pages has deployed)

https://jamesmayte.github.io/supply-line/
1. It opens on **2 chains**. Watch for ~20 s: ingots flow into the hub (H), then the second chain appears.
2. Tap **2×**, then **Start wave**. Start each next wave when the button lights up again.
3. Tap **1 chain** to reset with the single-chain build and compare: Gunners run dry (red rings) and walkers leak.

- **M1.2 done** (touch input):
  - **Tap an empty tile** → bottom-sheet build menu: only what's valid there, with ingot cost; unaffordable
    greyed out; one assembler entry per unlocked recipe; research-locked items (Cannon, shells, Press) and
    Lab hidden. Tap the map or Close to dismiss.
  - **Drag from a building to another** → link. Live preview along the L-route: green = valid, red = not;
    a bad drop shows a toast with the reason. Tier = lowest whose length limit fits. Out of a hub the link
    carries what the target wants (most-held first).
  - **Long-press a building** → sheet with Remove (no refund) and Unlink ↔ each of its links.
  - **Tap a building** → hint toast (inspect sheet comes in M1.3).
  - Bottom bar: **Empty** (default: 20 ingots, build it yourself) / Demo: 1 chain / Demo: 2 chains.
  - **Building while paused** is instant and doesn't advance time: new `applyCommands(state, input, ctx)`
    in `core/game.ts` = step's command phase only (tested: applyCommands then an empty step ≡ step with input).
  - HUD "Ingots" = stockpile + ingots held in hubs (what you can spend). Toasts use item names, not ids.
  - `harness/ui.ts` (DOM-free: build options, link proposals) + `tests/harness-ui.test.ts` (11 tests).
    Total 98 green, typecheck clean.
  - Checked end to end in headless Chromium (iPhone 13, touch): built a full chain by tapping + dragging while
    paused, a bad link was refused with a toast, long-press removed a hub, the hand-built Gunner killed walkers.

### What to try on the phone (M1.2)

https://jamesmayte.github.io/supply-line/ (after merge). It opens on **Empty** with 20 ingots.
1. Tap **Pause** (building while paused is instant).
2. Tap the dark coal tile at the top right (column 8, row 4) → **Extractor**. Tap the tile below → **Generator**.
3. Tap a blue iron tile (right side, rows 8–9) → **Extractor**. Next to it on ground → **Smelter**,
   then **Assembler: bullets**, then a **Gunner** beside the path.
4. Drag: coal extractor → generator, iron extractor → smelter → assembler → Gunner.
   (The smelter and assembler must be within 3 tiles of the generator, or they show grey = unpowered.)
5. Tap **Play**, wait for the Gunner's ring to fill, then **Start wave**.
6. Hold a building to remove it or unlink it.

- **M1.3 done** (run loop):
  - **15 waves** on scrapyard_1: waves 1–4 easy, ramp from 5, **Brute** mini-boss on 5 and 10
    (400 HP, slow), **Scrap Titan** boss on 15 (1500 HP, armour 0.2; its adds come later).
  - **Cards:** after each wave the seeded RNG offers 3 (the RNG's first real use; covered by determinism).
    You must pick one before the next wave. Placeholder set, **factory-side only**: +8 ingots, or
    +25% speed for extractors / smelters / assemblers (stacks multiplicatively). No tower-buff cards (pillar).
  - **Early-start bonus:** starting the next wave right after a break begins pays up to +4 ingots,
    shrinking linearly to 0 over 20 s (not for wave 1). Shown on the button ("Start wave +4").
    Also curbs the "wait in the break until every magazine and hub is full" exploit.
  - **Refunds:** remove gives back 100% of build cost in a break, 50% during a wave (shown on Remove).
  - **Stars:** won with ≥90% core HP = 3, ≥50% = 2, else 1. Result screen: stars, waves cleared, kills,
    core HP, Play again.
  - **Inspect sheet:** tap a building or tower for live stats (status, utilisation, buffers, in/out flow;
    towers: magazine, stated vs measured fire rate over the last 5 s, ammo arriving). It names the **first
    problem upstream** in plain words, e.g. "Smelter and Assembler: bullets are unpowered…", "No ammo link…",
    "The chain runs flat out but can't keep up: add another chain".
  - All rule numbers live in content (`cards`, `rules` in `content/biome1.ts`, schema-validated).
  - Tests: run-loop rules (offers, pick gating, card effects, bonus, refunds, stars), wave curve
    (`tests/waves.test.ts`), inspect logic. Interlock now runs 15 waves. Total 109 green, typecheck clean.
  - Checked end to end on an emulated iPhone 13: inspect a Gunner, clear wave 1, pick a card (Start locked
    until you do), early bonus on the button, refund note on Remove, lose a run → result screen. No page errors.

### Balance after M1.3 (scripted builds; pick the first card offered; start each wave at once)

| build | result |
| --- | --- |
| Opening, 20 ingots: 1 chain → hub → 3 Gunners (interlock A) | waves 1–3 clean, 1 leak in 4, lost on wave 8 (58 kills) |
| + 2nd chain bought from banked ingots (interlock B) | lost on wave 11 (109 kills) |
| 4 chains, 6 Gunners, +100 ingots (probe) | lost on wave 13 |

- **A single Gunner on one chain can't hold even wave 1** (80 HP walkers need ~7 s of 2/s supply each but are
  in range ~5.7 s). So "easy early waves" targets the natural opening build of 3 Gunners, not 1.
- **Nothing I scripted wins wave 15 yet.** With several speed cards stacked (×2–3), the big build made more
  bullets than 6 Gunners could fire: late game becomes **tower-limited again** (the M0.6 pattern). Whether a
  good player can win, and whether stacking cards should be capped, is for the playtest.
- Armoured enemies are kept light until shells/Cannon unlock in M1.4.

### What to try on the phone (M1.3)

https://jamesmayte.github.io/supply-line/ (after merge). Use **Demo: 1 chain** for a quick start, or build on **Empty**.
1. **Tap a Gunner** → inspect sheet with magazine and fire rates. Tap a smelter/assembler too.
2. Tap **Start wave**. When it's cleared, **pick a card** (the Start button stays locked until you do).
3. Start the next wave quickly: the button shows the early bonus (**Start wave +4**), shrinking over 20 s.
4. Hold a building: Remove shows the refund (full in a break, half during a wave).
5. Play on until you win or lose → result screen → **Play again**.
6. Tell me how waves 1–4 feel (too easy?), where it gets hard, and whether cards feel worth picking.

## Phase 1 check, first playtest (James, after M1.3): not fun yet

Lost on wave 15 (14 cleared, 184 kills), so the curve is roughly right. But:
- "A lot works but it doesn't feel very engaging."
- Didn't know what the yellow/green/full/empty bars meant; the UI should be easier to figure out.
- Ran out of map space; hard to plan a layout before knowing how it all works.
- Speed cards made no visible difference; switched to +ingots until out of space.

Diagnosis: towers firing was invisible (no tracers or hits); two overlapping visual codes with no legend;
no way to move or upgrade, so growth = sprawl; single-stage +25% cards do nothing on a balanced chain
(every stage is at its limit), and nothing said so. Per the build plan, fix feedback before features:
**M1.5 (readability and feel) now, M1.6 (room to grow) next, research (M1.4) after.**

- **M1.5 done** (readability and feel):
  - **Juice:** shot tracers + hit flashes, death pops, a red flash + short shake when the core is hit.
    All cosmetic, derived in the harness by comparing consecutive states (`core` unchanged).
  - **One status badge per building** (✓ working, ■ backed up, ✕ starved, ⚡ no power, · idle) replaces the
    coloured border + utilisation bar. Gunners show rounds left under the G. Hubs keep a fill bar.
  - **"?" button:** how to play (5 steps) + legend for badges, magazine ring and link dots. Opens once on first visit.
  - **Between-wave report** above the card pick: kills, got through, bullets made / fired, % of the wave
    Gunners were empty, ammo ceiling, and one line of advice: "Bottleneck: Smelters…", "A link is carrying
    its maximum…", "Every stage is at its limit: build another chain", "Gunners rarely ran dry: add a Gunner…",
    or "Clean wave… to get ahead, …".
  - **Card advice (James's idea):** each card shows what it would do for *this* factory, e.g.
    "+25% ammo on your current setup (2 → 2.5/s)" or "No gain: another stage limits it". The best is badged
    **Best for you**; if no speed card helps, the ingot card is recommended (another chain is the fix).
  - New `core/analysis.ts` (pure): `ammoRate` (factory ceiling with towers as bottomless sinks),
    `findBottleneck` (which building type / link would raise it), `adviseCards`, `bestCard`.
    The analysis runs once when the card pick opens (~20 ms, no visible stall).
  - Tests: `tests/analysis.test.ts` (8), report/card-note wording in `tests/harness-ui.test.ts`.
    Total 123 green, typecheck clean. Checked on an emulated iPhone 13: help on first visit, tracers firing,
    report + advice after wave 1, no page errors.

### What to try on the phone (M1.5)

https://jamesmayte.github.io/supply-line/ (after merge). The help sheet opens on your first visit (later: **?**).
1. **Demo: 2 chains**, **2×**, **Start wave**: watch the tracers, hit flashes and pops.
2. After the wave, read the report and the line under each card. Is the advice clear and right?
3. Build your own on **Empty**; make a chain where one stage is short (e.g. 2 extractors into 1 smelter)
   and see the report name it and a card show a gain.
4. Is it easier to tell what's going on? Does it feel more alive?

## Next

**M1.6 — Room to grow** (proposal in `docs/build-plan.md`): move buildings, upgrade in place, cards you can feel.
Then M1.4 research, then re-run the Phase 1 check.

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

## Decisions in M0.6

- Biome 1 enemy HP doubled (walker 80, swarmer 24, armoured 240). The M0.5 sanity table predates this.
- The interlock scenario uses 3 Gunners so that ammo, not tower count, is the binding constraint.

## Decisions in M1.5 (easy to change, flag if wrong)

- Effects (tracers, pops, shake) are harness-only, derived from state diffs; the sim has no event list.
- "Ammo ceiling" treats towers as bottomless sinks, so it measures the factory, not tower uptime.
- A card's gain is projected from the factory as it is now (60 s simulated); it doesn't model what you'll build next.
- A full link is only blamed if a higher tier would actually raise ammo (else every balanced chain would blame its links).
- M1.5 was added before M1.4 (research) per the build plan: fix feedback before adding features.

## Decisions in M1.3 (easy to change, flag if wrong)

- Simple early-start bonus (James chose it over overlapping waves): linear from +4 to 0 over 20 s, none on wave 1.
- Cards are drawn with replacement across picks (the same card can come back and stack); 3 distinct per offer.
- Card effects are factory-only. A Gunner-damage card would break "towers only get stronger through the factory".
- The card pick is a modal sheet; the build break timer keeps running while you choose (pause to think).
- Brute/boss: no armour on the Brute, light armour on the boss, since only bullets exist before M1.4.
- Phase 1 gate moved after M1.3 in this handoff: a 15-wave run is the first thing worth judging for fun;
  M1.4 research can follow the verdict.

## Decisions in M1.2 (easy to change, flag if wrong)

- **Link tier is free:** a drag gets the lowest tier long enough, so links over 6 tiles are tier 2 (4/s) with
  no research. Slightly generous vs the spec; revisit with research in M1.4.
- Remove has no refund in any phase (spec: full refund in build breaks, 50% in waves). Revisit with M1.3.
- One finger at a time; no scroll/zoom (scrapyard_1 fits on screen). Taller maps will need scrolling.
- `applyCommands` exists only for building while paused; replays (none yet) would need to record those commands.

## Decisions in M1.1

- Generator letter is **P** (power) so it doesn't clash with the Gunner's G.
- HUD bars are HTML, the map is canvas. The renderer recomputes link routes from endpoints (cached),
  since the sim stores only link length.
- Pages bundle is ~86 kB (zod comes along with content validation). Fine for now.

## Decisions in M0.7 (easy to change, flag if wrong)

- Build costs can be paid from **any** hub, not only one linked to the build site. Simplest reading of the spec's
  "drawn from a connected Hub"; tighten once the harness shows whether it matters.
- No income except what the factory delivers into hubs. Nothing refills the stockpile itself.
- No refunds on remove; spec wrecks (rebuild at half cost) are not modelled.

## Open questions from M0.6

- ~~Enforce build costs?~~ Done in M0.7.
- Is 40% tower uptime + a 20-round buffer too forgiving? Denser waves are the other lever.
- With costs in, re-check in the harness whether "one more Gunner" still beats "one more chain" for players.

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

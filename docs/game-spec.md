# Supply Line — Mobile TD × Factory Game Spec (v0.1)

Source of truth for design. Live version: https://claude.ai/artifact/66Zxt4JvyViF8knhmTYkAJ
If this file and the live doc disagree, ask James which wins before changing code.

## 1. Pitch and pillars

Supply Line is a portrait mobile tower defence game where towers only fire if your factory keeps them fed. Enemies march down a fixed path. You mine ore beside that path, refine it into ammo, and route the ammo to your turrets. Your factory's throughput sets your damage output.

**Design pillars**

1. **No supply, no shots.** Every tower uses ammo from a small buffer. When the buffer runs dry the tower stops firing. Better ammo, not upgrade coins, is what makes towers stronger.
2. **Thumb-first logistics.** Buildings connect with drag-to-connect links, not hand-laid belts. Everything is playable one-handed on a 6-inch screen.
3. **Short, complete runs.** One map is 15 waves in 10–15 minutes, and you can pause at any time.
4. **Readable at a glance.** Items show as dots flowing along links. Starved buildings go grey, and empty towers flash red.

**How it differs from what exists**

| | Mindustry | Factory Front | Supply Line |
| --- | --- | --- | --- |
| Map | Open sandbox, RTS units | Single lane, two bases | Fixed enemy path on a grid, handcrafted maps |
| Logistics | Free-form belts | Abstract node graph | Grid links between buildings |
| Factory feeds | Turrets and units | The army (units) | Turret ammo and power only |
| Session | Long, open-ended | Ages and prestige | 10–15 min runs, roguelite cards |
| Orientation | Landscape | Portrait | Portrait, one-handed |

The factory simulation core can be shared with Factory Front, since both run a deterministic building/link graph.

## 2. Core loop and session structure

A run is one map of 15 waves with a boss on wave 15. Each wave has a build break, a real-time fight, then a reward pick.

1. **Build break (untimed, or 45 s on challenge modes).** Place extractors, refiners and towers, and draw links. The next wave's makeup is shown, e.g. "12 walkers, 4 armoured, 2 flyers".
2. **Wave (real time, 1× or 2× speed).** The factory keeps running and towers pull ammo as they fire. You can still build and re-route during the wave, but the game doesn't pause for it.
3. **Reward pick.** Choose 1 of 3 cards: a new recipe, a building upgrade, a tower modifier or a one-off boost.
4. **Repeat.** Waves 5 and 10 are mini-bosses, and wave 15 is the map boss.
5. **Run end.** Stars (0–3) based on core HP left, plus Scrap (meta currency) for the permanent tech tree.

You lose a run when enemies that reach your core drain its HP to zero. Losing still pays out Scrap for the waves you cleared.

**Pause rule:** pause any time; building while paused is allowed in campaign. Challenge modes disable building while paused so leaderboards stay fair.

## 3. Map, grid and touch controls

The map is a portrait grid 9 tiles wide, so each tile is roughly a fingertip on a phone. Maps run 16–28 tiles tall and scroll vertically. Enemies spawn at the top and walk a fixed path to your core at the bottom.

**Tile types**

- **Path:** enemies walk here; nothing can be built on it.
- **Ground:** normal building space.
- **Ore patch:** only extractors can go here (iron, copper, coal or crystal). Each patch holds 1–4 tiles.
- **Rock / water:** blocks building and links; it shapes each map's puzzle.
- **Bridge points:** the only places a link can cross the path.

**Controls**

| Action | Gesture |
| --- | --- |
| Build | Tap an empty tile, then pick from a radial menu (only valid buildings show) |
| Link | Drag from a building's output to another building; the link auto-routes along the grid with an L-shaped path |
| Inspect | Tap a building: bottom sheet with input/output rates, buffer and utilisation % |
| Move / delete | Long-press, then drag or tap the bin; full refund during build breaks, 50% during waves |
| Scroll / zoom | One-finger drag scrolls; pinch zooms between 2 levels only |
| Speed / pause | Bottom bar buttons, within thumb reach |

Every common action stays in the bottom 60% of the screen. The top shows the wave preview and core HP only.

## 4. Factory model

The factory is a graph: buildings are nodes and links are edges with a throughput cap. Items aren't simulated individually; the dots are a visual of the rate. That keeps the sim cheap and deterministic.

**Rules**

- Each building has up to 3 input ports and 1 output port, plus a small buffer.
- Links carry 1 item type each. Tier 1 links move 2 items/s, tier 2 move 4/s, tier 3 move 8/s.
- Links have a length limit (6 tiles at tier 1). A Hub can relay, split or merge them.
- Power is a radius, not a wire: generators power everything within 3 tiles. Unpowered buildings run at 0%.

**Starter chain (worked example):** Iron extractor (ore 1/s) → Smelter (ingot 0.5/s) → Assembler (bullets 2/s) → Gunner (20-shot magazine). A Coal extractor feeds a Generator that powers the Smelter (radius 3). Doubling the extractors and smelters doubles the Gunner's sustained fire rate.

**Buildings (first biome)**

| Building | In | Out | Rate | Notes |
| --- | --- | --- | --- | --- |
| Extractor | — | Ore | 1/s | On ore patch only |
| Smelter | 2 ore | 1 ingot | 0.5/s | Needs power |
| Press | 1 ingot | 2 plate | 0.5/s | |
| Coal mill | 1 coal | 2 powder | 1/s | |
| Assembler | Up to 3 items | Ammo | Per recipe | Main ammo maker |
| Hub | Any | Any | Link speed | Split, merge, buffer of 50 |
| Generator | 1 coal / 4 s | Power | Radius 3 | Burns coal: early trade-off with ammo |

All rates are content data, not code.

## 5. Towers and ammo

Towers are cheap to place and expensive to keep firing. Each holds a 20-shot magazine refilled from its input link. Real fire rate = min(stated rate, ammo supply rate).

| Tower | Ammo | Role | Unlocks |
| --- | --- | --- | --- |
| Gunner | Bullets | Single target, fast | Start |
| Cannon | Shells | Splash, slow, good vs armour | Map 2 |
| Flak | Flak rounds | Anti-air only | Map 3 |
| Arc coil | Charges + power | Chains between 4 enemies | Map 5 |
| Launcher | Rockets | Long range, boss damage | Biome 2 |

| Ammo | Recipe | Per craft |
| --- | --- | --- |
| Bullets | 1 iron ingot | 4 |
| AP bullets | 1 steel plate + 1 powder | 4 |
| Shells | 1 plate + 2 powder | 2 |
| Flak rounds | 1 plate + 1 copper wire | 3 |
| Charges | 1 copper wire + 1 crystal | 2 |
| Rockets | 2 plate + 1 fuel + 1 circuit | 1 |

**Upgrades come from ammo quality.** AP bullets in a Gunner give it armour piercing without changing the tower.

**Feedback:** a ring around each tower shows its magazine; it flashes red when empty, and the inspect sheet names the upstream building that is short.

## 6. Enemies and waves

| Enemy | Behaviour | What it tests |
| --- | --- | --- |
| Walker | Follows path, average HP | Basic bullet supply |
| Swarmer | Fast, low HP, groups of 10+ | Fire rate, so ammo throughput spikes |
| Armoured | Slow, resists bullets | Whether you've built a shell or AP line |
| Flyer | Ignores path, flies straight to core | Flak coverage away from the path |
| Saboteur | Attacks links and buildings within 2 tiles of the path | Where you route supply lines |
| Boss | Large HP pool, spawns adds | Sustained output over 60+ seconds |

- The next wave is always previewed.
- Difficulty comes from mixing types, not just bigger HP; each wave forces a change to the ammo mix.
- Saboteurs appear from wave 6 on maps where links must run near the path.
- A destroyed link or building becomes a wreck you can rebuild at half cost in the next break.

## 7. Progression and modes

Five layers: three reset each run, two are permanent. Every in-run layer is paid for with factory output.

| Layer | Scope | Paid with | What it changes |
| --- | --- | --- | --- |
| Research tree | This run | Science packs (made in the factory) | Unlocks recipes, link tiers, power, tower types |
| Upgrades | This run | Plates, gears, circuits (made in the factory) | Building Mk tiers, tower levels and specialisations |
| Cards | This run | Free pick after each wave | Random boosts and twists |
| Meta tech tree | Permanent | Scrap (earned per run) | Starting kit, bigger choices, new card pools |
| Blueprints and mastery | Permanent | Boss kills, tower use | New buildings and towers, cosmetics, small perks |

### 7.1 In-run research tree

Build a Lab and feed it science packs. Every pack spent on research is a resource not spent on ammo — the run's main tension.

| Pack | Recipe | Available from |
| --- | --- | --- |
| Red | 1 iron ingot + 1 coal | Biome 1 |
| Blue | 1 plate + 1 copper wire | Biome 2 |
| Purple | 1 circuit + 1 crystal | Biome 3 |
| Gold | 1 fuel + 1 circuit + 1 steel | Biome 4 |

- One active research at a time; more Labs research faster, up to 3.
- Each node costs packs plus time, e.g. 20 red packs and 30 s.
- The tree resets each run; the meta tree can give a head start.
- Research continues during waves.

| Branch | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| --- | --- | --- | --- | --- |
| Logistics | Tier 2 links | Longer links (+3 tiles) | Hub splitters with filters | Tier 3 links |
| Industry | Press + plates | Steel | Circuits | Twin-output assemblers |
| Arsenal | Cannon + shells | Flak | AP ammo | Rockets + Launcher |
| Power | Generator efficiency | Power poles (extend radius) | Solar (no coal) | Arc coil |

Higher tiers need the next pack colour, so research pushes longer chains.

### 7.2 Building and tower upgrades

Upgrade in place; the cost is factory-made parts delivered by a link or drawn from a connected Hub.

| Tier | Effect | Typical cost |
| --- | --- | --- |
| Mk II | +50% speed, buffer ×2 | 10 plates |
| Mk III | +100% speed, +1 input port | 10 gears + 5 circuits |

Towers: levels 1–3 (range, fire rate), then pick one specialisation at level 3, fixed for that tower this run.

| Tower | Spec A | Spec B |
| --- | --- | --- |
| Gunner | Minigun: 2× fire rate, 2× ammo use | Marksman: long range, crits, 0.5× ammo use |
| Cannon | Mortar: huge splash, hits flyers on landing | Breacher: armour shred debuff |
| Flak | Burst: area damage vs flyer swarms | Seeker: locks onto one large flyer |
| Arc coil | Storm: chains to 8 targets | Overload: stun for 1 s |
| Launcher | Barrage: 4 small rockets | Tactical nuke: one shot every 20 s |

Specialisations change ammo use, so choosing one is a factory decision too.

### 7.3 Meta tech tree (permanent)

Scrap from every run (win or lose) goes into a permanent HQ tree: four branches of ~8 nodes (~32 total). Each node needs the one above; each branch ends in a capstone. Sample nodes, top to bottom:

| Branch | Node 1 | Node 2 | Node 3 | Capstone |
| --- | --- | --- | --- | --- |
| Engineering | Extra extractor | Faster Labs +20% | Start with Mk II | Overclock +25% |
| Arsenal | Magazines +10 | Full tower refunds | Specs unlock at Lv 2 | Start with AP ammo |
| Command | +1 card choice | 1 reroll per run | Rare cards in pool | Double pick, wave 5 |
| Fortify | Core HP +20% | Wrecks rebuild free | Auto-repair links | Second chance |

Scrap cost rises down each branch; a capstone costs about as much as the rest of its branch. Full tree ≈ 40–50 runs. Free respec.

### 7.4 Blueprints and mastery (permanent)

- **Blueprints:** first kill of a boss drops a blueprint adding a building, tower or recipe to future runs' research trees (e.g. Recycler, Railgun, Overcharged shells). 3–4 per biome.
- **Tower mastery:** XP from damage across all runs, levels 1–10. Levels 2/5/8 cosmetics; 3/7 small perks (+5% range, +2 magazine); level 10 a third specialisation. Perks total ~+10% per tower; challenge modes can disable them.
- **Cards** remain the per-wave pick, leaning towards twists ("Shells also slow", "Labs work 2× during waves").

### 7.5 Campaign and modes

Campaign: 5 biomes × 8 maps, each adding one resource and one enemy:

1. Scrapyard: iron, coal, walkers, swarmers
2. Copper canyon: copper, wire, flyers
3. Crystal caves: crystal, power, armoured
4. Refinery wastes: oil, fuel, saboteurs
5. The Core: everything, plus multi-path maps

Modes: **Endless** (weekly leaderboard), **Daily challenge** (fixed seed and cards, global leaderboard), **Ratio puzzles** (fixed buildings, hit an exact throughput).

## 8. UX, screens and feedback

| Screen / layer | Contents |
| --- | --- |
| Map (main) | Grid, path, buildings, flowing dots; top: wave preview + core HP; bottom: build, speed, pause, overlay toggle |
| Radial build menu | Valid buildings for the tapped tile, with cost; locked items greyed |
| Inspect sheet | Rates in/out, buffer, utilisation %, upstream bottleneck named |
| Flow overlay | Green flowing, amber backlogged, red starved |
| Card pick | 3 cards full-screen between waves |
| Run results | Stars, Scrap, the bottleneck that cost the most damage |
| Meta hub | Tech tree, biome map, modes |

Buildings show utilisation as a small bar; the inspect sheet gives plain fixes ("Needs 1 more smelter"). Onboarding: maps 1–3 teach feed a tower → chain ore→ingot→ammo → split one supply across two towers.

## 9. Monetisation and retention

Proposed: free with biome 1 + daily challenge, one purchase unlocks everything. Optional rewarded ad for one card reroll per run. Cosmetics later. No energy systems, no paid boosts affecting leaderboards. Retention via daily challenge, weekly Endless leaderboard, campaign stars.

## 10. Tech approach and phases

See `docs/build-plan.md` for milestones. Summary: pure deterministic TypeScript sim (10 Hz, seeded RNG) → web harness on GitHub Pages → Godot 4 vertical slice → content + meta → soft launch.

## 11. Open questions

- Auto-routed L-links vs player-drawn routes?
- Build during waves, or only between?
- Roguelite cards + meta tree vs pure handcrafted campaign?
- Share sim core with Factory Front, or fork?
- Is 9 tiles wide enough?
- Free + unlock vs premium?
- Working title: Supply Line / Ammo Line / Feed the Guns?

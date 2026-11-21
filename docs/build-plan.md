# Build Plan — Supply Line

Milestones sized for one Claude Code session each. Work top to bottom; don't start a phase until the
previous one's gate is met. Spec references are to `docs/game-spec.md` sections.

> Golden rule: prove the fun before building the game.

---

## Phase 0 — Headless sim (TypeScript, no rendering)

### M0.1 — Scaffold ✅ (done by the kit)
Repo, strict TS, Vitest, Zod content schema, biome 1 sample content, content validation test, CI.

### M0.2 — Grid and path ✅
- `Grid` from a map definition (9 × H tiles: path, ground, ore, rock, bridge).
- Path as an ordered list of tile centres; enemy position = distance along path.
- Placement validation: what can go on which tile; links can't cross path except at bridges.
- Tests: valid/invalid placements; path length; link crossing rules.

### M0.3 — Factory graph ✅
- Buildings (nodes) with input/output buffers; links (edges) with tier throughput caps.
- `stepFactory(state, dt)`: extract → process recipes → move items along links, respecting caps,
  buffers and power radius (unpowered = 0%).
- Per-building utilisation % and starved/backlogged status.
- Tests: balanced chain hits expected rates (extractor 1/s → smelter 0.5 ingot/s → 2 bullets/s);
  a bottleneck starves downstream; unpowered smelter produces nothing.

### M0.4 — Towers and ammo ✅
- Towers with magazine (20), stated fire rate, range, damage, ammo type; refill from input link.
- Effective fire rate = min(stated, supply). Empty magazine ⇒ no shots.
- Tests: fed Gunner fires at stated rate; underfed Gunner fires at supply rate; empty = 0 shots.

### M0.5 — Enemies and waves ✅
- Enemy types from content (walker, swarmer first). Movement along path, HP, reaching core deals damage.
- Wave spawner from content; targeting = first-along-path in range.
- One shared tick advances factory, towers, enemies.
- Tests: determinism (same seed + inputs twice ⇒ identical state hash).

### M0.6 — The interlock test ⭐ ✅
- Scripted scenario: map 1, fixed build, 5 waves. Run A with one extractor+smelter chain, run B with two.
- Assert run B kills measurably more / loses less core HP.
- **This test is the whole game in miniature.** Record numbers in HANDOFF.md.

### M0.7 — Build costs ✅ (added after M0.6, James approved)
- Stockpile from the map's `startingStock`; placing pays content `buildCost`, from stock first, then hubs.
- Unaffordable builds are rejected. Removing refunds nothing (wrecks at half cost come later).
- Interlock run B must earn its second chain by banking ingots in a hub.
- Why: M0.6 showed free towers beat factory; towers must compete with ammo for ingots.

**Phase 0 gate:** M0.6 passes and the numbers feel sane. ✅ Passed (James, after M0.7).

---

## Phase 1 — Web harness on GitHub Pages (throwaway, playable on a phone)

### M1.1 — Render
- Vite + Canvas 2D, portrait, scales to phone width. Draw grid, path, buildings, enemies, dots on links.
- Renderer reads sim state only. Fixed 10 Hz sim, interpolated render.

### M1.2 — Touch input
- Tap tile → simple build menu. Drag from building → building = link (auto L-route).
- Long-press → delete. Pause, 1×/2× buttons in the bottom bar.

### M1.3 — Run loop
- Build break → wave → card pick (3 placeholder cards) → repeat to wave 15 → result screen.
- Inspect sheet with rates and utilisation; empty-tower red flash.

### M1.4 — Research (minimal)
- Lab building, red science pack recipe, 4–6 research nodes from content.

**Phase 1 gate (James playtests on his phone):** is one 15-wave map fun with no meta? If not, fix ratios,
pacing and feedback before anything else. Write the verdict in HANDOFF.md.

---

## Phase 2 — Godot 4 vertical slice (needs the PC for editor/export setup)

**Before starting Phase 2:** make the repo **private** again (Settings → General → Danger Zone →
Change visibility). The repo is public during Phases 0–1 only for free GitHub Pages play-testing.
No art, audio, signing keys or store credentials go in while it's public.

- Decide: port `/core` to GDScript/C# or run it via a JS bridge. Record the decision.
- Real touch UI (radial menu, bottom sheet, flow overlay), biome 1 (8 maps), 3 towers, cards, tower upgrades.
- GitHub Actions builds an Android APK artifact on every push to `main`.

**Gate:** biome 1 playable start-to-finish on device.

## Phase 3 — Depth

Biomes 2–3, full research tree, tower specialisations, meta tech tree + Scrap, blueprints, Endless + Daily.
iOS build.

## Phase 4 — Soft launch

Unlock purchase, analytics on where runs fail, mastery, biomes 4–5.

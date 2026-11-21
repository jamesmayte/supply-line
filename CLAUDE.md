# CLAUDE.md — Supply Line

Portrait mobile tower defence × factory automation. Towers only fire if the factory feeds them ammo.
Full design: `docs/game-spec.md`. Milestones: `docs/build-plan.md`. Current state: `HANDOFF.md`.

## Golden rule

**Prove the fun before building the game.** Phase 0–1 exist to answer one question as cheaply as possible:
*is "factory throughput = damage output" fun on a phone?* Do not add features to compensate for a weak core.

## Core pillar, encoded

`tower fire rate = min(stated fire rate, ammo supply rate)`. Every system must reinforce this.
If a change lets towers get stronger without the factory, flag it before implementing.

## Architecture invariants (do not break)

1. **Pure, deterministic sim core.** `/core` has no DOM, no timers, no `Math.random`, no `Date.now`.
   One entry point: `step(state, input, dt) -> state` at a fixed 10 Hz tick. Seeded RNG only.
   Same seed + same inputs ⇒ byte-identical state. There is a test for this; keep it green.
2. **Content is data.** Buildings, items, recipes, towers, enemies, waves, maps, research nodes live in
   `/content` and are validated by the Zod schemas in `content/schema.ts` at import. Balancing is a data edit,
   never a code change. No magic numbers for gameplay values in `/core`.
3. **Graph-rate factory.** Buildings are nodes, links are capped edges. Items are rates and buffers,
   not individual entities. Dots on screen are cosmetic.
4. **Engine-agnostic.** `/core` must not import from `/harness`. Rendering reads state; it never mutates it.
   Player actions enter the sim only as `input` commands (place, link, upgrade, research, pick card…).
5. **No idle/offline simulation.** The game pauses when backgrounded.

## Stack

- TypeScript (strict), Node 20+, npm
- Vitest for tests, Zod for content validation
- Vite for the Phase 1 web harness (deployed to GitHub Pages by CI)
- Engine for Phase 2: Godot 4 (decision recorded in build-plan; don't start it before Phase 1's gate passes)

## Layout

```
/core       pure sim (factory graph, combat, waves, research) — no I/O
/content    schema.ts + data files (biome1.ts …)
/harness    throwaway web prototype (Vite) — Phase 1 only
/tests      vitest suites (determinism, interlock, content)
/docs       spec, build plan, session prompts
HANDOFF.md  where we are, what's next — update at the end of EVERY session
```

## Commands

```
npm install
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run dev         # harness dev server (Phase 1+)
npm run build       # harness production build
```

## How to work (James mostly drives sessions from his phone)

- Start every session by reading `HANDOFF.md`, then state the milestone you'll do and a short plan.
  Wait for a go-ahead before large changes.
- Keep replies short and skimmable; James is reading on a phone. Lead with what changed and what to test.
- One milestone per session. Commit in small, named steps. Keep `npm test` and `npm run typecheck` green
  before every push; CI runs both.
- If something isn't in `docs/build-plan.md`, add it to the plan as a proposal and ask before doing it.
- End every session by updating `HANDOFF.md`: done, decisions made, next milestone, open questions.
- When there's something to try on a phone, say the Pages URL and exactly what to tap.

## Definition of done for Phase 0

The interlock test passes: doubling bullet throughput measurably increases kills per wave on the same seed,
and the determinism test passes.

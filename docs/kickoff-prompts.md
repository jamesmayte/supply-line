# Session prompts — Supply Line

Copy one prompt into a new Claude Code session on the `supply-line` repo. One milestone per session.
Each prompt is short enough to paste from a phone.

## Every session starts with

```
Read CLAUDE.md and HANDOFF.md. Tell me where we are and your plan for the next milestone in 5 bullets max. Wait for my go.
```

## Session 1 — M0.2 Grid and path

```
Do milestone M0.2 from docs/build-plan.md: grid + path + placement rules, pure /core, tests included. Keep CI green. Update HANDOFF.md.
```

## Session 2 — M0.3 Factory graph

```
Do M0.3: the factory graph with link throughput caps, buffers, power radius and utilisation %. Use the rates in content/biome1.ts, no hard-coded numbers. Tests for the balanced chain, a bottleneck and an unpowered smelter. Update HANDOFF.md.
```

## Session 3 — M0.4 Towers and ammo

```
Do M0.4: towers with magazines; effective fire rate = min(stated, ammo supply). Tests for fed, underfed and empty Gunners. Update HANDOFF.md.
```

## Session 4 — M0.5 Enemies and waves

```
Do M0.5: enemies moving along the path, waves from content, shared tick, seeded RNG. Add the determinism test (same seed + inputs ⇒ identical state hash). Update HANDOFF.md.
```

## Session 5 — M0.6 The interlock test

```
Do M0.6: the scripted interlock scenario (one chain vs two chains, same seed, 5 waves). Assert the two-chain run does measurably better and put the numbers in HANDOFF.md. If it doesn't, tell me why before changing anything.
```

## Session 6 — M1.1 + M1.2 Harness

```
Start Phase 1: M1.1 and M1.2. Vite + Canvas portrait harness in /harness that renders sim state and takes touch input (tap to build, drag to link, long-press delete, pause/speed). Make sure the GitHub Pages workflow deploys it, then give me the URL and what to tap.
```

## Session 7 — M1.3 Run loop

```
Do M1.3: full 15-wave run loop with build breaks, placeholder cards, inspect sheet and empty-tower flash. Deploy and tell me what to test on my phone.
```

## Session 8 — M1.4 Research

```
Do M1.4: Lab, red science packs and 4–6 research nodes from content. Deploy, then hand back for my Phase 1 playtest.
```

## New session (use this to continue from any point)

```
You're continuing Supply Line in jamesmayte/supply-line. GitHub main is the source of truth; there's no chat
history. Read CLAUDE.md, HANDOFF.md (especially the latest playtest notes, "Decisions in M1.x" and "Next"),
and docs/build-plan.md. Then tell me in 5 bullets max: where we are, what you'd do next and why, and anything
in HANDOFF that looks stale. Wait for my go before changing code. Work on a fresh branch from main, keep
npm test / npm run typecheck green, check UI changes on an emulated phone and send screenshots, update
HANDOFF.md at the end, and open a PR when I ask.

New feedback since the last session: <paste playtest notes / screenshots here, or "none">
```

## Handy one-liners

- Review: `Review /core against the invariants in CLAUDE.md and list anything that breaks them.`
- Balance: `Change balance only in /content. Show me a before/after of the interlock numbers.`
- Scope guard: `That isn't in the build plan. Add it as a proposal and wait for my OK.`

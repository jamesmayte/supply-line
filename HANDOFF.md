# HANDOFF — Supply Line

_Update at the end of every session._

## Status

- Phase 0, **M0.1 done** (project kit): strict TS, Vitest, Zod content schema, biome 1 sample content,
  content validation tests, CI (tests + typecheck) and a GitHub Pages workflow for the harness.
- `/core` is empty apart from a seeded RNG helper and its test.

## Next

**M0.2 — Grid and path** (see `docs/build-plan.md`). Prompt in `docs/kickoff-prompts.md`, Session 1.

## Decisions so far

- Portrait, 9-tile-wide grid, fixed enemy path, graph-rate factory (no item entities).
- Sim at 10 Hz fixed tick, seeded RNG, pure `/core`.
- Harness = Vite + Canvas on GitHub Pages so playtests happen on a phone.
- Engine for Phase 2: Godot 4 (not started until Phase 1 gate passes).

## Open questions (from spec §11)

- Auto-routed vs player-drawn links · build during waves? · cards + meta vs handcrafted ·
  share core with Factory Front? · 9 tiles wide enough? · free+unlock vs premium · final name.

- Repo is **public during Phases 0–1** for free GitHub Pages; switch back to **private before Phase 2**
  (see build-plan). Keep secrets, paid assets and signing keys out while public.

## One-time setup (James)

- Repo Settings → General → Danger Zone → Change visibility → Public.
- Repo Settings → Pages → Source: **GitHub Actions**.
- Harness URL once deployed: https://jamesmayte.github.io/supply-line/

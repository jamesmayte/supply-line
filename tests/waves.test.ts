/**
 * M1.3 wave curve for scrapyard_1 (James: easy early, hard late, like classic wave TD).
 * "Easy" target = the natural 20-ingot opening build (content/scenarios RUN_A: 1 chain → hub → 3 Gunners),
 * which a new player can afford on wave 1. Balance beyond this is tuned by playtest, not asserted here.
 */
import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { RUN_A } from "../content/scenarios";
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";

const ctx = makeGameCtx(biome1, "scrapyard_1");
const map = biome1.maps.find((m) => m.id === "scrapyard_1")!;
const enemyIds = (w: (typeof map.waves)[number]) => w.groups.map((g) => g.enemyId);

describe("scrapyard_1 wave curve", () => {
  it("has 15 waves, mini-bosses on 5 and 10, the boss on 15", () => {
    expect(map.waves.map((w) => w.number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(enemyIds(map.waves[4]!)).toContain("brute");
    expect(enemyIds(map.waves[9]!)).toContain("brute");
    expect(enemyIds(map.waves[14]!)).toContain("boss");
    for (const i of [0, 1, 2, 3]) expect(enemyIds(map.waves[i]!)).not.toContain("brute");
  });

  it("the 20-ingot opening build clears waves 1–4 (at most one leak)", () => {
    let s: GameState = newGame(biome1, "scrapyard_1", 1);
    for (let i = 0; i < 300; i++) s = step(s, RUN_A[i] ?? [], 0.1, ctx);
    const leaks: number[] = [];
    for (let w = 0; w < 4; w++) {
      const before = s.leaked;
      const pick: GameInput[] = s.cardOffer ? [{ type: "pickCard", cardId: s.cardOffer[0]! }] : [];
      s = step(s, [...pick, { type: "startWave" }], 0.1, ctx);
      while (s.phase === "wave") s = step(s, [], 0.1, ctx);
      leaks.push(s.leaked - before);
    }
    expect(leaks.slice(0, 3)).toEqual([0, 0, 0]);
    expect(leaks[3]).toBeLessThanOrEqual(1);
    expect(s.phase).toBe("build");
  });
});

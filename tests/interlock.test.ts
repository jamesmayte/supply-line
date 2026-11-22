/**
 * M0.6 — the interlock test: the whole game in miniature.
 * Same map, same seed, same Gunners on the same tiles; the only difference is factory throughput.
 *   Run A: one extractor → smelter → assembler chain (2 bullets/s) → hub → 3 Gunners.
 *   Run B: two chains (4 bullets/s) → the same hub → the same 3 Gunners.
 * Doubling bullet supply must measurably increase kills and reduce core damage.
 *
 * Build costs are paid (M0.7). The shared build costs exactly the map's 20 starting ingots, so run B
 * earns its second chain: it first sends chain A's ingots into the hub, then spends them on chain B.
 * Both runs get the same build break.
 */
import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { GUNS, RUN_A, RUN_B, type Script } from "../content/scenarios";
import { makeGameCtx, newGame, step, type GameState } from "../core/game";
import { hashState } from "../core/hash";

const DT = 0.1;
const MAP = "scrapyard_1";
const SEED = 1;
const WARMUP_S = 30; // build break before wave 1: the factory fills the magazine
const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;

interface WaveResult { wave: number; kills: number; leaked: number; coreHp: number }

function play(script: Script) {
  let s: GameState = newGame(biome1, MAP, SEED);
  for (let i = 0; i < WARMUP_S / DT; i++) {
    s = step(s, script[i] ?? [], DT, ctx);
    if (s.errors.length) throw new Error(`tick ${i}: ${s.errors.join("; ")}`);
  }
  const waves: WaveResult[] = [];
  while (s.phase === "build") {
    const before = s;
    s = step(s, [{ type: "startWave" }], DT, ctx);
    while (s.phase === "wave") s = step(s, [], DT, ctx);
    waves.push({ wave: before.waveIndex + 1, kills: s.kills - before.kills, leaked: s.leaked - before.leaked, coreHp: s.coreHp });
  }
  return { final: s, waves };
}

describe("the interlock: factory throughput = damage output", () => {
  const A = play(RUN_A);
  const B = play(RUN_B);
  const table = (r: ReturnType<typeof play>) => r.waves.map((w) => `w${w.wave} ${w.kills}k/${w.leaked}l/${w.coreHp}hp`).join("  ");
  console.log(`interlock A: ${table(A)}  → ${A.final.phase}\ninterlock B: ${table(B)}  → ${B.final.phase}`);

  const towers = (s: GameState) => s.factory.nodes.filter((n) => n.towerId);
  const shots = (s: GameState) => towers(s).reduce((a, n) => a + n.shots!, 0);

  it("the only difference is the factory: same Gunners, same tiles", () => {
    const where = (s: GameState) => towers(s).map(({ id, towerId, x, y }) => ({ id, towerId, x, y }));
    expect(where(A.final)).toEqual(where(B.final));
    expect(where(A.final).map((t) => t.id)).toEqual(GUNS);
  });

  it("both runs pay for everything from the same 20 starting ingots", () => {
    const start = map.startingStock.find((x) => x.itemId === "iron_ingot")!.qty;
    expect(start).toBe(20);
    expect(A.final.stock.iron_ingot).toBeCloseTo(0, 9);
    expect(B.final.stock.iron_ingot).toBeCloseTo(0, 9);
  });

  it("run A is ammo-limited: three Gunners want more than one chain makes", () => {
    const gunner = biome1.towers.find((t) => t.id === "gunner")!;
    expect(GUNS.length * gunner.fireRate).toBeGreaterThan(4);
  });

  it("run B fires more", () => {
    expect(shots(B.final)).toBeGreaterThan(shots(A.final));
  });

  it("run B kills measurably more and leaks less", () => {
    expect(B.final.kills).toBeGreaterThan(A.final.kills * 1.2);
    expect(B.final.leaked).toBeLessThan(A.final.leaked);
  });

  it("run B loses less core HP and gets further", () => {
    expect(map.coreHp - B.final.coreHp).toBeLessThan(map.coreHp - A.final.coreHp);
    expect(B.final.waveIndex).toBeGreaterThanOrEqual(A.final.waveIndex);
  });

  it("both runs are deterministic", () => {
    expect(hashState(play(RUN_A).final)).toBe(hashState(A.final));
    expect(hashState(play(RUN_B).final)).toBe(hashState(B.final));
  });
});

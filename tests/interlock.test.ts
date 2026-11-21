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
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";
import { hashState } from "../core/hash";

const DT = 0.1;
const MAP = "scrapyard_1";
const SEED = 1;
const WARMUP_S = 30; // build break before wave 1: the factory fills the magazine
const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;

/*
 * Shared build (ids from 1, in order): power, chain A, a hub, and three Gunners covering the path,
 * each fed from the hub by a tier-2 link. Three Gunners can fire 9/s, more than either factory makes,
 * so ammo, not tower count, is the limit.
 */
const GUNS = [7, 8, 9];
const COMMON: GameInput[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 1 coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // 2 powers y 1..7
  { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 3 iron
  { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 4
  { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" }, // 5
  { type: "place", buildingId: "hub", x: 7, y: 5 }, // 6
  { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 7
  { type: "placeTower", towerId: "gunner", x: 4, y: 8 }, // 8
  { type: "placeTower", towerId: "gunner", x: 2, y: 7 }, // 9
  { type: "link", from: 1, to: 2 }, // 10
  { type: "link", from: 3, to: 4 }, // 11
  { type: "link", from: 4, to: 5 }, // 12
  { type: "link", from: 5, to: 6 }, // 13
  ...GUNS.map((g): GameInput => ({ type: "link", from: 6, to: g, itemId: "bullets", tier: 2 })), // 14..16
];

/** A script: commands to apply on a given tick of the build break. */
type Script = Record<number, GameInput[]>;

/** Run A: one chain, 2 bullets/s. */
const RUN_A: Script = { 0: COMMON };

/** Run B: bank ingots in the hub, then buy a second chain into the same hub (4 bullets/s). */
const BANK = COMMON.map((c): GameInput => (c.type === "link" && c.from === 4 && c.to === 5 ? { type: "link", from: 4, to: 6 } : c)); // link 12: smelter → hub
const EXPAND_TICK = 210; // ~9 ingots banked by 21 s
const RUN_B: Script = {
  0: BANK,
  [EXPAND_TICK]: [
    { type: "unlink", linkId: 12 },
    { type: "link", from: 4, to: 5 }, // 17: smelter → assembler, as in run A
    { type: "place", buildingId: "extractor", x: 8, y: 3 }, // 18 coal
    { type: "place", buildingId: "generator", x: 8, y: 5 }, // 19 powers y 2..8 (3 ingots)
    { type: "place", buildingId: "extractor", x: 8, y: 8 }, // 20 iron
    { type: "place", buildingId: "smelter", x: 5, y: 8 }, // 21 (2 ingots)
    { type: "place", buildingId: "assembler", x: 7, y: 6, recipeId: "make_bullets" }, // 22 (4 ingots)
    { type: "link", from: 18, to: 19 },
    { type: "link", from: 20, to: 21 },
    { type: "link", from: 21, to: 22 },
    { type: "link", from: 22, to: 6 },
  ],
};

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

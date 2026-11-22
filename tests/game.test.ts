import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { applyCommands, makeGameCtx, newGame, pickTarget, shotDamage, spendable, step, type GameInput, type GameState } from "../core/game";
import { hashState } from "../core/hash";
import { positionAt } from "../core/path";

const DT = 0.1; // 10 Hz
const MAP = "scrapyard_1";
const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;
const enemy = (id: string) => biome1.enemies.find((e) => e.id === id)!;
const tower = (id: string) => biome1.towers.find((t) => t.id === id)!;
const ammo = (id: string) => biome1.ammo.find((a) => a.itemId === id)!;

/** Run for `seconds`; inputs[tick] are applied on that tick (relative to the start of this call). */
function run(state: GameState, seconds: number, inputs: Record<number, GameInput[]> = {}): GameState {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = step(state, inputs[i] ?? [], DT, ctx);
    if (state.errors.length) throw new Error(state.errors.join("; "));
  }
  return state;
}
const untilBuild = (s: GameState, max = 300) => {
  for (let i = 0; i < max / DT && s.phase === "wave"; i++) s = step(s, [], DT, ctx);
  return s;
};

/* Gunner at (6,8) beside the bottom-right of the path, fed by one 2 bullets/s chain (ids 1..6, gunner = 6). */
const BUILD: GameInput[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 1 coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // 2
  { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 3 iron
  { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 4
  { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" }, // 5
  { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 6
  { type: "link", from: 1, to: 2 },
  { type: "link", from: 3, to: 4 },
  { type: "link", from: 4, to: 5 },
];
const FEED: GameInput = { type: "link", from: 5, to: 6 };
const GUN = 6;

describe("enemies and waves", () => {
  it("a wave spawns its groups on the content schedule", () => {
    const wave = map.waves[0]!.groups[0]!;
    const s = run(newGame(biome1, MAP, 1), wave.spacing * 2 + DT, { 0: [{ type: "startWave" }] });
    expect(s.wave!.spawned[0]).toBe(3); // t = 0, spacing, 2·spacing
  });

  it("enemies move at their content speed", () => {
    const s = run(newGame(biome1, MAP, 1), 1, { 0: [{ type: "startWave" }] });
    const first = s.enemies.find((e) => e.id === 1)!;
    expect(first.d).toBeCloseTo(enemy("walker").speed * 1, 6);
  });

  it("unopposed enemies reach the core and deal their coreDamage", () => {
    const s = untilBuild(run(newGame(biome1, MAP, 1), DT, { 0: [{ type: "startWave" }] }));
    const w = map.waves[0]!.groups[0]!;
    expect(s.phase).toBe("build");
    expect(s.waveIndex).toBe(1);
    expect(s.leaked).toBe(w.count);
    expect(s.coreHp).toBe(map.coreHp - w.count * enemy(w.enemyId).coreDamage);
  });

  it("the run is lost when core HP hits 0", () => {
    let s = newGame(biome1, MAP, 1);
    for (let w = 0; w < map.waves.length && s.phase === "build"; w++) s = untilBuild(step(s, [{ type: "startWave" }], DT, ctx));
    expect(s.phase).toBe("lost");
    expect(s.coreHp).toBe(0);
    expect(step(s, [], DT, ctx)).toEqual({ ...s, errors: [] }); // frozen once over
  });

  it("startWave is rejected mid-wave", () => {
    const s = run(newGame(biome1, MAP, 1), DT, { 0: [{ type: "startWave" }] });
    expect(step(s, [{ type: "startWave" }], DT, ctx).errors[0]).toMatch(/during 'wave'/);
  });
});

describe("targeting and damage", () => {
  const built = run(newGame(biome1, MAP, 1), DT, { 0: BUILD });
  const gun = built.factory.nodes.find((n) => n.id === GUN)!;

  it("picks the in-range enemy furthest along the path", () => {
    const enemies = [5, 15, 16, 22].map((d, i) => ({ id: i + 1, enemyId: "walker", hp: 40, d }));
    // the gunner covers the path around (4..7, 9.5); d = 15, 16 are there, 22 is far down the right side
    expect(pickTarget(ctx, enemies, gun, tower("gunner"))?.d).toBe(16);
    expect(pickTarget(ctx, enemies.filter((e) => e.d !== 15 && e.d !== 16), gun, tower("gunner"))).toBeUndefined();
    const pos = positionAt(ctx.path, 16);
    expect(Math.hypot(pos.x - 6.5, pos.y - 8.5)).toBeLessThanOrEqual(tower("gunner").range);
  });

  it("ignores dead enemies", () => {
    const enemies = [{ id: 1, enemyId: "walker", hp: 0, d: 16 }, { id: 2, enemyId: "walker", hp: 40, d: 15 }];
    expect(pickTarget(ctx, enemies, gun, tower("gunner"))?.id).toBe(2);
  });

  it("armour blocks bullets; armour-piercing shells ignore it", () => {
    expect(shotDamage(tower("gunner"), ammo("bullets"), enemy("walker"))).toBe(6);
    expect(shotDamage(tower("gunner"), ammo("bullets"), enemy("armoured"))).toBeCloseTo(6 * (1 - 0.6), 9);
    expect(shotDamage(tower("cannon"), ammo("shells"), enemy("armoured"))).toBe(30);
  });
});

describe("factory feeds the fight", () => {
  const wave1 = (feed: boolean) => {
    const built = run(newGame(biome1, MAP, 1), 30, { 0: feed ? [...BUILD, FEED] : BUILD }); // build break: factory warms up
    return untilBuild(step(built, [{ type: "startWave" }], DT, ctx));
  };

  it("an unfed Gunner fires nothing and every walker leaks", () => {
    const s = wave1(false);
    expect(s.factory.nodes.find((n) => n.id === GUN)!.shots).toBe(0);
    expect(s.kills).toBe(0);
    expect(s.leaked).toBe(map.waves[0]!.groups[0]!.count);
  });

  it("a fed Gunner kills walkers and spends its ammo doing it", () => {
    const s = wave1(true);
    const gun = s.factory.nodes.find((n) => n.id === GUN)!;
    expect(s.kills).toBeGreaterThan(0);
    expect(s.kills + s.leaked).toBe(map.waves[0]!.groups[0]!.count);
    // every shot hit; damage counts only HP removed, so overkill on the last shot of each kill is lost
    expect(gun.shots).toBeGreaterThan(0);
    expect(s.damageDealt).toBeLessThanOrEqual(gun.shots! * tower("gunner").damage);
    expect(s.damageDealt).toBeGreaterThanOrEqual(s.kills * enemy("walker").hp - 1e-9);
  });

  it("with no enemies in range a loaded Gunner holds its fire", () => {
    const s = run(newGame(biome1, MAP, 1), 30, { 0: [...BUILD, FEED] });
    const gun = s.factory.nodes.find((n) => n.id === GUN)!;
    expect(gun.shots).toBe(0);
    expect(gun.status).toBe("idle");
  });
});

describe("determinism", () => {
  const script = (seed: number) => {
    let s = run(newGame(biome1, MAP, seed), 30, { 0: [...BUILD, FEED] });
    for (let w = 0; w < 3 && s.phase === "build"; w++) s = untilBuild(step(s, [{ type: "startWave" }], DT, ctx));
    return s;
  };

  it("same seed + same inputs ⇒ identical state hash", () => {
    const a = script(42);
    const b = script(42);
    expect(a.tick).toBeGreaterThan(300);
    expect(hashState(a)).toBe(hashState(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different inputs ⇒ different hash", () => {
    const a = run(newGame(biome1, MAP, 42), 5, { 0: BUILD });
    const b = run(newGame(biome1, MAP, 42), 5, { 0: [...BUILD, FEED] });
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("step never mutates its input", () => {
    const s = run(newGame(biome1, MAP, 7), 30, { 0: [...BUILD, FEED] });
    const before = JSON.stringify(s);
    step(s, [{ type: "startWave" }], DT, ctx);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("build costs (M0.7)", () => {
  const cost = (id: string) => (biome1.buildings.find((b) => b.id === id) ?? biome1.towers.find((t) => t.id === id))!.buildCost;
  const ingots = (id: string) => cost(id).find((c) => c.itemId === "iron_ingot")?.qty ?? 0;
  const start = map.startingStock.find((x) => x.itemId === "iron_ingot")!.qty;

  it("the run starts with the map's starting stock", () => {
    expect(newGame(biome1, MAP, 1).stock).toEqual({ iron_ingot: start });
  });

  it("placing pays the content build cost; extractors are free", () => {
    const s = step(newGame(biome1, MAP, 1), [
      { type: "place", buildingId: "smelter", x: 6, y: 7 },
      { type: "place", buildingId: "extractor", x: 7, y: 7 },
      { type: "placeTower", towerId: "gunner", x: 6, y: 8 },
    ], DT, ctx);
    expect(s.errors).toEqual([]);
    expect(s.stock.iron_ingot).toBe(start - ingots("smelter") - ingots("gunner"));
    expect(ingots("extractor")).toBe(0);
  });

  it("a build you can't afford is rejected and changes nothing", () => {
    const broke = { ...newGame(biome1, MAP, 1), stock: { iron_ingot: ingots("gunner") - 1 } };
    const s = step(broke, [{ type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(s.errors[0]).toMatch(/can't afford: needs 3 iron_ingot, have 2/);
    expect(s.factory.nodes).toEqual([]);
    expect(s.stock).toEqual(broke.stock);
  });

  it("a bad placement is rejected without charging", () => {
    const s = step(newGame(biome1, MAP, 1), [{ type: "placeTower", towerId: "gunner", x: 4, y: 2 }], DT, ctx);
    expect(s.errors[0]).toMatch(/path/);
    expect(s.stock.iron_ingot).toBe(start);
  });

  it("when the stockpile runs short, the rest comes from hubs", () => {
    let s = step(newGame(biome1, MAP, 1), [{ type: "place", buildingId: "hub", x: 7, y: 5 }], DT, ctx);
    const hub = s.factory.nodes[0]!;
    s = structuredClone(s);
    s.stock.iron_ingot = 1;
    s.factory.nodes[0]!.inputs = { iron_ingot: 5, bullets: 7 };
    expect(spendable(s, ctx, "iron_ingot")).toBe(6);
    const after = step(s, [{ type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(after.errors).toEqual([]);
    expect(after.stock.iron_ingot).toBe(0);
    const h = after.factory.nodes.find((n) => n.id === hub.id)!;
    expect(h.inputs.iron_ingot).toBe(5 - (ingots("gunner") - 1));
    expect(h.inputs.bullets).toBe(7); // other items untouched
  });

  it("removing a building refunds nothing (for now)", () => {
    const placed = step(newGame(biome1, MAP, 1), [{ type: "place", buildingId: "smelter", x: 6, y: 7 }], DT, ctx);
    const removed = step(placed, [{ type: "remove", nodeId: placed.factory.nodes[0]!.id }], DT, ctx);
    expect(removed.factory.nodes).toEqual([]);
    expect(removed.stock.iron_ingot).toBe(start - ingots("smelter"));
  });
});

describe("applyCommands (build while paused)", () => {
  it("applies commands without advancing time", () => {
    const s = run(newGame(biome1, MAP, 1), 1, { 0: [{ type: "startWave" }] });
    const after = applyCommands(s, [{ type: "place", buildingId: "hub", x: 7, y: 5 }], ctx);
    expect(after.tick).toBe(s.tick);
    expect(after.enemies).toEqual(s.enemies);
    expect(after.factory.nodes).toHaveLength(1);
    expect(after.errors).toEqual([]);
    expect(applyCommands(s, [{ type: "startWave" }], ctx).errors[0]).toMatch(/during 'wave'/);
  });

  it("then stepping with no input equals stepping with the input", () => {
    const s = run(newGame(biome1, MAP, 1), 2);
    const cmd: GameInput[] = [{ type: "place", buildingId: "hub", x: 7, y: 5 }];
    expect(hashState(step(applyCommands(s, cmd, ctx), [], DT, ctx))).toBe(hashState(step(s, cmd, DT, ctx)));
  });
});

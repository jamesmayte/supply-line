import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { emptyFactory, makeFactoryCtx, stepFactory, type FactoryState } from "../core/factory";
import { applyFactoryCommand, type FactoryCommand } from "../core/factoryBuild";
import { buildGrid } from "../core/grid";
import { magazineCount, stepTowers, type FireFn } from "../core/towers";

const DT = 0.1; // 10 Hz sim tick
const ctx = makeFactoryCtx(biome1, buildGrid(biome1.maps[0]!));
const gunner = biome1.towers.find((t) => t.id === "gunner")!;
const tier = (n: number) => biome1.linkTiers.find((t) => t.tier === n)!;

function build(cmds: FactoryCommand[], state: FactoryState = emptyFactory()) {
  const ids: number[] = [];
  for (const cmd of cmds) {
    const r = applyFactoryCommand(state, ctx, cmd);
    if (r.error) throw new Error(`${JSON.stringify(cmd)}: ${r.error}`);
    state = r.state;
    if (r.id !== undefined) ids.push(r.id);
  }
  return { state, ids };
}

/** One shared tick: factory (refills magazines), then towers fire. */
function run(state: FactoryState, seconds: number, fire?: FireFn): FactoryState {
  for (let i = 0; i < Math.round(seconds / DT); i++) state = stepTowers(stepFactory(state, ctx, DT), ctx, DT, fire);
  return state;
}

const node = (s: FactoryState, id: number) => s.nodes.find((n) => n.id === id)!;
const shotsPerSecond = (from: FactoryState, to: FactoryState, id: number, seconds: number) =>
  ((node(to, id).shots ?? 0) - (node(from, id).shots ?? 0)) / seconds;

/* scrapyard_1, right side. Coal (7..8, 2..3), iron (7..8, 7..8). Generators at (7,4) and (8,5) cover y 1..8. */
const LAYOUT: FactoryCommand[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 0 coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // 1
  { type: "place", buildingId: "extractor", x: 8, y: 3 }, // 2 coal
  { type: "place", buildingId: "generator", x: 8, y: 5 }, // 3
  { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 4 chain A: 2 bullets/s
  { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 5
  { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" }, // 6
  { type: "place", buildingId: "extractor", x: 8, y: 8 }, // 7 chain B: 2 bullets/s
  { type: "place", buildingId: "smelter", x: 6, y: 8 }, // 8
  { type: "place", buildingId: "assembler", x: 7, y: 6, recipeId: "make_bullets" }, // 9
  { type: "place", buildingId: "hub", x: 7, y: 5 }, // 10
  { type: "placeTower", towerId: "gunner", x: 6, y: 5 }, // 11
];
const base = build(LAYOUT);
const [coalA, genA, coalB, genB, extA, smA, asmA, extB, smB, asmB, hub, gun] = base.ids as number[] as [
  number, number, number, number, number, number, number, number, number, number, number, number,
];
const POWER: FactoryCommand[] = [
  { type: "link", from: coalA, to: genA },
  { type: "link", from: coalB, to: genB },
];
const CHAIN_A: FactoryCommand[] = [
  { type: "link", from: extA, to: smA },
  { type: "link", from: smA, to: asmA },
];
const CHAIN_B: FactoryCommand[] = [
  { type: "link", from: extB, to: smB },
  { type: "link", from: smB, to: asmB },
];

describe("fed Gunner: 4 bullets/s supply ≥ 3 shots/s stated", () => {
  const linked = build(
    [
      ...POWER,
      ...CHAIN_A,
      ...CHAIN_B,
      { type: "link", from: asmA, to: hub },
      { type: "link", from: asmB, to: hub },
      { type: "link", from: hub, to: gun, itemId: "bullets", tier: 2 },
    ],
    base.state,
  ).state;
  const warm = run(linked, 30);
  const end = run(warm, 30);

  it("fires at its stated rate, from content", () => {
    expect(tier(2).itemsPerSecond).toBeGreaterThan(gunner.fireRate);
    expect(shotsPerSecond(warm, end, gun, 30)).toBeCloseTo(gunner.fireRate, 1);
    expect(node(end, gun).status).toBe("working");
  });

  it("surplus ammo keeps the magazine topped up and backs up the factory", () => {
    expect(magazineCount(node(end, gun))).toBeGreaterThan(gunner.magazine - 2);
    expect(magazineCount(node(end, gun))).toBeLessThanOrEqual(gunner.magazine + 1e-9);
  });
});

describe("underfed Gunner: one chain = 2 bullets/s < 3 shots/s stated", () => {
  const linked = build([...POWER, ...CHAIN_A, { type: "link", from: asmA, to: gun }], base.state).state;
  const warm = run(linked, 30);
  const end = run(warm, 30);

  it("fires at the supply rate, not the stated rate", () => {
    const supply = Math.min(2, tier(1).itemsPerSecond);
    expect(supply).toBeLessThan(gunner.fireRate);
    expect(shotsPerSecond(warm, end, gun, 30)).toBeCloseTo(supply, 1);
  });

  it("effective rate = min(stated, supply)", () => {
    const supply = end.links.find((l) => l.to === gun)!.flow;
    expect(shotsPerSecond(warm, end, gun, 30)).toBeCloseTo(Math.min(gunner.fireRate, supply), 1);
  });

  it("its magazine never builds up", () => {
    expect(magazineCount(node(end, gun))).toBeLessThan(2);
  });
});

describe("empty Gunner", () => {
  it("with no ammo link fires 0 shots and reports starved", () => {
    const s = run(base.state, 30);
    expect(node(s, gun).shots).toBe(0);
    expect(node(s, gun).status).toBe("starved");
  });

  it("a full magazine fires exactly its size, then stops", () => {
    const fed = build([...POWER, ...CHAIN_A, { type: "link", from: asmA, to: gun }], base.state).state;
    const loaded = run(fed, 30, () => false); // no target: fills, doesn't fire
    expect(magazineCount(node(loaded, gun))).toBeCloseTo(gunner.magazine, 6);
    expect(node(loaded, gun).shots).toBe(0);
    expect(node(loaded, gun).status).toBe("idle");

    const cut = applyFactoryCommand(loaded, ctx, { type: "unlink", linkId: loaded.links.find((l) => l.to === gun)!.id }).state;
    const burst = run(cut, 5); // 20 rounds at 3/s ≈ 6.7 s
    expect(shotsPerSecond(cut, burst, gun, 5)).toBeCloseTo(gunner.fireRate, 0);
    const dry = run(burst, 10);
    expect(node(dry, gun).shots).toBe(gunner.magazine);
    expect(magazineCount(node(dry, gun))).toBe(0);
    expect(node(dry, gun).status).toBe("starved");
  });
});

describe("tower commands", () => {
  it("towers accept only their ammo, have one input and no output", () => {
    const tryCmd = (cmd: FactoryCommand) => applyFactoryCommand(base.state, ctx, cmd);
    expect(tryCmd({ type: "link", from: smA, to: gun }).error).toMatch(/accept/);
    expect(tryCmd({ type: "link", from: gun, to: hub }).error).toMatch(/no output/);
    const one = build([{ type: "link", from: asmA, to: gun }], base.state).state;
    expect(applyFactoryCommand(one, ctx, { type: "link", from: asmB, to: gun }).error).toMatch(/input port/);
  });

  it("towers can't go on ore, path or occupied tiles", () => {
    const tryCmd = (x: number, y: number) => applyFactoryCommand(base.state, ctx, { type: "placeTower", towerId: "gunner", x, y }).error;
    expect(tryCmd(8, 7)).toMatch(/ore/);
    expect(tryCmd(4, 2)).toMatch(/path/);
    expect(tryCmd(6, 5)).toBe("tile occupied");
    expect(applyFactoryCommand(base.state, ctx, { type: "placeTower", towerId: "nope", x: 3, y: 5 }).error).toMatch(/unknown tower/);
  });
});

it("towers + factory are deterministic", () => {
  const linked = build([...POWER, ...CHAIN_A, { type: "link", from: asmA, to: gun }], base.state).state;
  expect(JSON.stringify(run(linked, 20))).toBe(JSON.stringify(run(linked, 20)));
});

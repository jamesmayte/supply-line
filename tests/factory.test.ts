import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { recipeRate } from "../content/schema";
import { emptyFactory, makeFactoryCtx, stepFactory, type FactoryState } from "../core/factory";
import { applyFactoryCommand, type FactoryCommand } from "../core/factoryBuild";
import { buildGrid } from "../core/grid";

const DT = 0.1; // 10 Hz sim tick
const ctx = makeFactoryCtx(biome1, buildGrid(biome1.maps[0]!));
const building = (id: string) => biome1.buildings.find((b) => b.id === id)!;
const recipe = (id: string) => biome1.recipes.find((r) => r.id === id)!;

/** Apply commands in order; each must succeed. Returns state and the created ids in order. */
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

function run(state: FactoryState, seconds: number, eachTick?: (s: FactoryState) => void): FactoryState {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = stepFactory(state, ctx, DT);
    eachTick?.(state);
  }
  return state;
}

const node = (s: FactoryState, id: number) => s.nodes.find((n) => n.id === id)!;
/** Stand-in for a tower until M0.4: empties a node's output buffer every tick. */
const drain = (id: number) => (s: FactoryState) => void (node(s, id).output = 0);

/* Map layout (scrapyard_1, right side): coal ore at (7,3), iron ore at (7..8, 7..8), rock at (5,6..7). */
const POWER: FactoryCommand[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // powers x 4..10, y 1..7
];
const powerLinks = (coal: number, gen: number): FactoryCommand => ({ type: "link", from: coal, to: gen });

describe("balanced starter chain: 1 ore/s → 0.5 ingot/s → 2 bullets/s", () => {
  const { state, ids } = build([
    ...POWER,
    { type: "place", buildingId: "extractor", x: 7, y: 7 },
    { type: "place", buildingId: "smelter", x: 6, y: 7 },
    { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" },
  ]);
  const [coal, gen, ext, smelter, asm] = ids as [number, number, number, number, number];
  const linked = build(
    [powerLinks(coal, gen), { type: "link", from: ext, to: smelter }, { type: "link", from: smelter, to: asm }],
    state,
  ).state;

  const warm = run(linked, 30, drain(asm));
  const end = run(warm, 30, drain(asm));
  const rate = (id: number) => (node(end, id).produced - node(warm, id).produced) / 30;

  it("hits the content rates (no hard-coded numbers)", () => {
    const expected = {
      ore: building("extractor").extractRate!,
      ingot: recipeRate(recipe("smelt_iron"), building("smelter")),
      bullets: recipeRate(recipe("make_bullets"), building("assembler")),
    };
    expect(expected).toEqual({ ore: 1, ingot: 0.5, bullets: 2 });
    expect(rate(ext)).toBeCloseTo(expected.ore, 6);
    expect(rate(smelter)).toBeCloseTo(expected.ingot, 6);
    expect(rate(asm)).toBeCloseTo(expected.bullets, 6);
  });

  it("every building in the chain runs flat out", () => {
    for (const id of [ext, smelter, asm]) {
      expect(node(end, id).status, `node ${id}`).toBe("working");
      expect(node(end, id).utilisation).toBeCloseTo(1, 6);
    }
    expect(node(end, gen).burning).toBe(true);
  });

  it("links report their flow", () => {
    const ore = end.links.find((l) => l.from === ext)!;
    expect(ore.flow).toBeCloseTo(1, 6);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(run(linked, 20, drain(asm)))).toBe(JSON.stringify(run(linked, 20, drain(asm))));
  });

  it("without a sink the assembler backlogs and the chain backs up", () => {
    const s = run(linked, 120);
    expect(node(s, asm).status).toBe("backlogged");
    expect(node(s, asm).output).toBeCloseTo(building("assembler").bufferSize, 6);
    expect(node(s, ext).status).toBe("backlogged");
  });
});

describe("bottleneck: one smelter split across two assemblers", () => {
  const { state, ids } = build([
    ...POWER,
    { type: "place", buildingId: "extractor", x: 7, y: 7 },
    { type: "place", buildingId: "smelter", x: 6, y: 7 },
    { type: "place", buildingId: "hub", x: 6, y: 5 },
    { type: "place", buildingId: "assembler", x: 5, y: 5, recipeId: "make_bullets" },
    { type: "place", buildingId: "assembler", x: 7, y: 5, recipeId: "make_bullets" },
  ]);
  const [coal, gen, ext, smelter, hub, a1, a2] = ids as [number, number, number, number, number, number, number];
  const linked = build(
    [
      powerLinks(coal, gen),
      { type: "link", from: ext, to: smelter },
      { type: "link", from: smelter, to: hub },
      { type: "link", from: hub, to: a1, itemId: "iron_ingot" },
      { type: "link", from: hub, to: a2, itemId: "iron_ingot" },
    ],
    state,
  ).state;
  const both = (s: FactoryState) => (drain(a1)(s), drain(a2)(s));
  const warm = run(linked, 30, both);
  const end = run(warm, 30, both);

  it("downstream assemblers are starved at 50%", () => {
    for (const id of [a1, a2]) {
      expect(node(end, id).status).toBe("starved");
      expect(node(end, id).utilisation).toBeCloseTo(0.5, 6);
      expect((node(end, id).produced - node(warm, id).produced) / 30).toBeCloseTo(1, 6);
    }
  });

  it("the hub splits the ingots evenly and upstream stays at full rate", () => {
    const outs = end.links.filter((l) => l.from === hub);
    expect(outs.map((l) => l.flow)).toEqual([outs[0]!.flow, outs[0]!.flow]);
    expect(outs[0]!.flow).toBeCloseTo(0.25, 6);
    expect(node(end, smelter).status).toBe("working");
  });
});

describe("link throughput cap", () => {
  const { state, ids } = build([
    { type: "place", buildingId: "extractor", x: 7, y: 7 },
    { type: "place", buildingId: "extractor", x: 8, y: 7 },
    { type: "place", buildingId: "extractor", x: 7, y: 8 },
    { type: "place", buildingId: "hub", x: 6, y: 8 },
    { type: "place", buildingId: "hub", x: 6, y: 5 },
  ]);
  const [e1, e2, e3, h1, h2] = ids as [number, number, number, number, number];
  const tier1 = biome1.linkTiers.find((t) => t.tier === 1)!;
  const linked = build(
    [
      { type: "link", from: e1, to: h1 },
      { type: "link", from: e2, to: h1 },
      { type: "link", from: e3, to: h1 },
      { type: "link", from: h1, to: h2, itemId: "iron_ore", tier: 1 },
    ],
    state,
  ).state;

  it("3 ore/s into a tier-1 link only gets its cap through; the rest piles up", () => {
    const s = run(linked, 10);
    const capped = s.links.find((l) => l.from === h1)!;
    expect(capped.flow).toBeCloseTo(tier1.itemsPerSecond, 6);
    expect(node(s, h1).inputs.iron_ore!).toBeGreaterThan(5);
  });

  it("once the hub is full it backlogs its extractors", () => {
    const s = run(linked, 60);
    expect(node(s, h1).status).toBe("backlogged");
    expect(node(s, e1).status).toBe("backlogged");
  });
});

describe("power", () => {
  const chain = (smelterAt: { x: number; y: number }, withPower: "fed" | "no-coal" | "none") => {
    const cmds: FactoryCommand[] = [
      { type: "place", buildingId: "extractor", x: 7, y: 8 },
      { type: "place", buildingId: "smelter", ...smelterAt },
    ];
    if (withPower !== "none") cmds.push(...POWER);
    const { state, ids } = build(cmds);
    const [ext, smelter, coal, gen] = ids as [number, number, number?, number?];
    const links: FactoryCommand[] = [{ type: "link", from: ext, to: smelter }];
    if (withPower === "fed") links.push(powerLinks(coal!, gen!));
    return { state: run(build(links, state).state, 20), smelter };
  };

  it("an unpowered smelter produces nothing", () => {
    const { state, smelter } = chain({ x: 6, y: 7 }, "none");
    expect(node(state, smelter).produced).toBe(0);
    expect(node(state, smelter).status).toBe("unpowered");
  });

  it("a generator with no coal powers nothing", () => {
    const { state, smelter } = chain({ x: 6, y: 7 }, "no-coal");
    expect(node(state, smelter).produced).toBe(0);
    expect(node(state, smelter).status).toBe("unpowered");
  });

  it("a fed generator powers a smelter in radius", () => {
    const { state, smelter } = chain({ x: 6, y: 7 }, "fed");
    expect(node(state, smelter).produced).toBeGreaterThan(5);
  });

  it("but not one outside its radius", () => {
    const { state, smelter } = chain({ x: 6, y: 8 }, "fed"); // 4 rows below the generator
    expect(node(state, smelter).produced).toBe(0);
    expect(node(state, smelter).status).toBe("unpowered");
  });

  it("the generator burns coal at the content rate", () => {
    const { state, ids } = build(POWER);
    const [coal, gen] = ids as [number, number];
    const s = run(build([powerLinks(coal, gen)], state).state, 20);
    const g = node(s, gen);
    const burnt = node(s, coal).produced - node(s, coal).output - (g.inputs.coal ?? 0);
    expect(burnt).toBeCloseTo((20 - DT) / building("generator").fuel!.secondsPerItem, 6);
  });
});

describe("factory commands", () => {
  const base = build([
    { type: "place", buildingId: "extractor", x: 7, y: 7 },
    { type: "place", buildingId: "smelter", x: 6, y: 7 },
    { type: "place", buildingId: "hub", x: 6, y: 5 },
    { type: "place", buildingId: "smelter", x: 0, y: 5 }, // left of the path
  ]);
  const [ext, smelter, hub, farSmelter] = base.ids as [number, number, number, number];
  const tryCmd = (cmd: FactoryCommand) => applyFactoryCommand(base.state, ctx, cmd);

  it("assemblers need a recipe; single-recipe buildings pick theirs", () => {
    expect(tryCmd({ type: "place", buildingId: "assembler", x: 4, y: 7 }).error).toMatch(/recipe/);
    expect(node(base.state, smelter).recipeId).toBe("smelt_iron");
    expect(node(base.state, ext).oreId).toBe("iron_ore");
  });

  it("placement rules apply", () => {
    expect(tryCmd({ type: "place", buildingId: "smelter", x: 6, y: 7 }).error).toBe("tile occupied");
    expect(tryCmd({ type: "place", buildingId: "extractor", x: 4, y: 7 }).error).toMatch(/ore/);
  });

  it("links must carry something the target accepts", () => {
    expect(tryCmd({ type: "link", from: smelter, to: ext }).error).toMatch(/accept/);
    expect(tryCmd({ type: "link", from: hub, to: smelter }).error).toMatch(/hub need an item/);
  });

  it("links can't cross the path except at bridges", () => {
    expect(tryCmd({ type: "link", from: ext, to: farSmelter, tier: 2 }).error).toMatch(/bridge|exceeds/);
  });

  it("port limits come from content", () => {
    const one = applyFactoryCommand(base.state, ctx, { type: "link", from: ext, to: smelter });
    const second = applyFactoryCommand(one.state, ctx, { type: "link", from: ext, to: hub });
    expect(second.error).toMatch(/output port/);
  });

  it("failed commands leave the state untouched; remove drops its links", () => {
    const r = tryCmd({ type: "link", from: smelter, to: ext });
    expect(r.state).toBe(base.state);
    const linked = applyFactoryCommand(base.state, ctx, { type: "link", from: ext, to: smelter }).state;
    const removed = applyFactoryCommand(linked, ctx, { type: "remove", nodeId: smelter }).state;
    expect(removed.links).toEqual([]);
    expect(removed.nodes.map((n) => n.id)).toEqual([ext, hub, farSmelter]);
  });
});

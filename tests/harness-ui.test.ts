import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";
import { buildOptions, nodeAt, proposeLink } from "../harness/ui";

const ctx = makeGameCtx(biome1, "scrapyard_1");
const fresh = () => newGame(biome1, "scrapyard_1", 1);
const apply = (s: GameState, input: GameInput[]) => {
  const next = step(s, input, 0.1, ctx);
  if (next.errors.length) throw new Error(next.errors.join("; "));
  return next;
};
const labels = (s: GameState, x: number, y: number) => buildOptions(ctx, s, x, y).map((o) => o.label);

describe("build menu", () => {
  it("ore tiles offer only the extractor, for free", () => {
    const opts = buildOptions(ctx, fresh(), 7, 7);
    expect(opts.map((o) => o.label)).toEqual(["Extractor"]);
    expect(opts[0]!.cost).toEqual([]);
  });

  it("ground offers the Gunner and buildings, one assembler entry per unlocked recipe", () => {
    const l = labels(fresh(), 6, 6);
    expect(l).toContain("Gunner");
    expect(l).toContain("Smelter");
    expect(l).toContain("Assembler: bullets");
    expect(l).toContain("Assembler: red science pack");
    expect(l).not.toContain("Extractor");
  });

  it("research-locked things and labs are hidden", () => {
    const l = labels(fresh(), 6, 6);
    expect(l).not.toContain("Cannon");
    expect(l).not.toContain("Assembler: shells");
    expect(l).not.toContain("Press");
    expect(l).not.toContain("Lab");
  });

  it("path, rock and occupied tiles offer nothing", () => {
    expect(labels(fresh(), 4, 2)).toEqual([]); // path
    expect(labels(fresh(), 5, 6)).toEqual([]); // rock
    const s = apply(fresh(), [{ type: "place", buildingId: "hub", x: 6, y: 6 }]);
    expect(labels(s, 6, 6)).toEqual([]);
  });

  it("marks what you can't afford", () => {
    const broke = { ...fresh(), stock: { iron_ingot: 2 } };
    const opts = buildOptions(ctx, broke, 6, 6);
    expect(opts.find((o) => o.label === "Smelter")!.affordable).toBe(true);
    expect(opts.find((o) => o.label === "Gunner")!.affordable).toBe(false);
  });

  it("every option is a command the sim accepts", () => {
    for (const o of buildOptions(ctx, fresh(), 6, 6)) expect(step(fresh(), [o.input], 0.1, ctx).errors).toEqual([]);
  });
});

describe("drag to link", () => {
  const base = apply(fresh(), [
    { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 1
    { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 2
    { type: "place", buildingId: "hub", x: 7, y: 5 }, // 3
    { type: "placeTower", towerId: "gunner", x: 2, y: 7 }, // 4: 7 tiles from the hub
    { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 5
  ]);
  const n = (id: number) => base.factory.nodes.find((x) => x.id === id)!;

  it("links a building to the next one at tier 1", () => {
    const p = proposeLink(ctx, base, n(1), n(2));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.input).toEqual({ type: "link", from: 1, to: 2, tier: 1 });
    expect(p.route[0]).toEqual({ x: 7, y: 7 });
  });

  it("uses the lowest tier long enough", () => {
    const p = proposeLink(ctx, base, n(3), n(4));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.input).toMatchObject({ tier: 2, itemId: "bullets" });
  });

  it("out of a hub, sends what the target wants", () => {
    const p = proposeLink(ctx, base, n(3), n(5));
    expect(p.ok && p.input.itemId).toBe("bullets");
  });

  it("explains why a link can't be made", () => {
    const wrongWay = proposeLink(ctx, base, n(2), n(1));
    expect(wrongWay.ok).toBe(false);
    if (!wrongWay.ok) expect(wrongWay.reason).toMatch(/accept/);
    const fromTower = proposeLink(ctx, base, n(5), n(3));
    expect(fromTower.ok).toBe(false);
  });

  it("finds nodes by tile", () => {
    expect(nodeAt(base, 6, 7)?.id).toBe(2);
    expect(nodeAt(base, 0, 0)).toBeUndefined();
  });
});

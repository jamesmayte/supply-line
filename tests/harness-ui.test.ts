import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";
import { buildOptions, cardNote, inspect, nodeAt, proposeLink, upstreamProblem, waveReport, type WaveStats } from "../harness/ui";

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

describe("inspect sheet", () => {
  const run = (s: GameState, seconds: number) => {
    for (let i = 0; i < seconds / 0.1; i++) s = step(s, [], 0.1, ctx);
    return s;
  };
  const chain = (powered: boolean) =>
    apply(fresh(), [
      ...(powered ? [{ type: "place", buildingId: "extractor", x: 7, y: 3 } as GameInput, { type: "place", buildingId: "generator", x: 7, y: 4 } as GameInput] : []),
      { type: "place", buildingId: "extractor", x: 7, y: 7 },
      { type: "place", buildingId: "smelter", x: 6, y: 7 },
      { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" },
      { type: "placeTower", towerId: "gunner", x: 6, y: 8 },
    ]);
  const ids = (s: GameState) => s.factory.nodes.map((n) => n.id);

  it("a tower with no ammo link says so", () => {
    const s = chain(false);
    const gun = s.factory.nodes.find((n) => n.towerId)!;
    expect(upstreamProblem(ctx, s, gun)).toMatch(/No ammo link/);
  });

  it("names every unpowered building upstream of a dry Gunner, furthest first", () => {
    let s = chain(false);
    const [ext, sm, asm, gun] = ids(s) as [number, number, number, number];
    s = apply(s, [{ type: "link", from: ext, to: sm }, { type: "link", from: sm, to: asm }, { type: "link", from: asm, to: gun }]);
    s = run(s, 5);
    const g = s.factory.nodes.find((n) => n.id === gun)!;
    expect(g.status).toBe("starved");
    expect(upstreamProblem(ctx, s, g)).toMatch(/^Smelter and Assembler: bullets are unpowered/);
  });

  it("a powered chain shows no problem, and the tower sheet shows its magazine and rates", () => {
    let s = chain(true);
    const [coal, gen, ext, sm, asm, gun] = ids(s) as [number, number, number, number, number, number];
    s = apply(s, [{ type: "link", from: coal, to: gen }, { type: "link", from: ext, to: sm }, { type: "link", from: sm, to: asm }, { type: "link", from: asm, to: gun }]);
    s = run(s, 20);
    const g = s.factory.nodes.find((n) => n.id === gun)!;
    const info = inspect(ctx, s, g, 0);
    expect(info.title).toBe("Gunner");
    expect(info.lines.map((l) => l.label)).toEqual(expect.arrayContaining(["Magazine", "Stated fire rate", "Firing (last 5 s)", "Ammo arriving"]));
    expect(info.problem).toBeUndefined();
    const smelter = inspect(ctx, s, s.factory.nodes.find((n) => n.id === sm)!);
    expect(smelter.lines.find((l) => l.label === "Utilisation")?.value).toBe("80%"); // behind a 1 ore/s extractor
  });
});

describe("wave report and card notes", () => {
  const stats = (over: Partial<WaveStats> = {}): WaveStats => ({ kills: 5, leaked: 1, shots: 40, ammoMade: 42, towerTicks: 100, emptyTicks: 40, ...over });
  const none = { ammoRate: 2, limiting: [], cappedLinks: [] };

  it("names the bottleneck building and its gain", () => {
    const r = waveReport(ctx, stats(), { ammoRate: 2, limiting: [{ buildingId: "smelter", gainPct: 25 }], cappedLinks: [] });
    expect(r.advice).toBe("Bottleneck: Smelters. Upgrade one (tap it), or speeding them up 25% would raise ammo by 25%.");
    expect(r.lines.find((l) => l.label === "Gunners empty")).toMatchObject({ value: "40% of the wave", tone: "bad" });
  });

  it("a balanced chain says build another chain; a capped link says so", () => {
    expect(waveReport(ctx, stats(), none).advice).toMatch(/build another chain/);
    expect(waveReport(ctx, stats(), { ...none, cappedLinks: [3] }).advice).toMatch(/link is carrying its maximum/);
  });

  it("if Gunners rarely ran dry but enemies got through, ammo isn't the problem", () => {
    expect(waveReport(ctx, stats({ emptyTicks: 2 }), { ...none, limiting: [{ buildingId: "smelter", gainPct: 25 }] }).advice).toMatch(/add a Gunner/);
  });

  it("a clean wave says so before the tip", () => {
    expect(waveReport(ctx, stats({ leaked: 0, emptyTicks: 3 }), none).advice).toBe("Clean wave: nothing got through. To get ahead, another chain is the way to more ammo.");
  });

  it("no ammo at all says so", () => {
    expect(waveReport(ctx, stats(), { ammoRate: 0, limiting: [], cappedLinks: [] }).advice).toMatch(/No ammo is reaching/);
  });

  it("card notes show the projected gain, or that it won't help", () => {
    expect(cardNote({ cardId: "hot_smelters", kind: "ammo", baseline: 2, projected: 2.5, gainPct: 25 })).toBe("+25% ammo on your current setup (2 → 2.5/s)");
    expect(cardNote({ cardId: "better_drills", kind: "ammo", baseline: 2, projected: 2, gainPct: 0 })).toMatch(/No gain/);
    expect(cardNote({ cardId: "scrap_haul", kind: "grant", items: [{ itemId: "iron_ingot", qty: 8 }] })).toMatch(/^Build now/);
  });
});

describe("M1.6 sheet details", () => {
  it("the inspect sheet shows link slots and tier", () => {
    const s = apply(fresh(), [
      { type: "place", buildingId: "extractor", x: 7, y: 7 },
      { type: "place", buildingId: "smelter", x: 6, y: 7 },
      { type: "link", from: 1, to: 2 },
    ]);
    const sm = inspect(ctx, s, s.factory.nodes.find((n) => n.id === 2)!);
    expect(sm.lines.find((l) => l.label === "Link slots used")).toMatchObject({ value: "in 1/1 · out 0/1", tone: "warn" });
    expect(sm.lines.find((l) => l.label === "Tier")?.value).toBe("1 / 3");
  });

  it("a free-upgrade card names the building to upgrade", () => {
    const s = apply(fresh(), [{ type: "place", buildingId: "smelter", x: 6, y: 7 }]);
    expect(cardNote({ cardId: "free_upgrade", kind: "upgrade", nodeId: 1, baseline: 2, projected: 4, gainPct: 100 }, ctx, s)).toBe("Best use: upgrade Smelter → +100% ammo (2 → 4/s)");
    expect(cardNote({ cardId: "free_upgrade", kind: "upgrade", baseline: 2, projected: 2, gainPct: 0 }, ctx, s)).toMatch(/Keep it for later/);
  });
});

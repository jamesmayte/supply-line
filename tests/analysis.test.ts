import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { adviseCards, ammoRate, bestCard, findBottleneck } from "../core/analysis";
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";
import { hashState } from "../core/hash";

const ctx = makeGameCtx(biome1, "scrapyard_1");
const OPTS = { seconds: 40, measure: 20 };

/** Powered starter chain: coal → generator; iron → smelter → assembler → Gunner (ids 1..6). */
function chain(gunTier = 1): GameState {
  const cmds: GameInput[] = [
    { type: "place", buildingId: "extractor", x: 7, y: 3 },
    { type: "place", buildingId: "generator", x: 7, y: 4 },
    { type: "place", buildingId: "extractor", x: 7, y: 7 },
    { type: "place", buildingId: "smelter", x: 6, y: 7 },
    { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" },
    { type: "placeTower", towerId: "gunner", x: 6, y: 8 },
    { type: "link", from: 1, to: 2 },
    { type: "link", from: 3, to: 4 },
    { type: "link", from: 4, to: 5 },
    { type: "link", from: 5, to: 6, tier: gunTier },
  ];
  const s = step(newGame(biome1, "scrapyard_1", 1, { allResearched: true }), cmds, 0.1, ctx); // mechanics, not progression
  if (s.errors.length) throw new Error(s.errors.join("; "));
  return s;
}
/** Extractor sped up to exactly the smelter's limit and the assembler slowed to match: every stage at its limit. */
function balanced(): GameState {
  const s = structuredClone(chain(2));
  const smelterOre = 2 / 1.6; // smelt_iron: 2 ore per 1.6 s
  s.factory.speedMult = { extractor: smelterOre, assembler: (smelterOre / 2) / (1 / 1.5) };
  return s;
}
/** Extractors, assemblers and the Gunner link (tier 2) have headroom, so the smelter is the only bottleneck. */
function smelterBound(): GameState {
  const s = structuredClone(chain(2));
  s.factory.speedMult = { extractor: 2, assembler: 2 };
  return s;
}

describe("ammo rate", () => {
  it("a balanced starter chain delivers its content rate (2 bullets/s) to the Gunner", () => {
    expect(ammoRate(chain().factory, ctx.factory, OPTS)).toBeCloseTo(2, 2);
  });

  it("is zero with no tower linked", () => {
    const s = structuredClone(chain());
    s.factory.links = s.factory.links.filter((l) => l.to !== 6);
    expect(ammoRate(s.factory, ctx.factory, OPTS)).toBe(0);
  });

  it("doesn't touch the real state", () => {
    const s = chain();
    const before = hashState(s);
    ammoRate(s.factory, ctx.factory, OPTS);
    adviseCards(s, ctx, ["hot_smelters", "scrap_haul"], OPTS);
    expect(hashState(s)).toBe(before);
  });
});

describe("bottleneck", () => {
  it("the starter chain is limited by its extractor (+25% extractor speed → +25% ammo)", () => {
    const b = findBottleneck(chain().factory, ctx.factory, OPTS);
    expect(b.limiting.map((x) => x.buildingId)).toEqual(["extractor"]);
    expect(b.limiting[0]!.gainPct).toBeCloseTo(25, 0);
    expect(b.cappedLinks).toEqual([]);
  });

  it("a perfectly balanced chain has no single limiting stage, and a full link isn't blamed", () => {
    const b = findBottleneck(balanced().factory, ctx.factory, OPTS);
    expect(b.limiting).toEqual([]);
    expect(b.cappedLinks).toEqual([]);
  });

  it("finds the one stage holding the chain back", () => {
    const b = findBottleneck(smelterBound().factory, ctx.factory, OPTS);
    expect(b.limiting[0]?.buildingId).toBe("smelter");
    expect(b.limiting[0]!.gainPct).toBeCloseTo(25, 0);
    expect(b.limiting).toHaveLength(1);
    expect(b.cappedLinks).toEqual([]);
  });

  it("flags a link running at its tier cap", () => {
    const s = structuredClone(chain(1));
    s.factory.speedMult = { extractor: 2, smelter: 2, assembler: 2 }; // the factory could make 4/s; tier 1 carries 2
    const b = findBottleneck(s.factory, ctx.factory, OPTS);
    expect(b.ammoRate).toBeCloseTo(biome1.linkTiers[0]!.itemsPerSecond, 2);
    expect(b.cappedLinks).toContain(s.factory.links.find((l) => l.to === 6)!.id);
    expect(b.limiting).toEqual([]);
  });
});

describe("card advice", () => {
  it("projects each speed card's gain and recommends the best", () => {
    const advice = adviseCards(smelterBound(), ctx, ["rich_seams", "hot_smelters", "scrap_haul"], OPTS);
    const byId = Object.fromEntries(advice.map((a) => [a.cardId, a]));
    expect(byId.hot_smelters).toMatchObject({ kind: "ammo" });
    if (byId.hot_smelters!.kind === "ammo") expect(byId.hot_smelters!.gainPct).toBeCloseTo(25, 0);
    if (byId.rich_seams!.kind === "ammo") expect(byId.rich_seams!.gainPct).toBeCloseTo(0, 0);
    expect(byId.scrap_haul).toEqual({ cardId: "scrap_haul", kind: "grant", items: [{ itemId: "iron_ingot", qty: 8 }] });
    expect(bestCard(advice)).toBe("hot_smelters");
  });

  it("when no speed card helps, recommends ingots (build another chain); with no ingot card, nothing", () => {
    expect(bestCard(adviseCards(balanced(), ctx, ["rich_seams", "hot_smelters", "scrap_haul"], OPTS))).toBe("scrap_haul");
    expect(bestCard(adviseCards(balanced(), ctx, ["rich_seams", "hot_smelters", "quick_assembly"], OPTS))).toBeUndefined();
    // the plain starter chain is extractor-bound, so Rich seams helps there
    expect(bestCard(adviseCards(chain(), ctx, ["rich_seams", "hot_smelters", "scrap_haul"], OPTS))).toBe("rich_seams");
  });
});

describe("advice for the M1.6 cards", () => {
  it("'Wider links' shows a gain when a link is the limit", () => {
    const s = structuredClone(chain(1));
    s.factory.speedMult = { extractor: 2, smelter: 2, assembler: 2 }; // factory could make 4/s; a tier-1 link carries less
    const t1 = biome1.linkTiers[0]!.itemsPerSecond, t2 = biome1.linkTiers[1]!.itemsPerSecond;
    const [a] = adviseCards(s, ctx, ["wider_links"], OPTS);
    expect(a!.kind).toBe("ammo");
    if (a!.kind === "ammo") expect(a!.gainPct).toBeCloseTo(((Math.min(4, t2) - t1) / t1) * 100, 0);
  });

  it("'Free upgrade' names the building to upgrade, or nothing on a balanced chain", () => {
    const [bal] = adviseCards(balanced(), ctx, ["free_upgrade"], OPTS);
    expect(bal).toMatchObject({ kind: "upgrade", gainPct: 0 });
    expect(bal!.kind === "upgrade" && bal!.nodeId).toBeUndefined();
    const s = structuredClone(chain(2));
    s.factory.speedMult = { extractor: 2, assembler: 2 }; // smelter is the only bottleneck
    const [one] = adviseCards(s, ctx, ["free_upgrade"], OPTS);
    expect(one).toMatchObject({ kind: "upgrade", nodeId: 4 }); // the smelter
    // tier-2 smelter takes 2.5 ore/s; the doubled extractor gives 2, so ammo goes 2.5 → 4 bullets/s
    if (one!.kind === "upgrade") expect(one!.gainPct).toBeCloseTo(60, 0);
    expect(bestCard(adviseCards(s, ctx, ["free_upgrade", "hot_smelters"], OPTS))).toBe("free_upgrade");
  });
});

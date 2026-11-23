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
  const s = step(newGame(biome1, "scrapyard_1", 1), cmds, 0.1, ctx);
  if (s.errors.length) throw new Error(s.errors.join("; "));
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
  it("a balanced chain has no single limiting stage (every stage is at its limit)", () => {
    expect(findBottleneck(chain().factory, ctx.factory, OPTS).limiting).toEqual([]);
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
    const advice = adviseCards(smelterBound(), ctx, ["better_drills", "hot_smelters", "scrap_haul"], OPTS);
    const byId = Object.fromEntries(advice.map((a) => [a.cardId, a]));
    expect(byId.hot_smelters).toMatchObject({ kind: "ammo" });
    if (byId.hot_smelters!.kind === "ammo") expect(byId.hot_smelters!.gainPct).toBeCloseTo(25, 0);
    if (byId.better_drills!.kind === "ammo") expect(byId.better_drills!.gainPct).toBeCloseTo(0, 0);
    expect(byId.scrap_haul).toEqual({ cardId: "scrap_haul", kind: "grant", items: [{ itemId: "iron_ingot", qty: 8 }] });
    expect(bestCard(advice)).toBe("hot_smelters");
  });

  it("recommends nothing when no speed card helps (balanced chain)", () => {
    expect(bestCard(adviseCards(chain(), ctx, ["better_drills", "hot_smelters", "quick_assembly"], OPTS))).toBeUndefined();
  });
});

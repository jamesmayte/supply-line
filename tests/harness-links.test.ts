import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { makeGameCtx, newGame, step, type GameInput } from "../core/game";
import { assignLanes, chooseRoutes } from "../harness/links";

const ctx = makeGameCtx(biome1, "scrapyard_1");
const build = (cmds: GameInput[]) => {
  const s = step(newGame(biome1, "scrapyard_1", 1), cmds, 0.1, ctx);
  if (s.errors.length) throw new Error(s.errors.join("; "));
  return s.factory;
};

describe("link routes and lanes", () => {
  it("prefers the bend that doesn't cross a building", () => {
    // hub at (7,5) to Gunner at (6,7); an assembler sits on (7,6), so going down first would cross it
    const f = build([
      { type: "place", buildingId: "hub", x: 7, y: 5 },
      { type: "place", buildingId: "assembler", x: 7, y: 6, recipeId: "make_bullets" },
      { type: "placeTower", towerId: "gunner", x: 6, y: 7 },
      { type: "link", from: 1, to: 3, itemId: "bullets" },
    ]);
    const r = chooseRoutes(ctx.factory.grid, f.nodes, f.links).get(4)!;
    expect(r.map((p) => `${p.x},${p.y}`)).toEqual(["7,5", "6,5", "6,6", "6,7"]);
  });

  it("links sharing a stretch get different lanes; separate links stay centred", () => {
    const f = build([
      { type: "place", buildingId: "hub", x: 7, y: 5 }, // 1
      { type: "placeTower", towerId: "gunner", x: 3, y: 5 }, // 2
      { type: "placeTower", towerId: "gunner", x: 2, y: 5 }, // 3
      { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 4  (down: should avoid the shared stretch)
      { type: "link", from: 1, to: 2, itemId: "bullets" }, // 5
      { type: "link", from: 1, to: 3, itemId: "bullets", tier: 2 }, // 6: shares 7,5 → 3,5 with link 5
      { type: "link", from: 1, to: 4, itemId: "bullets" }, // 7
    ]);
    const lanes = assignLanes(chooseRoutes(ctx.factory.grid, f.nodes, f.links));
    expect(lanes.get(5)).toBe(0);
    expect(lanes.get(6)).toBe(1);
    expect(lanes.get(7)).toBe(0);
  });
});

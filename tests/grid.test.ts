import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { buildGrid, isEnemyTile, tileAt, tileKey } from "../core/grid";
import { buildPath, positionAt, reachedEnd } from "../core/path";
import { canPlaceBuilding, canPlaceTower, linkLength, routeLink } from "../core/placement";

const map = biome1.maps[0]!;
const grid = buildGrid(map);
const path = buildPath(map);
const building = (id: string) => biome1.buildings.find((b) => b.id === id)!;
const tier = (n: number) => biome1.linkTiers.find((t) => t.tier === n)!;

describe("grid", () => {
  it("is 9 wide and as tall as the map", () => {
    expect(grid.width).toBe(9);
    expect(grid.height).toBe(map.rows.length);
    expect(grid.tiles.length).toBe(9 * map.rows.length);
  });

  it("reads tile kinds and ore types", () => {
    expect(tileAt(grid, 4, 0)?.kind).toBe("spawn");
    expect(tileAt(grid, 4, 1)?.kind).toBe("path");
    expect(tileAt(grid, 7, 12)?.kind).toBe("bridge");
    expect(tileAt(grid, 7, 15)?.kind).toBe("core");
    expect(tileAt(grid, 5, 6)?.kind).toBe("rock");
    expect(tileAt(grid, 2, 2)?.kind).toBe("ground");
    expect(tileAt(grid, 0, 2)).toEqual({ kind: "ore", oreId: "iron_ore" });
    expect(tileAt(grid, 7, 2)).toEqual({ kind: "ore", oreId: "coal" });
  });

  it("returns undefined out of bounds", () => {
    expect(tileAt(grid, -1, 0)).toBeUndefined();
    expect(tileAt(grid, 9, 0)).toBeUndefined();
    expect(tileAt(grid, 0, grid.height)).toBeUndefined();
    expect(tileAt(grid, 0.5, 0)).toBeUndefined();
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildGrid(map))).toBe(JSON.stringify(grid));
  });
});

describe("path", () => {
  it("has the expected length (4 + 3 + 5 + 6 + 6 tiles)", () => {
    expect(path.length).toBe(24);
  });

  it("starts at the spawn centre and ends at the core centre", () => {
    expect(positionAt(path, 0)).toEqual({ x: 4.5, y: 0.5 });
    expect(positionAt(path, path.length)).toEqual({ x: 7.5, y: 15.5 });
  });

  it("interpolates along segments and around corners", () => {
    expect(positionAt(path, 2)).toEqual({ x: 4.5, y: 2.5 });
    expect(positionAt(path, 4)).toEqual({ x: 4.5, y: 4.5 });
    expect(positionAt(path, 5.5)).toEqual({ x: 3, y: 4.5 });
  });

  it("clamps outside [0, length]", () => {
    expect(positionAt(path, -3)).toEqual(positionAt(path, 0));
    expect(positionAt(path, 99)).toEqual(positionAt(path, path.length));
    expect(reachedEnd(path, path.length - 0.01)).toBe(false);
    expect(reachedEnd(path, path.length)).toBe(true);
  });

  it("every point along the path sits on an enemy tile", () => {
    for (let d = 0; d <= path.length; d += 0.25) {
      const p = positionAt(path, d);
      const tile = tileAt(grid, Math.floor(p.x), Math.floor(p.y));
      expect(tile && isEnemyTile(tile), `d=${d}`).toBe(true);
    }
  });
});

describe("placement", () => {
  const extractor = building("extractor");
  const smelter = building("smelter");

  it("extractors only on ore", () => {
    expect(canPlaceBuilding(grid, extractor, 0, 2).ok).toBe(true);
    expect(canPlaceBuilding(grid, extractor, 2, 2)).toEqual({ ok: false, reason: "extractors go on ore" });
  });

  it("other buildings and towers on ground, not ore", () => {
    expect(canPlaceBuilding(grid, smelter, 2, 2).ok).toBe(true);
    expect(canPlaceBuilding(grid, smelter, 0, 2).ok).toBe(false);
    expect(canPlaceTower(grid, 2, 2).ok).toBe(true);
    expect(canPlaceTower(grid, 0, 2).ok).toBe(false);
  });

  it("nothing on path, spawn, bridge, core or rock", () => {
    for (const [x, y] of [[4, 0], [4, 1], [7, 12], [7, 15], [5, 6]] as const) {
      expect(canPlaceBuilding(grid, smelter, x, y).ok, `(${x},${y})`).toBe(false);
      expect(canPlaceTower(grid, x, y).ok, `(${x},${y})`).toBe(false);
    }
    expect(canPlaceTower(grid, 4, 1)).toEqual({ ok: false, reason: "can't build on the path" });
    expect(canPlaceTower(grid, 5, 6)).toEqual({ ok: false, reason: "rock blocks building" });
  });

  it("rejects occupied and out-of-bounds tiles", () => {
    expect(canPlaceTower(grid, 2, 2, new Set([tileKey(2, 2)]))).toEqual({ ok: false, reason: "tile occupied" });
    expect(canPlaceTower(grid, 9, 0).ok).toBe(false);
  });
});

describe("links", () => {
  it("can cross the path at a bridge", () => {
    const r = routeLink(grid, { x: 6, y: 12 }, { x: 8, y: 12 }, tier(1));
    expect(r.ok).toBe(true);
  });

  it("can't cross the path elsewhere", () => {
    const r = routeLink(grid, { x: 6, y: 11 }, { x: 8, y: 11 }, tier(1));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/bridge/) });
  });

  it("can't cross rock", () => {
    const r = routeLink(grid, { x: 4, y: 6 }, { x: 6, y: 6 }, tier(1));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/rock/) });
  });

  it("takes the other L bend when the first is blocked", () => {
    const r = routeLink(grid, { x: 4, y: 6 }, { x: 6, y: 8 }, tier(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.route[1]).toEqual({ x: 4, y: 7 }); // vertical first, around the rock
  });

  it("respects the tier's max length from content", () => {
    const a = { x: 0, y: 0 }, b = { x: 0, y: 7 };
    expect(linkLength(a, b)).toBe(7);
    expect(routeLink(grid, a, b, tier(1))).toMatchObject({ ok: false, reason: expect.stringMatching(/exceeds/) });
    expect(routeLink(grid, a, b, tier(2)).ok).toBe(true);
  });

  it("rejects self-links and out-of-bounds endpoints", () => {
    expect(routeLink(grid, { x: 2, y: 2 }, { x: 2, y: 2 }, tier(1)).ok).toBe(false);
    expect(routeLink(grid, { x: 2, y: 2 }, { x: 9, y: 2 }, tier(1)).ok).toBe(false);
  });
});

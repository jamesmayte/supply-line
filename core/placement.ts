/**
 * Placement rules (spec §3):
 *  - Path / spawn / core / bridge: nothing can be built.
 *  - Rock: blocks building and links.
 *  - Ore: extractors only. Ground: any building or tower except extractors.
 *  - Links auto-route as an L along the grid, may only cross the path at bridges, never cross rock,
 *    and are limited by their tier's maxLength (content data).
 */
import type { Content } from "../content/schema";
import { isEnemyTile, tileAt, tileKey, type Grid, type Tile } from "./grid";

export type Check = { ok: true } | { ok: false; reason: string };
const ok: Check = { ok: true };
const fail = (reason: string): Check => ({ ok: false, reason });

type Building = Content["buildings"][number];
type LinkTier = Content["linkTiers"][number];

/** Tiles already holding a building or tower, as tileKey(x, y). */
export type Occupied = ReadonlySet<string>;

function baseCheck(grid: Grid, x: number, y: number, occupied: Occupied): Check | Tile {
  const tile = tileAt(grid, x, y);
  if (!tile) return fail("out of bounds");
  if (occupied.has(tileKey(x, y))) return fail("tile occupied");
  if (tile.kind === "rock") return fail("rock blocks building");
  if (isEnemyTile(tile)) return fail("can't build on the path");
  return tile;
}

export function canPlaceBuilding(grid: Grid, building: Building, x: number, y: number, occupied: Occupied = new Set()): Check {
  const r = baseCheck(grid, x, y, occupied);
  if ("ok" in r) return r;
  if (building.kind === "extractor") return r.kind === "ore" ? ok : fail("extractors go on ore");
  return r.kind === "ore" ? fail("only extractors go on ore") : ok;
}

export function canPlaceTower(grid: Grid, x: number, y: number, occupied: Occupied = new Set()): Check {
  const r = baseCheck(grid, x, y, occupied);
  if ("ok" in r) return r;
  return r.kind === "ore" ? fail("only extractors go on ore") : ok;
}

/* ---------- links ---------- */

export interface TileXY {
  readonly x: number;
  readonly y: number;
}

/** Link length in tiles (Manhattan distance; L-routes are always this long). */
export const linkLength = (a: TileXY, b: TileXY): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Every tile on an L-route from a to b, inclusive. horizontalFirst picks the bend. */
export function lRoute(a: TileXY, b: TileXY, horizontalFirst: boolean): TileXY[] {
  const out: TileXY[] = [{ x: a.x, y: a.y }];
  let { x, y } = a;
  const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); out.push({ x, y }); } };
  const stepY = () => { while (y !== b.y) { y += Math.sign(b.y - y); out.push({ x, y }); } };
  if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  return out;
}

/** Why a single route is invalid, or ok. Endpoints are the linked buildings and are not checked here. */
export function checkRoute(grid: Grid, route: readonly TileXY[]): Check {
  for (const { x, y } of route.slice(1, -1)) {
    const tile = tileAt(grid, x, y);
    if (!tile) return fail("link leaves the map");
    if (tile.kind === "rock") return fail(`rock blocks link at (${x},${y})`);
    if (isEnemyTile(tile) && tile.kind !== "bridge") return fail(`link can only cross the path at a bridge (${x},${y})`);
  }
  return ok;
}

export type LinkResult = { ok: true; route: TileXY[] } | { ok: false; reason: string };

/**
 * Validate a link from building a to building b at the given tier and return its route.
 * Tries horizontal-first then vertical-first (deterministic); the first valid L wins.
 */
export function routeLink(grid: Grid, a: TileXY, b: TileXY, tier: LinkTier): LinkResult {
  if (!tileAt(grid, a.x, a.y) || !tileAt(grid, b.x, b.y)) return { ok: false, reason: "out of bounds" };
  if (a.x === b.x && a.y === b.y) return { ok: false, reason: "can't link a building to itself" };
  const len = linkLength(a, b);
  if (len > tier.maxLength) return { ok: false, reason: `link length ${len} exceeds tier ${tier.tier} max ${tier.maxLength}` };
  const reasons: string[] = [];
  for (const horizontalFirst of [true, false]) {
    const route = lRoute(a, b, horizontalFirst);
    const c = checkRoute(grid, route);
    if (c.ok) return { ok: true, route };
    if (!reasons.includes(c.reason)) reasons.push(c.reason);
  }
  return { ok: false, reason: reasons.join("; ") };
}

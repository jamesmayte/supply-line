/**
 * Grid built from a map definition. Pure data, no I/O (CLAUDE.md invariant 1).
 * Coordinates: x = column (0..width-1, left→right), y = row (0..height-1, top→bottom).
 */
import { ORE_BY_CHAR, type GameMap } from "../content/schema";

export type TileKind = "ground" | "rock" | "spawn" | "path" | "bridge" | "core" | "ore";

export interface Tile {
  readonly kind: TileKind;
  /** item id of the ore under this tile, only when kind === "ore" */
  readonly oreId?: string;
}

export interface Grid {
  readonly width: number;
  readonly height: number;
  /** row-major: tiles[y * width + x] */
  readonly tiles: readonly Tile[];
}

const KIND_BY_CHAR: Record<string, TileKind> = {
  ".": "ground",
  "#": "rock",
  S: "spawn",
  P: "path",
  B: "bridge",
  X: "core",
};

/** Tiles enemies walk on. Bridges are path tiles that links may cross. */
export const ENEMY_TILES: readonly TileKind[] = ["spawn", "path", "bridge", "core"];

export function tileFromChar(ch: string): Tile {
  const ore = ORE_BY_CHAR[ch];
  if (ore) return { kind: "ore", oreId: ore };
  const kind = KIND_BY_CHAR[ch];
  if (!kind) throw new Error(`unknown tile char '${ch}'`);
  return { kind };
}

export function buildGrid(map: GameMap): Grid {
  const width = map.width;
  const height = map.rows.length;
  const tiles: Tile[] = [];
  map.rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`map ${map.id}: row ${y} has width ${row.length}, expected ${width}`);
    for (const ch of row) tiles.push(tileFromChar(ch));
  });
  return { width, height, tiles };
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** Tile at (x, y), or undefined when out of bounds. */
export function tileAt(grid: Grid, x: number, y: number): Tile | undefined {
  return inBounds(grid, x, y) ? grid.tiles[y * grid.width + x] : undefined;
}

export function isEnemyTile(tile: Tile): boolean {
  return ENEMY_TILES.includes(tile.kind);
}

/** Stable key for a tile coordinate, for occupancy sets. */
export const tileKey = (x: number, y: number): string => `${x},${y}`;

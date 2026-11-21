/**
 * Enemy path as an ordered polyline through tile centres. An enemy's position is a single number:
 * distance (in tiles) travelled along the path from the spawn centre.
 */
import type { GameMap } from "../content/schema";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Path {
  /** waypoint tile centres, spawn → core */
  readonly points: readonly Point[];
  /** cumulative distance at each point; cumulative[0] = 0 */
  readonly cumulative: readonly number[];
  /** total length in tiles */
  readonly length: number;
}

/** Centre of tile (x, y) in tile units. */
export const tileCentre = (x: number, y: number): Point => ({ x: x + 0.5, y: y + 0.5 });

export function buildPath(map: GameMap): Path {
  if (map.path.length < 2) throw new Error(`map ${map.id}: path needs at least 2 waypoints`);
  const points = map.path.map(([x, y]) => tileCentre(x, y));
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.abs(b.x - a.x) + Math.abs(b.y - a.y)); // segments are axis-aligned
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1]! };
}

/** World position at distance d along the path, clamped to [0, length]. */
export function positionAt(path: Path, d: number): Point {
  if (d <= 0) return path.points[0]!;
  if (d >= path.length) return path.points[path.points.length - 1]!;
  let i = 1;
  while (path.cumulative[i]! < d) i++;
  const a = path.points[i - 1]!;
  const b = path.points[i]!;
  const segStart = path.cumulative[i - 1]!;
  const t = (d - segStart) / (path.cumulative[i]! - segStart);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** True once an enemy at distance d has reached the core. */
export const reachedEnd = (path: Path, d: number): boolean => d >= path.length;

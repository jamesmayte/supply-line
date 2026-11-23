// Link drawing helpers (DOM-free, tested in tests/harness-links.test.ts). Cosmetic only: the sim stores a
// link's tier and length; which way its L bends on screen, and which lane it takes, is decided here.
import type { FactoryLink, FactoryNode } from "../core/factory";
import type { Grid } from "../core/grid";
import { checkRoute, lRoute, type TileXY } from "../core/placement";

const key = (p: TileXY) => `${p.x},${p.y}`;
const segKey = (a: TileXY, b: TileXY) => (a.x < b.x || (a.x === b.x && a.y < b.y) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`);

/**
 * Pick each link's on-screen L (bend horizontal-first or vertical-first). Both bends have the same length,
 * so the choice is cosmetic. Prefer the bend that crosses fewer other buildings and fewer tiles already
 * used by earlier links. Links are placed in id order so the picture is stable.
 */
export function chooseRoutes(grid: Grid, nodes: readonly FactoryNode[], links: readonly FactoryLink[]): Map<number, TileXY[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const buildingTiles = new Set(nodes.map((n) => key(n)));
  const used = new Map<string, number>(); // segment → links already on it
  const out = new Map<number, TileXY[]>();
  for (const l of [...links].sort((a, b) => a.id - b.id)) {
    const from = byId.get(l.from), to = byId.get(l.to);
    if (!from || !to) continue;
    const options = [true, false]
      .map((h) => lRoute(from, to, h))
      .filter((r) => checkRoute(grid, r).ok);
    if (!options.length) options.push(lRoute(from, to, true));
    const score = (r: TileXY[]) => {
      let s = 0;
      for (let i = 1; i < r.length - 1; i++) if (buildingTiles.has(key(r[i]!))) s += 3; // crossing a building reads badly
      for (let i = 1; i < r.length; i++) s += used.get(segKey(r[i - 1]!, r[i]!)) ?? 0;
      return s;
    };
    const best = options.reduce((a, b) => (score(b) < score(a) ? b : a));
    for (let i = 1; i < best.length; i++) {
      const k = segKey(best[i - 1]!, best[i]!);
      used.set(k, (used.get(k) ?? 0) + 1);
    }
    out.set(l.id, best);
  }
  return out;
}

/**
 * Lanes for links that share grid segments, so doubled-up links draw side by side instead of on top of
 * each other. Returns an offset index per link: 0 = centre, then +1, −1, +2, … Links that share no
 * segment with anything stay in the centre.
 */
export function assignLanes(routes: ReadonlyMap<number, TileXY[]>): Map<number, number> {
  const segsOf = new Map<number, Set<string>>();
  for (const [id, r] of routes) {
    const s = new Set<string>();
    for (let i = 1; i < r.length; i++) s.add(segKey(r[i - 1]!, r[i]!));
    segsOf.set(id, s);
  }
  const ORDER = [0, 1, -1, 2, -2, 3, -3];
  const lanes = new Map<number, number>();
  const ids = [...routes.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const mine = segsOf.get(id)!;
    const taken = new Set<number>();
    for (const [other, lane] of lanes) for (const s of segsOf.get(other)!) if (mine.has(s)) { taken.add(lane); break; }
    lanes.set(id, ORDER.find((o) => !taken.has(o)) ?? 0);
  }
  return lanes;
}

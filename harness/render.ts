// Canvas 2D renderer. Reads sim state only, never mutates it (CLAUDE.md invariant 4).
// Everything here is cosmetic: dots on links show flow rate, they are not items.
import type { GameMap } from "../content/schema";
import { towerOf, type FactoryNode } from "../core/factory";
import type { Enemy, GameCtx, GameState } from "../core/game";
import { positionAt, tileCentre, type Point } from "../core/path";
import { routeLink, type TileXY } from "../core/placement";
import { magazineCount } from "../core/towers";

const TILE_COLOURS: Record<string, string> = {
  ground: "#23262c", rock: "#3a3d44", spawn: "#6b4f2a", path: "#5c4a30", bridge: "#8a6a3a", core: "#c0453a",
};
const ORE_COLOURS: Record<string, string> = { iron_ore: "#4e6a85", coal: "#3a3330", copper_ore: "#9a5f30", crystal_ore: "#6a52a0" };
const ORE_SPECKS: Record<string, string> = { iron_ore: "#8fb0cf", coal: "#0c0c0d", copper_ore: "#e0a060", crystal_ore: "#c9b6f0" };
const ITEM_COLOURS: Record<string, string> = {
  iron_ore: "#8fb0cf", coal: "#5a5a5a", iron_ingot: "#d8dde3", plate: "#b9c2cc", powder: "#7a7a7a",
  bullets: "#f2c14e", shells: "#e88a3a", red_pack: "#e0574a",
};
const STATUS_COLOURS: Record<string, string> = {
  working: "#5fbf6a", starved: "#e0574a", backlogged: "#e0b04a", unpowered: "#6f737b", idle: "#4a4e56",
};
const KIND_LETTERS: Record<string, string> = {
  extractor: "E", processor: "S", assembler: "A", hub: "H", generator: "P", lab: "L",
};
const ENEMY_STYLE: Record<string, { colour: string; r: number }> = {
  walker: { colour: "#d9d4c7", r: 0.22 },
  swarmer: { colour: "#9fd36b", r: 0.15 },
  armoured: { colour: "#8a8f99", r: 0.3 },
};

export interface Renderer {
  draw(prev: GameState, cur: GameState, alpha: number, time: number): void;
  resize(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, ctx: GameCtx, map: GameMap): Renderer {
  const g = canvas.getContext("2d")!;
  const grid = ctx.factory.grid;
  let tile = 40;

  /** Fit the whole map between the top and bottom bars: tile size limited by width and by height. */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const chrome = Array.from(document.querySelectorAll<HTMLElement>(".bar")).reduce((a, el) => a + el.offsetHeight, 0);
    const availW = Math.min(window.innerWidth, 480);
    const availH = Math.max(200, window.innerHeight - chrome);
    tile = Math.floor(Math.min(availW / map.width, availH / map.rows.length));
    const cssW = tile * map.width;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${tile * map.rows.length}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(tile * map.rows.length * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const px = (p: Point) => ({ x: p.x * tile, y: p.y * tile });

  // Link routes are deterministic from the two endpoints; cache by link id + endpoints.
  const routeCache = new Map<string, Point[]>();
  function routeOf(from: FactoryNode, to: FactoryNode, tier: number): Point[] {
    const key = `${from.x},${from.y}>${to.x},${to.y}`;
    let pts = routeCache.get(key);
    if (!pts) {
      const t = ctx.factory.tiers.get(tier)!;
      const r = routeLink(grid, from, to, t);
      const tiles: TileXY[] = r.ok ? r.route : [from, to];
      pts = tiles.map((p) => tileCentre(p.x, p.y));
      routeCache.set(key, pts);
    }
    return pts;
  }

  function drawMap() {
    for (let y = 0; y < map.rows.length; y++)
      for (let x = 0; x < map.width; x++) {
        const t = grid.tiles[y * map.width + x]!;
        g.fillStyle = t.kind === "ore" ? (ORE_COLOURS[t.oreId ?? ""] ?? "#555") : (TILE_COLOURS[t.kind] ?? "#f0f");
        g.fillRect(x * tile + 1, y * tile + 1, tile - 2, tile - 2);
        if (t.kind === "ore") {
          g.fillStyle = ORE_SPECKS[t.oreId ?? ""] ?? "#999";
          for (const [sx, sy] of [[0.28, 0.3], [0.68, 0.42], [0.4, 0.7], [0.75, 0.78]] as const) {
            g.beginPath();
            g.arc((x + sx) * tile, (y + sy) * tile, tile * 0.05, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    // path centre line
    g.strokeStyle = "rgba(255, 220, 160, 0.18)";
    g.lineWidth = tile * 0.12;
    g.setLineDash([tile * 0.2, tile * 0.2]);
    g.beginPath();
    ctx.path.points.forEach((p, i) => (i ? g.lineTo(p.x * tile, p.y * tile) : g.moveTo(p.x * tile, p.y * tile)));
    g.stroke();
    g.setLineDash([]);
  }

  function drawLinks(state: GameState, time: number) {
    const byId = new Map(state.factory.nodes.map((n) => [n.id, n]));
    for (const l of state.factory.links) {
      const from = byId.get(l.from);
      const to = byId.get(l.to);
      if (!from || !to) continue;
      const pts = routeOf(from, to, l.tier);
      g.strokeStyle = l.tier >= 2 ? "rgba(200, 210, 230, 0.55)" : "rgba(200, 210, 230, 0.3)";
      g.lineWidth = tile * (l.tier >= 2 ? 0.12 : 0.08);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x * tile, p.y * tile) : g.moveTo(p.x * tile, p.y * tile)));
      g.stroke();
      // cosmetic dots: spacing 0.5 tile, moving at flow/2 tiles per second (one dot = one item)
      if (l.flow > 1e-6) {
        const spacing = 0.5;
        const offset = ((time * l.flow * spacing) % spacing + spacing) % spacing;
        const length = pts.reduce((a, p, i) => (i ? a + Math.abs(p.x - pts[i - 1]!.x) + Math.abs(p.y - pts[i - 1]!.y) : 0), 0);
        g.fillStyle = ITEM_COLOURS[l.itemId] ?? "#fff";
        for (let d = offset; d < length; d += spacing) {
          const p = pointAlong(pts, d);
          g.beginPath();
          g.arc(p.x * tile, p.y * tile, tile * 0.07, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  function drawBuilding(n: FactoryNode) {
    const b = ctx.factory.buildings.get(n.buildingId)!;
    const x = n.x * tile, y = n.y * tile, pad = tile * 0.1, s = tile - pad * 2;
    g.fillStyle = "#2f343d";
    roundRect(x + pad, y + pad, s, s, tile * 0.15);
    g.fill();
    g.strokeStyle = STATUS_COLOURS[n.status] ?? "#888";
    g.lineWidth = tile * 0.06;
    g.stroke();
    g.fillStyle = "#e8e6e1";
    g.font = `600 ${tile * 0.38}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(KIND_LETTERS[b.kind] ?? "?", x + tile / 2, y + tile * 0.45);
    // utilisation bar (hubs show fill instead)
    const frac = b.kind === "hub" ? Object.values(n.inputs).reduce((a, v) => a + v, 0) / b.bufferSize : n.utilisation;
    const bw = s - tile * 0.16;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(x + pad + tile * 0.08, y + tile * 0.72, bw, tile * 0.08);
    g.fillStyle = STATUS_COLOURS[n.status] ?? "#888";
    g.fillRect(x + pad + tile * 0.08, y + tile * 0.72, bw * Math.max(0, Math.min(1, frac)), tile * 0.08);
  }

  function drawTower(n: FactoryNode, time: number) {
    const t = towerOf(ctx.factory, n)!;
    const c = px(tileCentre(n.x, n.y));
    // faint range
    g.strokeStyle = "rgba(242, 193, 78, 0.10)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(c.x, c.y, t.range * tile, 0, Math.PI * 2);
    g.stroke();
    // body
    g.fillStyle = "#3b3f48";
    g.beginPath();
    g.arc(c.x, c.y, tile * 0.32, 0, Math.PI * 2);
    g.fill();
    // magazine ring; flashes red when empty
    const frac = Math.min(1, magazineCount(n) / t.magazine);
    const empty = n.status === "starved";
    const flash = empty && Math.floor(time * 4) % 2 === 0;
    g.lineWidth = tile * 0.08;
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.beginPath();
    g.arc(c.x, c.y, tile * 0.4, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = empty ? (flash ? "#ff4a3a" : "#7a2a24") : "#f2c14e";
    g.beginPath();
    g.arc(c.x, c.y, tile * 0.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (empty ? 1 : frac));
    g.stroke();
    g.fillStyle = "#e8e6e1";
    g.font = `700 ${tile * 0.3}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(t.name[0] ?? "T", c.x, c.y + 1);
  }

  function drawEnemies(prev: GameState, cur: GameState, alpha: number) {
    const before = new Map(prev.enemies.map((e) => [e.id, e]));
    for (const e of cur.enemies) {
      const p0 = before.get(e.id);
      const d = p0 ? p0.d + (e.d - p0.d) * alpha : e.d;
      drawEnemy(e, positionAt(ctx.path, d));
    }
  }

  function drawEnemy(e: Enemy, at: Point) {
    const def = ctx.enemies.get(e.enemyId)!;
    const style = ENEMY_STYLE[e.enemyId] ?? { colour: "#ff6ad5", r: 0.22 };
    const c = px(at);
    g.fillStyle = style.colour;
    g.beginPath();
    g.arc(c.x, c.y, tile * style.r, 0, Math.PI * 2);
    g.fill();
    if (def.armour > 0) {
      g.strokeStyle = "#cfd5de";
      g.lineWidth = tile * 0.05;
      g.stroke();
    }
    const w = tile * 0.5, h = tile * 0.07;
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(c.x - w / 2, c.y - tile * style.r - h * 2.2, w, h);
    g.fillStyle = "#e0574a";
    g.fillRect(c.x - w / 2, c.y - tile * style.r - h * 2.2, w * Math.max(0, e.hp / def.hp), h);
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  return {
    resize,
    draw(prev, cur, alpha, time) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      drawMap();
      drawLinks(cur, time);
      for (const n of cur.factory.nodes) (n.towerId ? drawTower(n, time) : drawBuilding(n));
      drawEnemies(prev, cur, alpha);
    },
  };
}

/** Point at distance d along an axis-aligned polyline. */
function pointAlong(pts: Point[], d: number): Point {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (d <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, d / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    d -= seg;
  }
  return pts[0]!;
}

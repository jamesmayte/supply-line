/**
 * Factory graph (spec §4). Buildings are nodes, links are capped edges. Items are rates and buffers,
 * never individual entities: buffers hold fractional amounts and recipes run fractionally each tick.
 *
 * Tick order (deterministic, by id): power → production → transport. Towers are nodes too (link targets
 * whose input buffer is their magazine); they fire in core/towers.ts after the factory step.
 * All gameplay numbers come from content via FactoryCtx; nothing here is tuned by hand.
 */
import type { Content } from "../content/schema";
import type { Grid } from "./grid";

type Building = Content["buildings"][number];
type Recipe = Content["recipes"][number];
type Item = Content["items"][number];
type LinkTier = Content["linkTiers"][number];
type Tower = Content["towers"][number];

/** float tolerance for "full", "empty" and "running flat out" */
export const EPS = 1e-9;

/** Below this utilisation an input-limited building reports "starved" (display classification, not a rate). */
export const STARVED_BELOW = 0.6;

export type NodeStatus = "working" | "starved" | "backlogged" | "unpowered" | "idle";

export interface FactoryNode {
  id: number;
  buildingId: string;
  x: number;
  y: number;
  /** processors/assemblers */
  recipeId?: string;
  /** extractors: the ore under them */
  oreId?: string;
  /** input buffer per item (hubs: their whole store) */
  inputs: Record<string, number>;
  /** output buffer of this node's single output item (unused by hubs) */
  output: number;
  /** generators: whether they powered things this tick */
  burning: boolean;
  /** last tick: fraction of max rate achieved, 0..1 */
  utilisation: number;
  status: NodeStatus;
  /** cumulative items produced (or extracted) */
  produced: number;
  /** in-place upgrade tier (spec §7.2); absent = 1 */
  level?: number;
  /** towers only: which tower this node is (buildingId holds the same id) */
  towerId?: string;
  /** towers only: seconds until the next shot may fire */
  cooldown?: number;
  /** towers only: cumulative shots fired */
  shots?: number;
}

export interface FactoryLink {
  id: number;
  from: number;
  to: number;
  itemId: string;
  tier: number;
  length: number;
  /** last tick: items per second actually moved */
  flow: number;
}

export interface FactoryState {
  nextId: number;
  nodes: FactoryNode[];
  links: FactoryLink[];
  /** speed multipliers by building id from run effects (cards); absent = 1 */
  speedMult?: Record<string, number>;
  /** run effect: links carry as if this many tiers higher (capped at the top tier); absent = 0 */
  linkBonus?: number;
  /** research effect: generators burn this fraction of their content fuel rate; absent = 1 */
  fuelUse?: number;
}

export const emptyFactory = (): FactoryState => ({ nextId: 1, nodes: [], links: [] });

/** Speed multiplier from a node's upgrade tier (tier 1 = 1). */
export const levelMult = (b: Building, node?: FactoryNode): number => {
  const lvl = node?.level ?? 1;
  return lvl <= 1 ? 1 : (b.upgrades[lvl - 2]?.speed ?? 1);
};

/** Effective speed of a building: content speed × upgrade tier × any run multipliers. */
export const speedOf = (state: FactoryState, b: Building, node?: FactoryNode): number =>
  b.speed * levelMult(b, node) * (state.speedMult?.[b.id] ?? 1);

/** Items per second a link can carry, including run bonuses (capped at the top tier). */
export function linkCap(ctx: FactoryCtx, state: FactoryState, l: FactoryLink): number {
  const top = Math.max(...ctx.tiers.keys());
  const tier = Math.min(top, l.tier + (state.linkBonus ?? 0));
  return ctx.tiers.get(tier)?.itemsPerSecond ?? 0;
}

/** Static lookups built once from content. */
export interface FactoryCtx {
  content: Content;
  grid: Grid;
  buildings: ReadonlyMap<string, Building>;
  recipes: ReadonlyMap<string, Recipe>;
  items: ReadonlyMap<string, Item>;
  tiers: ReadonlyMap<number, LinkTier>;
  towers: ReadonlyMap<string, Tower>;
}

export function makeFactoryCtx(content: Content, grid: Grid): FactoryCtx {
  return {
    content,
    grid,
    buildings: new Map(content.buildings.map((b) => [b.id, b])),
    recipes: new Map(content.recipes.map((r) => [r.id, r])),
    items: new Map(content.items.map((i) => [i.id, i])),
    tiers: new Map(content.linkTiers.map((t) => [t.tier, t])),
    towers: new Map(content.towers.map((t) => [t.id, t])),
  };
}

const sum = (rec: Record<string, number>): number => Object.values(rec).reduce((a, b) => a + b, 0);
const clean = (v: number): number => (v < EPS ? 0 : v);

/** The tower a node is, if it is one. */
export function towerOf(ctx: FactoryCtx, node: FactoryNode): Tower | undefined {
  if (!node.towerId) return undefined;
  const t = ctx.towers.get(node.towerId);
  if (!t) throw new Error(`unknown tower '${node.towerId}'`);
  return t;
}

export function buildingOf(ctx: FactoryCtx, node: FactoryNode): Building {
  if (node.towerId) throw new Error(`node ${node.id} is a tower, not a building`);
  const b = ctx.buildings.get(node.buildingId);
  if (!b) throw new Error(`unknown building '${node.buildingId}'`);
  return b;
}

/** The single item a non-hub node outputs, if any. */
export function outputItem(ctx: FactoryCtx, node: FactoryNode): string | undefined {
  if (node.oreId) return node.oreId;
  if (node.recipeId) return ctx.recipes.get(node.recipeId)?.outputs[0]?.itemId;
  return undefined;
}

/** Items available to leave a node along a link carrying itemId. */
function available(ctx: FactoryCtx, node: FactoryNode, itemId: string): number {
  if (node.towerId) return 0;
  if (buildingOf(ctx, node).kind === "hub") return node.inputs[itemId] ?? 0;
  return outputItem(ctx, node) === itemId ? node.output : 0;
}

function take(ctx: FactoryCtx, node: FactoryNode, itemId: string, qty: number): void {
  if (node.towerId) return; // towers never output
  if (buildingOf(ctx, node).kind === "hub") node.inputs[itemId] = clean((node.inputs[itemId] ?? 0) - qty);
  else node.output = clean(node.output - qty);
}

/** Free input space for itemId. Hubs share one pool across items; a tower's magazine is one pool too. */
function freeSpace(ctx: FactoryCtx, node: FactoryNode, itemId: string): number {
  const tower = towerOf(ctx, node);
  if (tower) return Math.max(0, tower.magazine - sum(node.inputs));
  const b = buildingOf(ctx, node);
  if (b.kind === "hub") return Math.max(0, b.bufferSize - sum(node.inputs));
  return Math.max(0, b.bufferSize - (node.inputs[itemId] ?? 0));
}

/** Power: Chebyshev distance (a square around the generator) ≤ powerRadius. */
export function isPowered(ctx: FactoryCtx, state: FactoryState, node: FactoryNode): boolean {
  return state.nodes.some((g) => {
    if (!g.burning) return false;
    const r = buildingOf(ctx, g).powerRadius ?? 0;
    return Math.max(Math.abs(g.x - node.x), Math.abs(g.y - node.y)) <= r;
  });
}

/* ---------- tick phases ---------- */

function stepPower(ctx: FactoryCtx, state: FactoryState, dt: number): void {
  for (const n of state.nodes) {
    if (n.towerId) continue;
    const b = buildingOf(ctx, n);
    if (b.kind !== "generator" || !b.fuel) continue;
    const need = (dt / b.fuel.secondsPerItem) * (state.fuelUse ?? 1);
    const have = n.inputs[b.fuel.itemId] ?? 0;
    n.burning = have >= need - EPS;
    if (n.burning) n.inputs[b.fuel.itemId] = clean(have - need);
    n.utilisation = n.burning ? 1 : 0;
    n.status = n.burning ? "working" : "starved";
  }
}

function stepProduction(ctx: FactoryCtx, state: FactoryState, dt: number): void {
  for (const n of state.nodes) {
    if (n.towerId) continue;
    const b = buildingOf(ctx, n);
    if (b.kind === "generator") continue;
    if (b.kind === "hub") {
      n.utilisation = 0;
      n.status = sum(n.inputs) >= b.bufferSize - EPS ? "backlogged" : "working";
      continue;
    }
    if (b.needsPower && !isPowered(ctx, state, n)) {
      n.utilisation = 0;
      n.status = "unpowered";
      continue;
    }
    const outSpace = Math.max(0, b.bufferSize - n.output);

    if (n.oreId && b.extractRate) {
      const max = b.extractRate * speedOf(state, b, n) * dt;
      const made = Math.min(max, outSpace);
      n.output += made;
      n.produced += made;
      n.utilisation = made / max;
      n.status = n.utilisation >= 1 - EPS ? "working" : "backlogged";
      continue;
    }

    const recipe = n.recipeId ? ctx.recipes.get(n.recipeId) : undefined;
    if (!recipe) {
      n.utilisation = 0;
      n.status = "idle";
      continue;
    }
    // fraction of one craft this tick, limited by time, inputs and output space
    const maxCrafts = (dt * speedOf(state, b, n)) / recipe.time;
    const outQty = recipe.outputs[0]!.qty;
    const byOutput = outSpace / outQty;
    const byInput = Math.min(...recipe.inputs.map((s) => (n.inputs[s.itemId] ?? 0) / s.qty));
    const crafts = Math.max(0, Math.min(maxCrafts, byOutput, byInput));
    for (const s of recipe.inputs) n.inputs[s.itemId] = clean((n.inputs[s.itemId] ?? 0) - s.qty * crafts);
    n.output += outQty * crafts;
    n.produced += outQty * crafts;
    n.utilisation = crafts / maxCrafts;
    // "starved" only when it's mostly waiting: a stage running at 80% behind a slower one is healthy
    n.status = n.utilisation >= 1 - EPS ? "working" : byOutput < byInput ? "backlogged" : n.utilisation >= STARVED_BELOW ? "working" : "starved";
  }
}

/**
 * Move items along links. Each link wants min(cap·dt, free space at its target). Where several links
 * draw on the same source item, or fill the same target buffer, they share it in proportion to demand.
 */
function stepTransport(ctx: FactoryCtx, state: FactoryState, dt: number): void {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const node = (id: number) => byId.get(id)!;
  const want = state.links.map((l) => {
    const cap = linkCap(ctx, state, l) * dt;
    return Math.min(cap, freeSpace(ctx, node(l.to), l.itemId));
  });

  const scaleGroups = (keyOf: (l: FactoryLink) => string, limitOf: (l: FactoryLink) => number) => {
    const groups = new Map<string, number[]>();
    state.links.forEach((l, i) => {
      const k = keyOf(l);
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    for (const idx of groups.values()) {
      const total = idx.reduce((a, i) => a + want[i]!, 0);
      const limit = limitOf(state.links[idx[0]!]!);
      if (total > limit + EPS) for (const i of idx) want[i] = (want[i]! * limit) / total;
    }
  };
  // sources: one pool per (node, item)
  scaleGroups((l) => `${l.from}:${l.itemId}`, (l) => available(ctx, node(l.from), l.itemId));
  // targets: hubs and tower magazines share one pool; other buildings one buffer per item
  const pooled = (n: FactoryNode) => !!n.towerId || buildingOf(ctx, n).kind === "hub";
  scaleGroups(
    (l) => (pooled(node(l.to)) ? `${l.to}` : `${l.to}:${l.itemId}`),
    (l) => freeSpace(ctx, node(l.to), l.itemId),
  );

  state.links.forEach((l, i) => {
    const qty = clean(want[i]!);
    take(ctx, node(l.from), l.itemId, qty);
    const to = node(l.to);
    to.inputs[l.itemId] = (to.inputs[l.itemId] ?? 0) + qty;
    l.flow = qty / dt;
  });
}

/** Advance the factory by dt seconds. Pure: returns a new state. */
export function stepFactory(state: FactoryState, ctx: FactoryCtx, dt: number): FactoryState {
  const next = structuredClone(state);
  stepPower(ctx, next, dt);
  stepProduction(ctx, next, dt);
  stepTransport(ctx, next, dt);
  return next;
}

/**
 * Factory graph (spec §4). Buildings are nodes, links are capped edges. Items are rates and buffers,
 * never individual entities: buffers hold fractional amounts and recipes run fractionally each tick.
 *
 * Tick order (deterministic, by id): power → production → transport.
 * All gameplay numbers come from content via FactoryCtx; nothing here is tuned by hand.
 */
import type { Content } from "../content/schema";
import type { Grid } from "./grid";

type Building = Content["buildings"][number];
type Recipe = Content["recipes"][number];
type Item = Content["items"][number];
type LinkTier = Content["linkTiers"][number];

/** float tolerance for "full", "empty" and "running flat out" */
export const EPS = 1e-9;

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
}

export const emptyFactory = (): FactoryState => ({ nextId: 1, nodes: [], links: [] });

/** Static lookups built once from content. */
export interface FactoryCtx {
  content: Content;
  grid: Grid;
  buildings: ReadonlyMap<string, Building>;
  recipes: ReadonlyMap<string, Recipe>;
  items: ReadonlyMap<string, Item>;
  tiers: ReadonlyMap<number, LinkTier>;
}

export function makeFactoryCtx(content: Content, grid: Grid): FactoryCtx {
  return {
    content,
    grid,
    buildings: new Map(content.buildings.map((b) => [b.id, b])),
    recipes: new Map(content.recipes.map((r) => [r.id, r])),
    items: new Map(content.items.map((i) => [i.id, i])),
    tiers: new Map(content.linkTiers.map((t) => [t.tier, t])),
  };
}

const sum = (rec: Record<string, number>): number => Object.values(rec).reduce((a, b) => a + b, 0);
const clean = (v: number): number => (v < EPS ? 0 : v);

export function buildingOf(ctx: FactoryCtx, node: FactoryNode): Building {
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
  if (buildingOf(ctx, node).kind === "hub") return node.inputs[itemId] ?? 0;
  return outputItem(ctx, node) === itemId ? node.output : 0;
}

function take(ctx: FactoryCtx, node: FactoryNode, itemId: string, qty: number): void {
  if (buildingOf(ctx, node).kind === "hub") node.inputs[itemId] = clean((node.inputs[itemId] ?? 0) - qty);
  else node.output = clean(node.output - qty);
}

/** Free input space for itemId. Hubs share one pool across items. */
function freeSpace(ctx: FactoryCtx, node: FactoryNode, itemId: string): number {
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
    const b = buildingOf(ctx, n);
    if (b.kind !== "generator" || !b.fuel) continue;
    const need = dt / b.fuel.secondsPerItem;
    const have = n.inputs[b.fuel.itemId] ?? 0;
    n.burning = have >= need - EPS;
    if (n.burning) n.inputs[b.fuel.itemId] = clean(have - need);
    n.utilisation = n.burning ? 1 : 0;
    n.status = n.burning ? "working" : "starved";
  }
}

function stepProduction(ctx: FactoryCtx, state: FactoryState, dt: number): void {
  for (const n of state.nodes) {
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
      const max = b.extractRate * b.speed * dt;
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
    const maxCrafts = (dt * b.speed) / recipe.time;
    const outQty = recipe.outputs[0]!.qty;
    const byOutput = outSpace / outQty;
    const byInput = Math.min(...recipe.inputs.map((s) => (n.inputs[s.itemId] ?? 0) / s.qty));
    const crafts = Math.max(0, Math.min(maxCrafts, byOutput, byInput));
    for (const s of recipe.inputs) n.inputs[s.itemId] = clean((n.inputs[s.itemId] ?? 0) - s.qty * crafts);
    n.output += outQty * crafts;
    n.produced += outQty * crafts;
    n.utilisation = crafts / maxCrafts;
    n.status = n.utilisation >= 1 - EPS ? "working" : byOutput < byInput ? "backlogged" : "starved";
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
    const cap = (ctx.tiers.get(l.tier)?.itemsPerSecond ?? 0) * dt;
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
  // targets: hubs share one pool; other buildings one buffer per item
  scaleGroups(
    (l) => (buildingOf(ctx, node(l.to)).kind === "hub" ? `${l.to}` : `${l.to}:${l.itemId}`),
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

// Harness UI logic that doesn't touch the DOM, so it can be unit-tested (tests/harness-ui.test.ts).
// Everything here only *proposes* commands; the sim validates and applies them (CLAUDE.md invariant 4).
import { buildingOf, outputItem, towerOf, type FactoryNode } from "../core/factory";
import { accepts, applyFactoryCommand, occupiedTiles } from "../core/factoryBuild";
import { spendable, type GameCtx, type GameInput, type GameState } from "../core/game";
import { canPlaceBuilding, canPlaceTower, linkLength, routeLink, type TileXY } from "../core/placement";

type Stack = { itemId: string; qty: number };

export interface BuildOption {
  label: string;
  cost: readonly Stack[];
  affordable: boolean;
  input: GameInput;
}

const itemName = (ctx: GameCtx, id: string) => ctx.factory.items.get(id)?.name ?? id;

export const costLabel = (ctx: GameCtx, cost: readonly Stack[]): string =>
  cost.length ? cost.map((c) => `${c.qty} ${itemName(ctx, c.itemId).toLowerCase()}`).join(", ") : "free";

const canAfford = (ctx: GameCtx, state: GameState, cost: readonly Stack[]) =>
  cost.every((c) => spendable(state, ctx, c.itemId) >= c.qty - 1e-9);

/** Labs arrive with research in M1.4; hidden until then. */
const HIDDEN_KINDS = new Set(["lab"]);

/**
 * What can be built on tile (x, y): valid placements only, research-locked things hidden.
 * Buildings with several recipes get one option per available recipe.
 */
export function buildOptions(ctx: GameCtx, state: GameState, x: number, y: number): BuildOption[] {
  const occupied = occupiedTiles(state.factory);
  const grid = ctx.factory.grid;
  const out: BuildOption[] = [];
  const add = (label: string, cost: readonly Stack[], input: GameInput) =>
    out.push({ label, cost, affordable: canAfford(ctx, state, cost), input });

  for (const t of ctx.factory.content.towers) {
    if (t.unlockedBy || !canPlaceTower(grid, x, y, occupied).ok) continue;
    add(t.name, t.buildCost, { type: "placeTower", towerId: t.id, x, y });
  }
  for (const b of ctx.factory.content.buildings) {
    if (HIDDEN_KINDS.has(b.kind) || !canPlaceBuilding(grid, b, x, y, occupied).ok) continue;
    if (b.kind === "processor" || b.kind === "assembler") {
      const recipes = ctx.factory.content.recipes.filter((r) => r.buildingId === b.id && !r.unlockedBy);
      for (const r of recipes) {
        const what = itemName(ctx, r.outputs[0]!.itemId).toLowerCase();
        add(recipes.length > 1 || b.kind === "assembler" ? `${b.name}: ${what}` : b.name, b.buildCost, { type: "place", buildingId: b.id, x, y, recipeId: r.id });
      }
    } else add(b.name, b.buildCost, { type: "place", buildingId: b.id, x, y });
  }
  return out;
}

export const nodeAt = (state: GameState, x: number, y: number): FactoryNode | undefined =>
  state.factory.nodes.find((n) => n.x === x && n.y === y);

/** Items a node takes on an input port (for choosing what a hub sends it). */
function wanted(ctx: GameCtx, node: FactoryNode): string[] {
  const tower = towerOf(ctx.factory, node);
  if (tower) return [...tower.ammo];
  const b = buildingOf(ctx.factory, node);
  if (b.kind === "generator") return b.fuel ? [b.fuel.itemId] : [];
  if (b.kind === "hub") return [...ctx.factory.items.keys()];
  const r = node.recipeId ? ctx.factory.recipes.get(node.recipeId) : undefined;
  return r ? r.inputs.map((s) => s.itemId) : [];
}

export type LinkProposal = { ok: true; input: GameInput & { type: "link" }; route: TileXY[] } | { ok: false; reason: string; route: TileXY[] };

/**
 * Turn a drag from one node to another into a link command, or a reason it can't be made.
 * Tier: the lowest tier whose length limit fits. Out of a hub: the item the target wants that the hub
 * holds most of (or the first it wants, if the hub holds none yet).
 */
export function proposeLink(ctx: GameCtx, state: GameState, from: FactoryNode, to: FactoryNode): LinkProposal {
  const straight = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  if (from.id === to.id) return { ok: false, reason: "same building", route: straight };
  const len = linkLength(from, to);
  const tier = [...ctx.factory.tiers.values()].sort((a, b) => a.tier - b.tier).find((t) => t.maxLength >= len);
  if (!tier) return { ok: false, reason: `too long (${len} tiles)`, route: straight };
  const route = routeLink(ctx.factory.grid, from, to, tier);
  const path = route.ok ? route.route : straight;

  let itemId: string | undefined;
  if (!from.towerId && buildingOf(ctx.factory, from).kind === "hub") {
    const options = wanted(ctx, to).filter((i) => accepts(ctx.factory, to, i));
    const held = options.filter((i) => (from.inputs[i] ?? 0) > 1e-9).sort((a, b) => (from.inputs[b] ?? 0) - (from.inputs[a] ?? 0));
    itemId = held[0] ?? (to.towerId || buildingOf(ctx.factory, to).kind !== "hub" ? options[0] : undefined);
    if (!itemId) return { ok: false, reason: "hub has nothing to send", route: path };
  } else if (!from.towerId && !outputItem(ctx.factory, from)) {
    return { ok: false, reason: `${buildingOf(ctx.factory, from).name.toLowerCase()} has no output`, route: path };
  }

  const input = { type: "link" as const, from: from.id, to: to.id, tier: tier.tier, ...(itemId ? { itemId } : {}) };
  const dry = applyFactoryCommand(state.factory, ctx.factory, input);
  return dry.error ? { ok: false, reason: dry.error, route: path } : { ok: true, input, route: path };
}

/** Display name for a node. */
export function nodeName(ctx: GameCtx, node: FactoryNode): string {
  const tower = towerOf(ctx.factory, node);
  if (tower) return tower.name;
  const b = buildingOf(ctx.factory, node);
  const r = node.recipeId ? ctx.factory.recipes.get(node.recipeId) : undefined;
  return b.kind === "assembler" && r ? `${b.name}: ${itemName(ctx, r.outputs[0]!.itemId).toLowerCase()}` : b.name;
}

/* ---------- inspect sheet (M1.3) ---------- */

export type Tone = "good" | "warn" | "bad";
export interface InspectLine { label: string; value: string; tone?: Tone }
export interface Inspection { title: string; lines: InspectLine[]; problem?: string }

const STATUS_TONE: Record<string, Tone> = { working: "good", backlogged: "warn", starved: "bad", unpowered: "bad", idle: "warn" };
const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

/**
 * The first thing upstream that's holding a node back, in plain words, or undefined if nothing is.
 * Walks links backwards (nearest first). Unpowered beats starved; for starved nodes the furthest
 * upstream one is the cause. A tower with a healthy chain that still runs dry needs more supply.
 */
export function upstreamProblem(ctx: GameCtx, state: GameState, node: FactoryNode): string | undefined {
  const byId = new Map(state.factory.nodes.map((n) => [n.id, n]));
  const inLinks = (id: number) => state.factory.links.filter((l) => l.to === id);
  if (!inLinks(node.id).length) {
    if (node.towerId) return "No ammo link: drag from an assembler or hub to this tower";
    const b = buildingOf(ctx.factory, node);
    return b.inputPorts > 0 && b.kind !== "hub" ? "Nothing feeds it: drag a link into it" : undefined;
  }
  const seen = new Set([node.id]);
  const upstream: FactoryNode[] = [];
  let frontier = [node.id];
  while (frontier.length) {
    const next: number[] = [];
    for (const id of frontier)
      for (const l of inLinks(id))
        if (!seen.has(l.from)) {
          seen.add(l.from);
          upstream.push(byId.get(l.from)!);
          next.push(l.from);
        }
    frontier = next;
  }
  const unpowered = upstream.filter((n) => n.status === "unpowered").reverse(); // furthest upstream first
  if (unpowered.length) {
    const names = unpowered.map((n) => nodeName(ctx, n));
    const who = names.length === 1 ? `${names[0]} is` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are`;
    return `${who} unpowered: build a generator within range and feed it coal`;
  }
  const starved = upstream.filter((n) => n.status === "starved").pop();
  if (starved) {
    const fed = inLinks(starved.id).length;
    return fed ? `${nodeName(ctx, starved)} is starved: it needs more input` : `${nodeName(ctx, starved)} has no input link`;
  }
  if (node.towerId && node.status === "starved") return "The chain runs flat out but can't keep up: add another chain";
  return undefined;
}

/** What the inspect sheet shows for a node. `firingRate` (shots/s) is measured by the harness. */
export function inspect(ctx: GameCtx, state: GameState, node: FactoryNode, firingRate?: number): Inspection {
  const lines: InspectLine[] = [{ label: "Status", value: node.status, tone: STATUS_TONE[node.status] }];
  const flowIn = state.factory.links.filter((l) => l.to === node.id);
  const flowOut = state.factory.links.filter((l) => l.from === node.id);
  const sum = (ls: typeof flowIn) => ls.reduce((a, l) => a + l.flow, 0);
  const tower = towerOf(ctx.factory, node);
  if (tower) {
    const mag = Object.values(node.inputs).reduce((a, v) => a + v, 0);
    lines.push({ label: "Magazine", value: `${Math.floor(mag + 1e-9)} / ${tower.magazine}`, tone: mag < 1 ? "bad" : mag < tower.magazine / 4 ? "warn" : "good" });
    lines.push({ label: "Stated fire rate", value: `${fmt(tower.fireRate)}/s` });
    if (firingRate !== undefined) lines.push({ label: "Firing (last 5 s)", value: `${fmt(firingRate)}/s` });
    lines.push({ label: "Ammo arriving", value: flowIn.length ? `${fmt(sum(flowIn))}/s${mag >= tower.magazine - 1e-6 ? " (full)" : ""}` : "none" });
    lines.push({ label: "Shots fired", value: String(node.shots ?? 0) });
  } else {
    const b = buildingOf(ctx.factory, node);
    if (b.kind !== "hub" && b.kind !== "generator") lines.push({ label: "Utilisation", value: `${Math.round(node.utilisation * 100)}%`, tone: STATUS_TONE[node.status] });
    for (const [item, qty] of Object.entries(node.inputs))
      if (qty > 1e-6 || b.kind !== "hub") lines.push({ label: `Holding ${itemName(ctx, item).toLowerCase()}`, value: `${fmt(qty)}${b.kind === "hub" ? "" : ` / ${b.bufferSize}`}` });
    const out = outputItem(ctx.factory, node);
    if (out) lines.push({ label: `Output ${itemName(ctx, out).toLowerCase()}`, value: `${fmt(node.output)} / ${b.bufferSize}` });
    if (flowIn.length) lines.push({ label: "In", value: `${fmt(sum(flowIn))}/s` });
    if (flowOut.length) lines.push({ label: "Out", value: `${fmt(sum(flowOut))}/s` });
    if (b.kind === "generator") lines.push({ label: "Powering", value: node.burning ? `yes, radius ${b.powerRadius}` : "no: needs coal" , tone: node.burning ? "good" : "bad" });
  }
  const problem = node.status === "working" && !tower ? undefined : upstreamProblem(ctx, state, node);
  return { title: nodeName(ctx, node), lines, problem };
}

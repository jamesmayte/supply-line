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

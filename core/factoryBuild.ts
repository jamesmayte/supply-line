/**
 * Player commands that change the factory graph. Validated against placement rules and content;
 * an invalid command returns the unchanged state plus a reason (never throws on bad input).
 */
import { tileAt, tileKey } from "./grid";
import { buildingOf, outputItem, towerOf, type FactoryCtx, type FactoryNode, type FactoryState } from "./factory";
import { canPlaceBuilding, canPlaceTower, routeLink } from "./placement";

/** Towers take ammo through one input port and have no outputs. */
const TOWER_INPUT_PORTS = 1;

export type FactoryCommand =
  | { type: "place"; buildingId: string; x: number; y: number; recipeId?: string }
  | { type: "placeTower"; towerId: string; x: number; y: number }
  | { type: "link"; from: number; to: number; tier?: number; itemId?: string }
  | { type: "unlink"; linkId: number }
  | { type: "remove"; nodeId: number }
  /** raise a building one upgrade tier (cost is paid by the game layer) */
  | { type: "upgrade"; nodeId: number }
  /** move a building or tower; its links re-route, and any that can't are dropped */
  | { type: "move"; nodeId: number; x: number; y: number };

export interface CommandResult {
  state: FactoryState;
  error?: string;
  /** id of the node or link created */
  id?: number;
  /** links removed as a side effect (a move that left them invalid) */
  dropped?: number[];
}

export function occupiedTiles(state: FactoryState): Set<string> {
  return new Set(state.nodes.map((n) => tileKey(n.x, n.y)));
}

/** Whether node accepts itemId on an input port. */
export function accepts(ctx: FactoryCtx, node: FactoryNode, itemId: string): boolean {
  const tower = towerOf(ctx, node);
  if (tower) return tower.ammo.includes(itemId);
  const b = buildingOf(ctx, node);
  switch (b.kind) {
    case "hub":
      return true;
    case "generator":
      return b.fuel?.itemId === itemId;
    case "lab":
      return ctx.items.get(itemId)?.kind === "science";
    case "extractor":
      return false;
    default: {
      const r = node.recipeId ? ctx.recipes.get(node.recipeId) : undefined;
      return !!r?.inputs.some((s) => s.itemId === itemId);
    }
  }
}

const inputPorts = (ctx: FactoryCtx, node: FactoryNode): number =>
  node.towerId ? TOWER_INPUT_PORTS : buildingOf(ctx, node).inputPorts;

export function applyFactoryCommand(state: FactoryState, ctx: FactoryCtx, cmd: FactoryCommand): CommandResult {
  const err = (error: string): CommandResult => ({ state, error });
  const next = structuredClone(state);

  switch (cmd.type) {
    case "place": {
      const b = ctx.buildings.get(cmd.buildingId);
      if (!b) return err(`unknown building '${cmd.buildingId}'`);
      const check = canPlaceBuilding(ctx.grid, b, cmd.x, cmd.y, occupiedTiles(state));
      if (!check.ok) return err(check.reason);

      let recipeId = cmd.recipeId;
      if (b.kind === "processor" || b.kind === "assembler") {
        const options = ctx.content.recipes.filter((r) => r.buildingId === b.id);
        if (!recipeId && options.length === 1) recipeId = options[0]!.id;
        if (!recipeId) return err(`${b.id} needs a recipe`);
        if (!options.some((r) => r.id === recipeId)) return err(`recipe '${recipeId}' doesn't run in ${b.id}`);
      } else if (recipeId) return err(`${b.id} takes no recipe`);

      const id = next.nextId++;
      const node: FactoryNode = {
        id,
        buildingId: b.id,
        x: cmd.x,
        y: cmd.y,
        inputs: {},
        output: 0,
        burning: false,
        utilisation: 0,
        status: "idle",
        produced: 0,
      };
      if (recipeId) node.recipeId = recipeId;
      const oreId = b.kind === "extractor" ? tileAt(ctx.grid, cmd.x, cmd.y)?.oreId : undefined;
      if (oreId) node.oreId = oreId;
      next.nodes.push(node);
      return { state: next, id };
    }

    case "placeTower": {
      const t = ctx.towers.get(cmd.towerId);
      if (!t) return err(`unknown tower '${cmd.towerId}'`);
      const check = canPlaceTower(ctx.grid, cmd.x, cmd.y, occupiedTiles(state));
      if (!check.ok) return err(check.reason);
      const id = next.nextId++;
      next.nodes.push({
        id,
        buildingId: t.id,
        towerId: t.id,
        x: cmd.x,
        y: cmd.y,
        inputs: {}, // magazine: starts empty, filled only by links
        output: 0,
        burning: false,
        utilisation: 0,
        status: "idle",
        produced: 0,
        cooldown: 0,
        shots: 0,
      });
      return { state: next, id };
    }

    case "link": {
      const from = state.nodes.find((n) => n.id === cmd.from);
      const to = state.nodes.find((n) => n.id === cmd.to);
      if (!from || !to) return err("unknown node");
      if (from.id === to.id) return err("can't link a building to itself");
      const tier = ctx.tiers.get(cmd.tier ?? 1);
      if (!tier) return err(`unknown link tier ${cmd.tier}`);
      if (from.towerId) return err("towers have no output");

      const fromB = buildingOf(ctx, from);
      const itemId = fromB.kind === "hub" ? cmd.itemId : outputItem(ctx, from);
      if (!itemId) return err(fromB.kind === "hub" ? "links out of a hub need an item" : `${fromB.id} has no output`);
      if (cmd.itemId && cmd.itemId !== itemId) return err(`${fromB.id} outputs ${itemId}, not ${cmd.itemId}`);
      if (!accepts(ctx, to, itemId)) return err(`${to.buildingId} doesn't accept ${itemId}`);

      const outs = state.links.filter((l) => l.from === from.id).length;
      const ins = state.links.filter((l) => l.to === to.id).length;
      if (outs >= fromB.outputPorts) return err(`${fromB.id} has no free output port`);
      if (ins >= inputPorts(ctx, to)) return err(`${to.buildingId} has no free input port`);
      if (state.links.some((l) => l.from === from.id && l.to === to.id && l.itemId === itemId)) return err("already linked");

      const route = routeLink(ctx.grid, from, to, tier);
      if (!route.ok) return err(route.reason);

      const id = next.nextId++;
      next.links.push({ id, from: from.id, to: to.id, itemId, tier: tier.tier, length: route.route.length - 1, flow: 0 });
      return { state: next, id };
    }

    case "unlink": {
      if (!state.links.some((l) => l.id === cmd.linkId)) return err("unknown link");
      next.links = next.links.filter((l) => l.id !== cmd.linkId);
      return { state: next };
    }

    case "upgrade": {
      const node = next.nodes.find((n) => n.id === cmd.nodeId);
      if (!node) return err("unknown node");
      if (node.towerId) return err("towers can't be upgraded yet");
      const b = buildingOf(ctx, node);
      const lvl = node.level ?? 1;
      if (lvl - 1 >= b.upgrades.length) return err(`${b.name.toLowerCase()} is at its top tier`);
      node.level = lvl + 1;
      return { state: next };
    }

    case "move": {
      const node = next.nodes.find((n) => n.id === cmd.nodeId);
      if (!node) return err("unknown node");
      if (node.x === cmd.x && node.y === cmd.y) return err("already there");
      const occupied = occupiedTiles(state);
      occupied.delete(tileKey(node.x, node.y));
      const check = node.towerId
        ? canPlaceTower(ctx.grid, cmd.x, cmd.y, occupied)
        : canPlaceBuilding(ctx.grid, buildingOf(ctx, node), cmd.x, cmd.y, occupied);
      if (!check.ok) return err(check.reason);
      node.x = cmd.x;
      node.y = cmd.y;
      if (!node.towerId && buildingOf(ctx, node).kind === "extractor") {
        const ore = tileAt(ctx.grid, cmd.x, cmd.y)?.oreId;
        if (ore !== node.oreId) node.output = 0; // different ore: old buffer is meaningless
        if (ore) node.oreId = ore;
      }
      // keep links that still route and still carry what both ends make/accept
      const byId = new Map(next.nodes.map((n) => [n.id, n]));
      const dropped: number[] = [];
      next.links = next.links.filter((l) => {
        if (l.from !== node.id && l.to !== node.id) return true;
        const from = byId.get(l.from)!, to = byId.get(l.to)!;
        const tier = ctx.tiers.get(l.tier)!;
        const fromHub = !from.towerId && buildingOf(ctx, from).kind === "hub";
        const carries = fromHub ? l.itemId : outputItem(ctx, from);
        const route = routeLink(ctx.grid, from, to, tier);
        if (route.ok && carries === l.itemId && accepts(ctx, to, l.itemId)) {
          l.length = route.route.length - 1;
          return true;
        }
        dropped.push(l.id);
        return false;
      });
      return { state: next, ...(dropped.length ? { dropped } : {}) };
    }

    case "remove": {
      if (!state.nodes.some((n) => n.id === cmd.nodeId)) return err("unknown node");
      next.nodes = next.nodes.filter((n) => n.id !== cmd.nodeId);
      next.links = next.links.filter((l) => l.from !== cmd.nodeId && l.to !== cmd.nodeId);
      return { state: next };
    }
  }
}

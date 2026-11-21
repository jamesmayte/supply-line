/**
 * The whole sim: factory + towers + enemies + waves, advanced by one entry point,
 *   step(state, input, dt, ctx) -> state      (CLAUDE.md invariant 1; ctx is static content lookups)
 * Pure and deterministic: no I/O, no Math.random, plain-JSON state, seeded RNG carried in the state.
 *
 * Tick order:
 *   1. player commands (factory commands any time; startWave only in the build break).
 *      Placing pays the content buildCost: from the stockpile first, then from hubs (lowest id first).
 *   2. spawn due enemies, advance wave clock
 *   3. move enemies along the path; any that reach the core damage it and leave
 *   4. factory (refills magazines)
 *   5. towers fire: first-along-path enemy in range, instant hit, retarget each shot
 *   6. remove the dead, then check win/lose/wave end
 */
import type { Content } from "../content/schema";
import { emptyFactory, makeFactoryCtx, type FactoryCtx, type FactoryNode, type FactoryState, stepFactory } from "./factory";
import { applyFactoryCommand, type FactoryCommand } from "./factoryBuild";
import { buildGrid } from "./grid";
import { buildPath, positionAt, tileCentre, type Path, type Point } from "./path";
import type { RngState } from "./rng";
import { stepTowers, type FireFn } from "./towers";

type EnemyDef = Content["enemies"][number];
type Ammo = Content["ammo"][number];
type Tower = Content["towers"][number];
type Wave = Content["maps"][number]["waves"][number];
type Stack = Content["buildings"][number]["buildCost"][number];

export interface Enemy {
  id: number;
  enemyId: string;
  hp: number;
  /** distance along the path, tiles */
  d: number;
}

export interface WaveState {
  /** seconds since the wave started */
  time: number;
  /** enemies spawned so far, per group */
  spawned: number[];
}

export type Phase = "build" | "wave" | "won" | "lost";

export interface GameState {
  tick: number;
  seed: number;
  rng: RngState;
  phase: Phase;
  /** index into map.waves of the wave in progress, or the next one during a build break */
  waveIndex: number;
  wave: WaveState | null;
  coreHp: number;
  /** stockpile for build costs, item → qty (starts as the map's startingStock) */
  stock: Record<string, number>;
  enemies: Enemy[];
  nextEnemyId: number;
  factory: FactoryState;
  /** cumulative */
  kills: number;
  leaked: number;
  damageDealt: number;
  /** commands rejected on the last tick, for the UI */
  errors: string[];
}

export type GameInput = FactoryCommand | { type: "startWave" };

export interface GameCtx {
  factory: FactoryCtx;
  path: Path;
  waves: readonly Wave[];
  enemies: ReadonlyMap<string, EnemyDef>;
  ammo: ReadonlyMap<string, Ammo>;
}

export function makeGameCtx(content: Content, mapId: string): GameCtx {
  const map = content.maps.find((m) => m.id === mapId);
  if (!map) throw new Error(`unknown map '${mapId}'`);
  return {
    factory: makeFactoryCtx(content, buildGrid(map)),
    path: buildPath(map),
    waves: map.waves,
    enemies: new Map(content.enemies.map((e) => [e.id, e])),
    ammo: new Map(content.ammo.map((a) => [a.itemId, a])),
  };
}

export function newGame(content: Content, mapId: string, seed: number): GameState {
  const map = content.maps.find((m) => m.id === mapId);
  if (!map) throw new Error(`unknown map '${mapId}'`);
  return {
    tick: 0,
    seed,
    rng: seed | 0,
    phase: "build",
    waveIndex: 0,
    wave: null,
    coreHp: map.coreHp,
    stock: Object.fromEntries(map.startingStock.map((st) => [st.itemId, st.qty])),
    enemies: [],
    nextEnemyId: 1,
    factory: emptyFactory(),
    kills: 0,
    leaked: 0,
    damageDealt: 0,
    errors: [],
  };
}

const enemyDef = (ctx: GameCtx, e: Enemy): EnemyDef => {
  const def = ctx.enemies.get(e.enemyId);
  if (!def) throw new Error(`unknown enemy '${e.enemyId}'`);
  return def;
};

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Damage one round does to one enemy: tower damage × ammo multiplier, cut by armour unless armour-piercing. */
export function shotDamage(tower: Tower, ammo: Ammo | undefined, enemy: EnemyDef): number {
  const base = tower.damage * (ammo?.damageMultiplier ?? 1);
  return ammo?.armourPiercing ? base : base * (1 - enemy.armour);
}

function canHit(tower: Tower, enemy: EnemyDef): boolean {
  if (tower.airOnly) return enemy.flying;
  return !enemy.flying || tower.hitsAir;
}

/** Targeting: the live enemy furthest along the path within range; ties go to the lower id. */
export function pickTarget(ctx: GameCtx, enemies: readonly Enemy[], node: FactoryNode, tower: Tower): Enemy | undefined {
  const at = tileCentre(node.x, node.y);
  let best: Enemy | undefined;
  for (const e of enemies) {
    if (e.hp <= 0 || !canHit(tower, enemyDef(ctx, e))) continue;
    if (dist(at, positionAt(ctx.path, e.d)) > tower.range) continue;
    if (!best || e.d > best.d || (e.d === best.d && e.id < best.id)) best = e;
  }
  return best;
}

/* ---------- economy ---------- */

/** What a command costs to carry out (empty if free). */
export function costOf(ctx: GameCtx, input: GameInput): readonly Stack[] {
  if (input.type === "place") return ctx.factory.buildings.get(input.buildingId)?.buildCost ?? [];
  if (input.type === "placeTower") return ctx.factory.towers.get(input.towerId)?.buildCost ?? [];
  return [];
}

const hubsOf = (state: GameState, ctx: GameCtx): FactoryNode[] =>
  state.factory.nodes.filter((n) => !n.towerId && ctx.factory.buildings.get(n.buildingId)?.kind === "hub");

/** Items available to spend on building: stockpile + everything held in hubs. */
export function spendable(state: GameState, ctx: GameCtx, itemId: string): number {
  return (state.stock[itemId] ?? 0) + hubsOf(state, ctx).reduce((a, h) => a + (h.inputs[itemId] ?? 0), 0);
}

function shortfall(state: GameState, ctx: GameCtx, cost: readonly Stack[]): string | undefined {
  for (const c of cost) {
    const have = spendable(state, ctx, c.itemId);
    if (have < c.qty - 1e-9) return `can't afford: needs ${c.qty} ${c.itemId}, have ${Math.floor(have + 1e-9)}`;
  }
  return undefined;
}

/** Pay a cost: stockpile first, then hubs in id order. Caller has checked it's affordable. */
function pay(state: GameState, ctx: GameCtx, cost: readonly Stack[]): void {
  for (const c of cost) {
    let owed = c.qty;
    const fromStock = Math.min(owed, state.stock[c.itemId] ?? 0);
    state.stock[c.itemId] = (state.stock[c.itemId] ?? 0) - fromStock;
    owed -= fromStock;
    for (const h of hubsOf(state, ctx)) {
      if (owed <= 1e-9) break;
      const take = Math.min(owed, h.inputs[c.itemId] ?? 0);
      h.inputs[c.itemId] = (h.inputs[c.itemId] ?? 0) - take;
      if (h.inputs[c.itemId]! < 1e-9) h.inputs[c.itemId] = 0;
      owed -= take;
    }
  }
}

function applyInput(state: GameState, ctx: GameCtx, input: GameInput): string | undefined {
  if (input.type === "startWave") {
    if (state.phase !== "build") return `can't start a wave during '${state.phase}'`;
    state.phase = "wave";
    state.wave = { time: 0, spawned: ctx.waves[state.waveIndex]!.groups.map(() => 0) };
    return undefined;
  }
  if (state.phase === "won" || state.phase === "lost") return "run is over";
  const r = applyFactoryCommand(state.factory, ctx.factory, input);
  if (r.error) return r.error;
  const cost = costOf(ctx, input);
  const short = shortfall(state, ctx, cost); // checked against hubs before the new node exists
  if (short) return short;
  state.factory = r.state;
  pay(state, ctx, cost);
  return undefined;
}

function spawn(state: GameState, ctx: GameCtx, dt: number): void {
  if (state.phase !== "wave" || !state.wave) return;
  const wave = ctx.waves[state.waveIndex]!;
  wave.groups.forEach((g, i) => {
    while (state.wave!.spawned[i]! < g.count && state.wave!.time >= g.delay + state.wave!.spawned[i]! * g.spacing - 1e-9) {
      const def = ctx.enemies.get(g.enemyId)!;
      state.enemies.push({ id: state.nextEnemyId++, enemyId: g.enemyId, hp: def.hp, d: 0 });
      state.wave!.spawned[i]!++;
    }
  });
  state.wave.time += dt;
}

function moveEnemies(state: GameState, ctx: GameCtx, dt: number): void {
  const stay: Enemy[] = [];
  for (const e of state.enemies) {
    const def = enemyDef(ctx, e);
    e.d += def.speed * dt;
    if (e.d >= ctx.path.length) {
      state.coreHp = Math.max(0, state.coreHp - def.coreDamage);
      state.leaked++;
    } else stay.push(e);
  }
  state.enemies = stay;
}

function fireTowers(state: GameState, ctx: GameCtx, dt: number): void {
  const fire: FireFn = (node, tower, ammoId) => {
    const target = pickTarget(ctx, state.enemies, node, tower);
    if (!target) return false;
    const ammo = ctx.ammo.get(ammoId);
    const hit = (e: Enemy) => {
      const dmg = Math.min(e.hp, shotDamage(tower, ammo, enemyDef(ctx, e)));
      e.hp -= dmg;
      state.damageDealt += dmg;
    };
    hit(target);
    if (tower.splash > 0) {
      const at = positionAt(ctx.path, target.d);
      for (const e of state.enemies)
        if (e !== target && e.hp > 0 && canHit(tower, enemyDef(ctx, e)) && dist(at, positionAt(ctx.path, e.d)) <= tower.splash) hit(e);
    }
    return true;
  };
  state.factory = stepTowers(state.factory, ctx.factory, dt, fire);
}

function settle(state: GameState, ctx: GameCtx): void {
  const alive = state.enemies.filter((e) => e.hp > 1e-9);
  state.kills += state.enemies.length - alive.length;
  state.enemies = alive;
  if (state.coreHp <= 0) {
    state.phase = "lost";
    return;
  }
  if (state.phase !== "wave" || !state.wave) return;
  const wave = ctx.waves[state.waveIndex]!;
  const allSpawned = wave.groups.every((g, i) => state.wave!.spawned[i]! >= g.count);
  if (allSpawned && state.enemies.length === 0) {
    state.wave = null;
    state.waveIndex++;
    state.phase = state.waveIndex >= ctx.waves.length ? "won" : "build";
  }
}

/** Advance the whole game by one tick of dt seconds. Pure: returns a new state. */
export function step(state: GameState, input: readonly GameInput[], dt: number, ctx: GameCtx): GameState {
  const next = structuredClone(state);
  next.errors = [];
  for (const cmd of input) {
    const err = applyInput(next, ctx, cmd);
    if (err) next.errors.push(`${cmd.type}: ${err}`);
  }
  if (next.phase === "won" || next.phase === "lost") return next;
  spawn(next, ctx, dt);
  moveEnemies(next, ctx, dt);
  next.factory = stepFactory(next.factory, ctx.factory, dt);
  fireTowers(next, ctx, dt);
  settle(next, ctx);
  next.tick++;
  return next;
}

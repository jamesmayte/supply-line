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
import { buildingOf, emptyFactory, isPowered, makeFactoryCtx, type FactoryCtx, type FactoryNode, type FactoryState, stepFactory } from "./factory";
import { applyFactoryCommand, type FactoryCommand } from "./factoryBuild";
import { buildGrid } from "./grid";
import { buildPath, positionAt, tileCentre, type Path, type Point } from "./path";
import { nextRandom, type RngState } from "./rng";
import { stepTowers, type FireFn } from "./towers";

type EnemyDef = Content["enemies"][number];
type Ammo = Content["ammo"][number];
type Tower = Content["towers"][number];
type Wave = Content["maps"][number]["waves"][number];
type Card = Content["cards"][number];
type Rules = Content["rules"];
type ResearchNode = Content["research"][number];
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
  /** seconds since the current build break began (drives the early-start bonus) */
  breakTime: number;
  /** cards offered after the last wave; must pick one before the next wave. null = no pick pending */
  cardOffer: string[] | null;
  /** cards picked so far, in order */
  cards: string[];
  /** free upgrades from cards, used before paying */
  upgradeTokens: number;
  /** in-run research (spec §7.1) */
  research: ResearchState;
  /** links dropped by the last tick's moves (for the UI) */
  dropped: number[];
}

export interface ResearchState {
  /** node being researched now, or null */
  active: string | null;
  /** fraction done per node (kept if you switch away) */
  progress: Record<string, number>;
  /** finished nodes, in order */
  done: string[];
  /** nodes finished on the last tick (for the UI) */
  justDone: string[];
}

export type GameInput =
  | FactoryCommand
  | { type: "startWave" }
  | { type: "pickCard"; cardId: string }
  /** choose what the labs research (switching keeps progress on the old node) */
  | { type: "research"; nodeId: string };

export interface GameCtx {
  factory: FactoryCtx;
  path: Path;
  waves: readonly Wave[];
  enemies: ReadonlyMap<string, EnemyDef>;
  ammo: ReadonlyMap<string, Ammo>;
  cards: ReadonlyMap<string, Card>;
  rules: Rules;
  research: ReadonlyMap<string, ResearchNode>;
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
    cards: new Map(content.cards.map((c) => [c.id, c])),
    rules: content.rules,
    research: new Map(content.research.map((r) => [r.id, r])),
  };
}

/** `allResearched` = Sandbox: every research node already done (for playtesting the full toolset). */
export function newGame(content: Content, mapId: string, seed: number, opts: { allResearched?: boolean } = {}): GameState {
  const map = content.maps.find((m) => m.id === mapId);
  if (!map) throw new Error(`unknown map '${mapId}'`);
  const state: GameState = {
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
    breakTime: 0,
    cardOffer: null,
    cards: [],
    upgradeTokens: 0,
    research: { active: null, progress: {}, done: [], justDone: [] },
    dropped: [],
  };
  if (opts.allResearched) for (const r of content.research) completeResearch(state, r);
  return state;
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
export function costOf(ctx: GameCtx, input: GameInput, state?: GameState): readonly Stack[] {
  if (input.type === "place") return ctx.factory.buildings.get(input.buildingId)?.buildCost ?? [];
  if (input.type === "placeTower") return ctx.factory.towers.get(input.towerId)?.buildCost ?? [];
  if (input.type === "upgrade" && state) {
    const node = state.factory.nodes.find((n) => n.id === input.nodeId);
    return node ? upgradeCost(ctx, node) : [];
  }
  return [];
}

/** Cost of a node's next upgrade (empty if none left or it's a tower). */
export function upgradeCost(ctx: GameCtx, node: FactoryNode): readonly Stack[] {
  if (node.towerId) return [];
  const b = ctx.factory.buildings.get(node.buildingId);
  return b?.upgrades[(node.level ?? 1) - 1]?.cost ?? [];
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

/* ---------- run loop: cards, early start, refunds ---------- */

/** Bonus for starting the next wave now: linear from maxBonus at the break's start to 0 at the window. */
export function earlyStartBonus(state: GameState, ctx: GameCtx): { itemId: string; qty: number } {
  const { windowSeconds, maxBonus } = ctx.rules.earlyStart;
  const qty = state.waveIndex === 0 ? 0 : Math.round(maxBonus.qty * Math.max(0, 1 - state.breakTime / windowSeconds));
  return { itemId: maxBonus.itemId, qty };
}

/** Draw `cardsOffered` distinct cards with the seeded RNG (partial Fisher–Yates over content order). */
function drawOffer(state: GameState, ctx: GameCtx): string[] {
  const pool = [...ctx.cards.keys()];
  const n = Math.min(ctx.rules.cardsOffered, pool.length);
  for (let i = 0; i < n; i++) {
    const r = nextRandom(state.rng);
    state.rng = r.state;
    const j = i + Math.floor(r.value * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

function applyCard(state: GameState, card: Card): void {
  const e = card.effect;
  if (e.type === "grant") for (const it of e.items) state.stock[it.itemId] = (state.stock[it.itemId] ?? 0) + it.qty;
  else if (e.type === "speed") {
    const mult = (state.factory.speedMult ??= {});
    for (const b of e.buildingIds) mult[b] = (mult[b] ?? 1) * e.multiplier;
  } else if (e.type === "linkTier") state.factory.linkBonus = (state.factory.linkBonus ?? 0) + e.delta;
  else state.upgradeTokens += e.count;
}

/** What removing a node gives back right now (fraction of its build cost by phase). */
export function refundOf(state: GameState, ctx: GameCtx, node: FactoryNode): Stack[] {
  const b = node.towerId ? undefined : ctx.factory.buildings.get(node.buildingId);
  const base = node.towerId ? ctx.factory.towers.get(node.towerId)?.buildCost ?? [] : b?.buildCost ?? [];
  // upgrades count as spent too (free ones included: simplest rule, and tokens are rare)
  const upgrades = b ? b.upgrades.slice(0, (node.level ?? 1) - 1).flatMap((u) => u.cost) : [];
  const frac = state.phase === "wave" ? ctx.rules.refund.wave : ctx.rules.refund.buildBreak;
  const total = new Map<string, number>();
  for (const c of [...base, ...upgrades]) total.set(c.itemId, (total.get(c.itemId) ?? 0) + c.qty);
  return [...total].map(([itemId, qty]) => ({ itemId, qty: qty * frac })).filter((c) => c.qty > 0);
}

/** Stars for a finished run: 0 if lost, else by core HP fraction left (content rules). */
export function starsFor(state: GameState, ctx: GameCtx, maxCoreHp: number): number {
  if (state.phase !== "won") return 0;
  const f = state.coreHp / maxCoreHp;
  return f >= ctx.rules.stars.three ? 3 : f >= ctx.rules.stars.two ? 2 : 1;
}

/* ---------- research ---------- */

export const isResearched = (state: GameState, id?: string): boolean => !id || state.research.done.includes(id);

/** The research node a command still needs, if any (recipes, towers and link tiers can be locked). */
export function lockedBy(state: GameState, ctx: GameCtx, input: GameInput): string | undefined {
  if (input.type === "placeTower") {
    const t = ctx.factory.towers.get(input.towerId);
    return t && !isResearched(state, t.unlockedBy) ? t.unlockedBy : undefined;
  }
  if (input.type === "place") {
    const options = ctx.factory.content.recipes.filter((r) => r.buildingId === input.buildingId);
    const recipe = input.recipeId ? ctx.factory.recipes.get(input.recipeId) : options.length === 1 ? options[0] : undefined;
    return recipe && !isResearched(state, recipe.unlockedBy) ? recipe.unlockedBy : undefined;
  }
  if (input.type === "link") {
    const tier = ctx.factory.tiers.get(input.tier ?? 1);
    return tier && !isResearched(state, tier.unlockedBy) ? tier.unlockedBy : undefined;
  }
  return undefined;
}

function completeResearch(state: GameState, node: ResearchNode): void {
  if (state.research.done.includes(node.id)) return;
  state.research.done.push(node.id);
  state.research.progress[node.id] = 1;
  if (state.research.active === node.id) state.research.active = null;
  for (const e of node.effects) if (e.type === "fuelUse") state.factory.fuelUse = (state.factory.fuelUse ?? 1) * e.multiplier;
}

/**
 * Labs work on the active node: each powered lab (up to rules.maxLabs, by id) holding enough packs for this
 * tick adds dt/time of progress and uses cost × dt/time packs. Runs during waves too.
 */
function stepResearch(state: GameState, ctx: GameCtx, dt: number): void {
  state.research.justDone = [];
  const labs = state.factory.nodes.filter((n) => !n.towerId && buildingOf(ctx.factory, n).kind === "lab");
  const node = state.research.active ? ctx.research.get(state.research.active) : undefined;
  let working = 0;
  for (const lab of labs) {
    lab.utilisation = 0;
    if (!node) {
      lab.status = "idle";
      continue;
    }
    if (!isPowered(ctx.factory, state.factory, lab)) {
      lab.status = "unpowered";
      continue;
    }
    if (working >= ctx.rules.maxLabs) {
      lab.status = "idle";
      continue;
    }
    const share = dt / node.time;
    const enough = node.cost.every((c) => (lab.inputs[c.itemId] ?? 0) >= c.qty * share - 1e-9);
    if (!enough) {
      lab.status = "starved";
      continue;
    }
    for (const c of node.cost) lab.inputs[c.itemId] = Math.max(0, (lab.inputs[c.itemId] ?? 0) - c.qty * share);
    lab.status = "working";
    lab.utilisation = 1;
    lab.produced += share;
    working++;
  }
  if (!node || !working) return;
  const p = (state.research.progress[node.id] ?? 0) + (working * dt) / node.time;
  state.research.progress[node.id] = Math.min(1, p);
  if (p >= 1 - 1e-9) {
    completeResearch(state, node);
    state.research.justDone.push(node.id);
  }
}

function applyInput(state: GameState, ctx: GameCtx, input: GameInput): string | undefined {
  if (input.type === "startWave") {
    if (state.phase !== "build") return `can't start a wave during '${state.phase}'`;
    if (state.cardOffer) return "pick a card first";
    const bonus = earlyStartBonus(state, ctx);
    if (bonus.qty > 0) state.stock[bonus.itemId] = (state.stock[bonus.itemId] ?? 0) + bonus.qty;
    state.phase = "wave";
    state.wave = { time: 0, spawned: ctx.waves[state.waveIndex]!.groups.map(() => 0) };
    return undefined;
  }
  if (input.type === "pickCard") {
    if (!state.cardOffer) return "no card to pick";
    if (!state.cardOffer.includes(input.cardId)) return `card '${input.cardId}' isn't on offer`;
    applyCard(state, ctx.cards.get(input.cardId)!);
    state.cards.push(input.cardId);
    state.cardOffer = null;
    return undefined;
  }
  if (state.phase === "won" || state.phase === "lost") return "run is over";
  if (input.type === "research") {
    const node = ctx.research.get(input.nodeId);
    if (!node) return `unknown research '${input.nodeId}'`;
    if (state.research.done.includes(node.id)) return `${node.name} is already researched`;
    const missing = node.requires.filter((r) => !state.research.done.includes(r));
    if (missing.length) return `needs ${missing.map((r) => ctx.research.get(r)?.name ?? r).join(", ")} first`;
    state.research.active = node.id;
    return undefined;
  }
  const locked = lockedBy(state, ctx, input);
  if (locked) return `needs research: ${ctx.research.get(locked)?.name ?? locked}`;
  if (input.type === "remove") {
    const node = state.factory.nodes.find((n) => n.id === input.nodeId);
    const r = applyFactoryCommand(state.factory, ctx.factory, input);
    if (r.error || !node) return r.error ?? "unknown node";
    for (const c of refundOf(state, ctx, node)) state.stock[c.itemId] = (state.stock[c.itemId] ?? 0) + c.qty;
    state.factory = r.state;
    return undefined;
  }
  if (input.type === "move" && state.phase === "wave") return "can't move during a wave";
  if (input.type === "upgrade" && state.upgradeTokens > 0) {
    const r = applyFactoryCommand(state.factory, ctx.factory, input);
    if (r.error) return r.error;
    state.factory = r.state;
    state.upgradeTokens--;
    return undefined;
  }
  const cost = costOf(ctx, input, state); // before the command: an upgrade's cost depends on the current tier
  const r = applyFactoryCommand(state.factory, ctx.factory, input);
  if (r.error) return r.error;
  const short = shortfall(state, ctx, cost); // checked against hubs before the new node exists
  if (short) return short;
  state.factory = r.state;
  pay(state, ctx, cost);
  if (r.dropped) state.dropped.push(...r.dropped);
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
    if (state.phase === "build") {
      state.breakTime = 0;
      if (ctx.cards.size) state.cardOffer = drawOffer(state, ctx);
    }
  }
}

function applyAll(next: GameState, ctx: GameCtx, input: readonly GameInput[]): void {
  next.errors = [];
  next.dropped = [];
  for (const cmd of input) {
    const err = applyInput(next, ctx, cmd);
    if (err) next.errors.push(`${cmd.type}: ${err}`);
  }
}

/**
 * Apply player commands without advancing time (phase 1 of step only). Used to build while paused.
 * Pure: returns a new state. step(s, input, dt) ≡ simulating dt after applyCommands(s, input).
 */
export function applyCommands(state: GameState, input: readonly GameInput[], ctx: GameCtx): GameState {
  const next = structuredClone(state);
  applyAll(next, ctx, input);
  return next;
}

/** Advance the whole game by one tick of dt seconds. Pure: returns a new state. */
export function step(state: GameState, input: readonly GameInput[], dt: number, ctx: GameCtx): GameState {
  const next = structuredClone(state);
  applyAll(next, ctx, input);
  if (next.phase === "won" || next.phase === "lost") return next;
  if (next.phase === "build") next.breakTime += dt;
  spawn(next, ctx, dt);
  moveEnemies(next, ctx, dt);
  next.factory = stepFactory(next.factory, ctx.factory, dt);
  stepResearch(next, ctx, dt);
  fireTowers(next, ctx, dt);
  settle(next, ctx);
  next.tick++;
  return next;
}

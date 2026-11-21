/**
 * Towers and ammo (spec §5). The core pillar lives here:
 *   effective fire rate = min(stated fire rate, ammo supply rate).
 * A tower's magazine is its input buffer, refilled by factory links (core/factory.ts transport).
 * It fires one whole round per shot when its cooldown is up; with no round in the magazine it can't fire.
 * Nothing here boosts a tower without ammo: supply is the only way to reach the stated rate.
 *
 * Targeting and damage live in core/game.ts, which passes a `fire` callback; this file only decides
 * when a tower may shoot and spends the round.
 */
import type { Content } from "../content/schema";
import { EPS, towerOf, type FactoryCtx, type FactoryNode, type FactoryState } from "./factory";

type Tower = Content["towers"][number];

/**
 * Called once per shot a tower is ready and loaded to fire. Returns true if it hit something (the round
 * is spent), false if there was no target (the round is kept and the tower waits).
 */
export type FireFn = (node: FactoryNode, tower: Tower, ammoId: string) => boolean;
const alwaysHit: FireFn = () => true;

const clean = (v: number): number => (v < EPS ? 0 : v);

/** The ammo item a tower will fire next: first of its ammo list with a whole round loaded. */
export function loadedAmmo(ctx: FactoryCtx, node: FactoryNode): string | undefined {
  return towerOf(ctx, node)?.ammo.find((a) => (node.inputs[a] ?? 0) >= 1 - EPS);
}

/** Rounds in the magazine (fractional while a round is still arriving). */
export function magazineCount(node: FactoryNode): number {
  return Object.values(node.inputs).reduce((a, b) => a + b, 0);
}

/**
 * Advance every tower by dt seconds. Pure: returns a new state (fire may mutate the caller's own state).
 * fire omitted = every shot hits (a tower with a target always in range).
 * Shots can't be banked: an idle or empty tower's cooldown stops at 0.
 * Status: working (fired or loaded and waiting) · starved (magazine empty) · idle (loaded, nothing to shoot).
 */
export function stepTowers(state: FactoryState, ctx: FactoryCtx, dt: number, fire: FireFn = alwaysHit): FactoryState {
  const next = structuredClone(state);
  for (const n of next.nodes) {
    const tower = towerOf(ctx, n);
    if (!tower) continue;
    let cooldown = (n.cooldown ?? 0) - dt;
    let fired = 0;
    let noTarget = false;
    while (cooldown <= EPS) {
      const ammo = loadedAmmo(ctx, n);
      if (!ammo) break;
      if (!fire(n, tower, ammo)) {
        noTarget = true;
        break;
      }
      n.inputs[ammo] = clean(n.inputs[ammo]! - 1);
      fired++;
      cooldown += 1 / tower.fireRate;
    }
    n.cooldown = Math.max(0, cooldown);
    n.shots = (n.shots ?? 0) + fired;
    n.status = fired > 0 ? "working" : !loadedAmmo(ctx, n) ? "starved" : noTarget ? "idle" : "working";
  }
  return next;
}

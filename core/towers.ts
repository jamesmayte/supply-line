/**
 * Towers and ammo (spec §5). The core pillar lives here:
 *   effective fire rate = min(stated fire rate, ammo supply rate).
 * A tower's magazine is its input buffer, refilled by factory links (core/factory.ts transport).
 * It fires one whole round per shot when its cooldown is up; with no round in the magazine it can't fire.
 * Nothing here boosts a tower without ammo: supply is the only way to reach the stated rate.
 *
 * Until M0.5 adds enemies, "engaged" (has a target) is passed in; M0.5 replaces it with targeting.
 */
import { EPS, towerOf, type FactoryCtx, type FactoryNode, type FactoryState } from "./factory";

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
 * Advance every tower by dt seconds. Pure: returns a new state.
 * engaged = ids of towers with a target this tick; omitted means every tower is engaged.
 * Shots can't be banked: an idle or empty tower's cooldown stops at 0.
 */
export function stepTowers(state: FactoryState, ctx: FactoryCtx, dt: number, engaged?: ReadonlySet<number>): FactoryState {
  const next = structuredClone(state);
  for (const n of next.nodes) {
    const tower = towerOf(ctx, n);
    if (!tower) continue;
    const wants = engaged ? engaged.has(n.id) : true;
    let cooldown = (n.cooldown ?? 0) - dt;
    let fired = 0;
    if (wants) {
      while (cooldown <= EPS) {
        const ammo = loadedAmmo(ctx, n);
        if (!ammo) break;
        n.inputs[ammo] = clean(n.inputs[ammo]! - 1);
        fired++;
        cooldown += 1 / tower.fireRate;
      }
    }
    n.cooldown = Math.max(0, cooldown);
    n.shots = (n.shots ?? 0) + fired;
    n.status = !wants ? "idle" : fired > 0 || loadedAmmo(ctx, n) ? "working" : "starved";
  }
  return next;
}

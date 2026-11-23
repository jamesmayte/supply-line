/**
 * Factory analysis for the between-wave report and card advice. Pure and deterministic: it simulates a
 * copy of the factory and never touches the real game state.
 *
 * "Ammo rate" = items per second the factory can deliver into towers when every tower is a bottomless
 * sink (magazines drained each tick). That measures the factory's ceiling rather than what the towers
 * happened to fire, which also depends on enemies being in range.
 */
import type { Content } from "../content/schema";
import { stepFactory, type FactoryCtx, type FactoryState } from "./factory";
import type { GameCtx, GameState } from "./game";

type Card = Content["cards"][number];

export interface AmmoRateOptions {
  /** total simulated seconds (the first part lets buffers settle) */
  seconds?: number;
  /** seconds at the end over which delivery is measured */
  measure?: number;
  dt?: number;
}

/** Items per second delivered into towers with all magazines kept empty. */
export function ammoRate(factory: FactoryState, ctx: FactoryCtx, opts: AmmoRateOptions = {}): number {
  const { seconds = 60, measure = 30, dt = 0.1 } = opts;
  const ticks = Math.round(seconds / dt);
  const from = ticks - Math.round(measure / dt);
  let s = structuredClone(factory);
  let delivered = 0;
  for (let i = 0; i < ticks; i++) {
    s = stepFactory(s, ctx, dt);
    for (const n of s.nodes) {
      if (!n.towerId) continue;
      const got = Object.values(n.inputs).reduce((a, v) => a + v, 0);
      if (i >= from) delivered += got;
      n.inputs = {};
    }
  }
  return delivered / measure;
}

/** A copy of the factory with extra speed multipliers applied (as a speed card would). */
function withSpeed(factory: FactoryState, buildingIds: readonly string[], multiplier: number): FactoryState {
  const f = structuredClone(factory);
  const mult = (f.speedMult ??= {});
  for (const b of buildingIds) mult[b] = (mult[b] ?? 1) * multiplier;
  return f;
}

const pct = (base: number, next: number) => (base > 1e-9 ? ((next - base) / base) * 100 : next > 1e-9 ? Infinity : 0);

export type CardAdvice =
  | { cardId: string; kind: "ammo"; baseline: number; projected: number; gainPct: number }
  | { cardId: string; kind: "grant"; items: { itemId: string; qty: number }[] };

/** What each offered card would do for the current factory. */
export function adviseCards(state: GameState, ctx: GameCtx, cardIds: readonly string[], opts?: AmmoRateOptions): CardAdvice[] {
  const baseline = ammoRate(state.factory, ctx.factory, opts);
  return cardIds.map((id): CardAdvice => {
    const card: Card | undefined = ctx.cards.get(id);
    if (!card) throw new Error(`unknown card '${id}'`);
    const e = card.effect;
    if (e.type === "grant") return { cardId: id, kind: "grant", items: e.items.map((i) => ({ ...i })) };
    const projected = ammoRate(withSpeed(state.factory, e.buildingIds, e.multiplier), ctx.factory, opts);
    return { cardId: id, kind: "ammo", baseline, projected, gainPct: pct(baseline, projected) };
  });
}

/** The speed card with the biggest ammo gain (≥ 1%), if any. */
export function bestCard(advice: readonly CardAdvice[]): string | undefined {
  let best: { id: string; gain: number } | undefined;
  for (const a of advice) if (a.kind === "ammo" && a.gainPct >= 1 && (!best || a.gainPct > best.gain)) best = { id: a.cardId, gain: a.gainPct };
  return best?.id;
}

export interface Bottleneck {
  /** ammo items/s the factory can deliver to towers now */
  ammoRate: number;
  /** building types ranked by how much +25% speed would raise ammo rate (only those that help ≥ 1%) */
  limiting: { buildingId: string; gainPct: number }[];
  /** links running at their tier cap */
  cappedLinks: number[];
}

/** Which part of the factory limits ammo: speed each building type up in turn and see what helps. */
export function findBottleneck(factory: FactoryState, ctx: FactoryCtx, opts?: AmmoRateOptions): Bottleneck {
  const base = ammoRate(factory, ctx, opts);
  const types = [...new Set(factory.nodes.filter((n) => !n.towerId).map((n) => n.buildingId))].filter((id) => {
    const kind = ctx.buildings.get(id)?.kind;
    return kind === "extractor" || kind === "processor" || kind === "assembler";
  });
  const limiting = types
    .map((id) => ({ buildingId: id, gainPct: pct(base, ammoRate(withSpeed(factory, [id], 1.25), ctx, opts)) }))
    .filter((x) => x.gainPct >= 1)
    .sort((a, b) => b.gainPct - a.gainPct || a.buildingId.localeCompare(b.buildingId));
  // links at cap, measured on the drained simulation's final tick
  let s = structuredClone(factory);
  const seconds = opts?.seconds ?? 60, dt = opts?.dt ?? 0.1;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    s = stepFactory(s, ctx, dt);
    for (const n of s.nodes) if (n.towerId) n.inputs = {};
  }
  const cappedLinks = s.links.filter((l) => l.flow >= (ctx.tiers.get(l.tier)?.itemsPerSecond ?? Infinity) - 1e-6).map((l) => l.id);
  return { ammoRate: base, limiting, cappedLinks };
}

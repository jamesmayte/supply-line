import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { applyCommands, earlyStartBonus, makeGameCtx, newGame, pickTarget, shotDamage, spendable, starsFor, step, type GameInput, type GameState } from "../core/game";
import { hashState } from "../core/hash";
import { positionAt } from "../core/path";

const DT = 0.1; // 10 Hz
const MAP = "scrapyard_1";
const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;
const enemy = (id: string) => biome1.enemies.find((e) => e.id === id)!;
const tower = (id: string) => biome1.towers.find((t) => t.id === id)!;
const ammo = (id: string) => biome1.ammo.find((a) => a.itemId === id)!;

/** Run for `seconds`; inputs[tick] are applied on that tick (relative to the start of this call). */
function run(state: GameState, seconds: number, inputs: Record<number, GameInput[]> = {}): GameState {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = step(state, inputs[i] ?? [], DT, ctx);
    if (state.errors.length) throw new Error(state.errors.join("; "));
  }
  return state;
}
/** Pick the first offered card (if any) and start the next wave. Throws instead of looping on a rejected command. */
const startNext = (s: GameState): GameState => {
  const pick: GameInput[] = s.cardOffer ? [{ type: "pickCard", cardId: s.cardOffer[0]! }] : [];
  const next = step(s, [...pick, { type: "startWave" }], DT, ctx);
  if (next.errors.length) throw new Error(next.errors.join("; "));
  return next;
};
const untilBuild = (s: GameState, max = 300) => {
  for (let i = 0; i < max / DT && s.phase === "wave"; i++) s = step(s, [], DT, ctx);
  return s;
};

/* Gunner at (6,8) beside the bottom-right of the path, fed by one 2 bullets/s chain (ids 1..6, gunner = 6). */
const BUILD: GameInput[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 1 coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // 2
  { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 3 iron
  { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 4
  { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" }, // 5
  { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 6
  { type: "link", from: 1, to: 2 },
  { type: "link", from: 3, to: 4 },
  { type: "link", from: 4, to: 5 },
];
const FEED: GameInput = { type: "link", from: 5, to: 6 };
const GUN = 6;

describe("enemies and waves", () => {
  it("a wave spawns its groups on the content schedule", () => {
    const wave = map.waves[0]!.groups[0]!;
    const s = run(newGame(biome1, MAP, 1), wave.spacing * 2 + DT, { 0: [{ type: "startWave" }] });
    expect(s.wave!.spawned[0]).toBe(3); // t = 0, spacing, 2·spacing
  });

  it("enemies move at their content speed", () => {
    const s = run(newGame(biome1, MAP, 1), 1, { 0: [{ type: "startWave" }] });
    const first = s.enemies.find((e) => e.id === 1)!;
    expect(first.d).toBeCloseTo(enemy("walker").speed * 1, 6);
  });

  it("unopposed enemies reach the core and deal their coreDamage", () => {
    const s = untilBuild(run(newGame(biome1, MAP, 1), DT, { 0: [{ type: "startWave" }] }));
    const w = map.waves[0]!.groups[0]!;
    expect(s.phase).toBe("build");
    expect(s.waveIndex).toBe(1);
    expect(s.leaked).toBe(w.count);
    expect(s.coreHp).toBe(map.coreHp - w.count * enemy(w.enemyId).coreDamage);
  });

  it("the run is lost when core HP hits 0", () => {
    let s = newGame(biome1, MAP, 1);
    for (let w = 0; w < map.waves.length && s.phase === "build"; w++) s = untilBuild(startNext(s));
    expect(s.phase).toBe("lost");
    expect(s.coreHp).toBe(0);
    expect(step(s, [], DT, ctx)).toEqual({ ...s, errors: [] }); // frozen once over
  });

  it("startWave is rejected mid-wave", () => {
    const s = run(newGame(biome1, MAP, 1), DT, { 0: [{ type: "startWave" }] });
    expect(step(s, [{ type: "startWave" }], DT, ctx).errors[0]).toMatch(/during 'wave'/);
  });
});

describe("targeting and damage", () => {
  const built = run(newGame(biome1, MAP, 1), DT, { 0: BUILD });
  const gun = built.factory.nodes.find((n) => n.id === GUN)!;

  it("picks the in-range enemy furthest along the path", () => {
    const enemies = [5, 15, 16, 22].map((d, i) => ({ id: i + 1, enemyId: "walker", hp: 40, d }));
    // the gunner covers the path around (4..7, 9.5); d = 15, 16 are there, 22 is far down the right side
    expect(pickTarget(ctx, enemies, gun, tower("gunner"))?.d).toBe(16);
    expect(pickTarget(ctx, enemies.filter((e) => e.d !== 15 && e.d !== 16), gun, tower("gunner"))).toBeUndefined();
    const pos = positionAt(ctx.path, 16);
    expect(Math.hypot(pos.x - 6.5, pos.y - 8.5)).toBeLessThanOrEqual(tower("gunner").range);
  });

  it("ignores dead enemies", () => {
    const enemies = [{ id: 1, enemyId: "walker", hp: 0, d: 16 }, { id: 2, enemyId: "walker", hp: 40, d: 15 }];
    expect(pickTarget(ctx, enemies, gun, tower("gunner"))?.id).toBe(2);
  });

  it("armour blocks bullets; armour-piercing shells ignore it", () => {
    expect(shotDamage(tower("gunner"), ammo("bullets"), enemy("walker"))).toBe(6);
    expect(shotDamage(tower("gunner"), ammo("bullets"), enemy("armoured"))).toBeCloseTo(6 * (1 - 0.6), 9);
    expect(shotDamage(tower("cannon"), ammo("shells"), enemy("armoured"))).toBe(30);
  });
});

describe("factory feeds the fight", () => {
  const wave1 = (feed: boolean) => {
    const built = run(newGame(biome1, MAP, 1), 30, { 0: feed ? [...BUILD, FEED] : BUILD }); // build break: factory warms up
    return untilBuild(step(built, [{ type: "startWave" }], DT, ctx));
  };

  it("an unfed Gunner fires nothing and every walker leaks", () => {
    const s = wave1(false);
    expect(s.factory.nodes.find((n) => n.id === GUN)!.shots).toBe(0);
    expect(s.kills).toBe(0);
    expect(s.leaked).toBe(map.waves[0]!.groups[0]!.count);
  });

  it("a fed Gunner kills walkers and spends its ammo doing it", () => {
    const s = wave1(true);
    const gun = s.factory.nodes.find((n) => n.id === GUN)!;
    expect(s.kills).toBeGreaterThan(0);
    expect(s.kills + s.leaked).toBe(map.waves[0]!.groups[0]!.count);
    // every shot hit; damage counts only HP removed, so overkill on the last shot of each kill is lost
    expect(gun.shots).toBeGreaterThan(0);
    expect(s.damageDealt).toBeLessThanOrEqual(gun.shots! * tower("gunner").damage);
    expect(s.damageDealt).toBeGreaterThanOrEqual(s.kills * enemy("walker").hp - 1e-9);
  });

  it("with no enemies in range a loaded Gunner holds its fire", () => {
    const s = run(newGame(biome1, MAP, 1), 30, { 0: [...BUILD, FEED] });
    const gun = s.factory.nodes.find((n) => n.id === GUN)!;
    expect(gun.shots).toBe(0);
    expect(gun.status).toBe("idle");
  });
});

describe("determinism", () => {
  const script = (seed: number) => {
    let s = run(newGame(biome1, MAP, seed), 30, { 0: [...BUILD, FEED] });
    for (let w = 0; w < 3 && s.phase === "build"; w++) s = untilBuild(startNext(s));
    return s;
  };

  it("same seed + same inputs ⇒ identical state hash", () => {
    const a = script(42);
    const b = script(42);
    expect(a.tick).toBeGreaterThan(300);
    expect(hashState(a)).toBe(hashState(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different inputs ⇒ different hash", () => {
    const a = run(newGame(biome1, MAP, 42), 5, { 0: BUILD });
    const b = run(newGame(biome1, MAP, 42), 5, { 0: [...BUILD, FEED] });
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("step never mutates its input", () => {
    const s = run(newGame(biome1, MAP, 7), 30, { 0: [...BUILD, FEED] });
    const before = JSON.stringify(s);
    step(s, [{ type: "startWave" }], DT, ctx);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("build costs (M0.7)", () => {
  const cost = (id: string) => (biome1.buildings.find((b) => b.id === id) ?? biome1.towers.find((t) => t.id === id))!.buildCost;
  const ingots = (id: string) => cost(id).find((c) => c.itemId === "iron_ingot")?.qty ?? 0;
  const start = map.startingStock.find((x) => x.itemId === "iron_ingot")!.qty;

  it("the run starts with the map's starting stock", () => {
    expect(newGame(biome1, MAP, 1).stock).toEqual({ iron_ingot: start });
  });

  it("placing pays the content build cost; extractors are free", () => {
    const s = step(newGame(biome1, MAP, 1), [
      { type: "place", buildingId: "smelter", x: 6, y: 7 },
      { type: "place", buildingId: "extractor", x: 7, y: 7 },
      { type: "placeTower", towerId: "gunner", x: 6, y: 8 },
    ], DT, ctx);
    expect(s.errors).toEqual([]);
    expect(s.stock.iron_ingot).toBe(start - ingots("smelter") - ingots("gunner"));
    expect(ingots("extractor")).toBe(0);
  });

  it("a build you can't afford is rejected and changes nothing", () => {
    const broke = { ...newGame(biome1, MAP, 1), stock: { iron_ingot: ingots("gunner") - 1 } };
    const s = step(broke, [{ type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(s.errors[0]).toMatch(/can't afford: needs 3 iron_ingot, have 2/);
    expect(s.factory.nodes).toEqual([]);
    expect(s.stock).toEqual(broke.stock);
  });

  it("a bad placement is rejected without charging", () => {
    const s = step(newGame(biome1, MAP, 1), [{ type: "placeTower", towerId: "gunner", x: 4, y: 2 }], DT, ctx);
    expect(s.errors[0]).toMatch(/path/);
    expect(s.stock.iron_ingot).toBe(start);
  });

  it("when the stockpile runs short, the rest comes from hubs", () => {
    let s = step(newGame(biome1, MAP, 1), [{ type: "place", buildingId: "hub", x: 7, y: 5 }], DT, ctx);
    const hub = s.factory.nodes[0]!;
    s = structuredClone(s);
    s.stock.iron_ingot = 1;
    s.factory.nodes[0]!.inputs = { iron_ingot: 5, bullets: 7 };
    expect(spendable(s, ctx, "iron_ingot")).toBe(6);
    const after = step(s, [{ type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(after.errors).toEqual([]);
    expect(after.stock.iron_ingot).toBe(0);
    const h = after.factory.nodes.find((n) => n.id === hub.id)!;
    expect(h.inputs.iron_ingot).toBe(5 - (ingots("gunner") - 1));
    expect(h.inputs.bullets).toBe(7); // other items untouched
  });

  it("removing refunds the full cost in a build break, half during a wave", () => {
    const placed = step(newGame(biome1, MAP, 1), [{ type: "place", buildingId: "smelter", x: 6, y: 7 }], DT, ctx);
    const id = placed.factory.nodes[0]!.id;
    const inBreak = step(placed, [{ type: "remove", nodeId: id }], DT, ctx);
    expect(inBreak.factory.nodes).toEqual([]);
    expect(inBreak.stock.iron_ingot).toBe(start);
    const inWave = step(step(placed, [{ type: "startWave" }], DT, ctx), [{ type: "remove", nodeId: id }], DT, ctx);
    expect(inWave.stock.iron_ingot).toBe(start - ingots("smelter") * (1 - biome1.rules.refund.wave));
  });
});

describe("applyCommands (build while paused)", () => {
  it("applies commands without advancing time", () => {
    const s = run(newGame(biome1, MAP, 1), 1, { 0: [{ type: "startWave" }] });
    const after = applyCommands(s, [{ type: "place", buildingId: "hub", x: 7, y: 5 }], ctx);
    expect(after.tick).toBe(s.tick);
    expect(after.enemies).toEqual(s.enemies);
    expect(after.factory.nodes).toHaveLength(1);
    expect(after.errors).toEqual([]);
    expect(applyCommands(s, [{ type: "startWave" }], ctx).errors[0]).toMatch(/during 'wave'/);
  });

  it("then stepping with no input equals stepping with the input", () => {
    const s = run(newGame(biome1, MAP, 1), 2);
    const cmd: GameInput[] = [{ type: "place", buildingId: "hub", x: 7, y: 5 }];
    expect(hashState(step(applyCommands(s, cmd, ctx), [], DT, ctx))).toBe(hashState(step(s, cmd, DT, ctx)));
  });
});

describe("run loop (M1.3): cards, early start, stars", () => {
  const afterWave1 = (seed = 1) => untilBuild(step(newGame(biome1, MAP, seed), [{ type: "startWave" }], DT, ctx));
  it("after a wave, the seeded RNG offers distinct cards from content", () => {
    const s = afterWave1();
    expect(s.phase).toBe("build");
    expect(s.cardOffer).toHaveLength(biome1.rules.cardsOffered);
    expect(new Set(s.cardOffer).size).toBe(s.cardOffer!.length);
    for (const id of s.cardOffer!) expect(biome1.cards.map((c) => c.id)).toContain(id);
    expect(afterWave1().cardOffer).toEqual(s.cardOffer); // same seed, same offer
    const offers = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => afterWave1(seed).cardOffer!.join()));
    expect(offers.size).toBeGreaterThan(1); // the seed matters
  });

  it("no card is offered before wave 1", () => {
    expect(newGame(biome1, MAP, 1).cardOffer).toBeNull();
  });

  it("the next wave can't start until a card is picked; only offered cards can be picked", () => {
    const s = afterWave1();
    expect(step(s, [{ type: "startWave" }], DT, ctx).errors[0]).toMatch(/pick a card/);
    const notOffered = biome1.cards.find((c) => !s.cardOffer!.includes(c.id));
    if (notOffered) expect(step(s, [{ type: "pickCard", cardId: notOffered.id }], DT, ctx).errors[0]).toMatch(/isn't on offer/);
    const picked = step(s, [{ type: "pickCard", cardId: s.cardOffer![0]! }, { type: "startWave" }], DT, ctx);
    expect(picked.errors).toEqual([]);
    expect(picked.cards).toEqual([s.cardOffer![0]]);
    expect(picked.phase).toBe("wave");
  });

  it("a grant card adds to the stockpile; a speed card speeds those buildings up", () => {
    const s = { ...afterWave1(), cardOffer: ["scrap_haul", "rich_seams", "hot_smelters"] };
    const haul = step(s, [{ type: "pickCard", cardId: "scrap_haul" }], DT, ctx);
    expect(haul.stock.iron_ingot).toBe(s.stock.iron_ingot! + 8);
    const drills = step(s, [{ type: "pickCard", cardId: "rich_seams" }, { type: "place", buildingId: "extractor", x: 7, y: 7 }], DT, ctx);
    const later = run(drills, 2);
    expect(later.factory.nodes[0]!.produced).toBeCloseTo((2 + DT) * 1.5, 6);
  });

  it("starting early pays a bonus that shrinks to 0 over the window; none for wave 1", () => {
    const { windowSeconds, maxBonus } = biome1.rules.earlyStart;
    expect(earlyStartBonus(newGame(biome1, MAP, 1), ctx).qty).toBe(0);
    const w1 = afterWave1();
    const s = step(w1, [{ type: "pickCard", cardId: w1.cardOffer![0]! }], DT, ctx);
    expect(earlyStartBonus(s, ctx)).toEqual({ itemId: maxBonus.itemId, qty: maxBonus.qty }); // right after the wave
    const started = step(s, [{ type: "startWave" }], DT, ctx);
    expect(started.stock.iron_ingot).toBe((s.stock.iron_ingot ?? 0) + maxBonus.qty);
    const half = run(s, windowSeconds / 2);
    expect(earlyStartBonus(half, ctx).qty).toBe(Math.round(maxBonus.qty / 2));
    const waited = run(s, windowSeconds);
    expect(earlyStartBonus(waited, ctx).qty).toBe(0);
    expect(step(waited, [{ type: "startWave" }], DT, ctx).stock.iron_ingot).toBe(waited.stock.iron_ingot);
  });

  it("stars come from core HP left, and only for a win", () => {
    const base = newGame(biome1, MAP, 1);
    expect(starsFor({ ...base, phase: "won", coreHp: 100 }, ctx, 100)).toBe(3);
    expect(starsFor({ ...base, phase: "won", coreHp: 60 }, ctx, 100)).toBe(2);
    expect(starsFor({ ...base, phase: "won", coreHp: 10 }, ctx, 100)).toBe(1);
    expect(starsFor({ ...base, phase: "lost", coreHp: 0 }, ctx, 100)).toBe(0);
  });
});

describe("room to grow (M1.6): upgrades, moves, new cards", () => {
  const ingotsFor = (id: string, tier: number) => biome1.buildings.find((b) => b.id === id)!.upgrades[tier - 2]!.cost[0]!.qty;
  const setup = () =>
    step(newGame(biome1, MAP, 1), [
      { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 1
      { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 2
      { type: "link", from: 1, to: 2 }, // 3
    ], DT, ctx);

  it("upgrading an extractor doubles its output and costs the content price", () => {
    const s = setup();
    const up = step(s, [{ type: "upgrade", nodeId: 1 }], DT, ctx);
    expect(up.errors).toEqual([]);
    expect(up.factory.nodes[0]!.level).toBe(2);
    expect(up.stock.iron_ingot).toBe(s.stock.iron_ingot! - ingotsFor("extractor", 2));
    const free = { ...s, factory: { ...s.factory, links: [] } }; // no outflow, so we only measure extraction
    const a = run(free, 2), b = run(applyCommands(free, [{ type: "upgrade", nodeId: 1 }], ctx), 2);
    const made = (x: GameState) => x.factory.nodes[0]!.produced - free.factory.nodes[0]!.produced;
    expect(made(b)).toBeCloseTo(made(a) * 2, 6);
  });

  it("stops at the top tier; towers can't be upgraded", () => {
    let s: GameState = { ...setup(), stock: { iron_ingot: 100 } };
    s = step(s, [{ type: "upgrade", nodeId: 1 }, { type: "upgrade", nodeId: 1 }], DT, ctx);
    expect(s.factory.nodes[0]!.level).toBe(3);
    expect(step(s, [{ type: "upgrade", nodeId: 1 }], DT, ctx).errors[0]).toMatch(/top tier/);
    const t = step(s, [{ type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(step(t, [{ type: "upgrade", nodeId: t.factory.nodes.at(-1)!.id }], DT, ctx).errors[0]).toMatch(/towers/);
  });

  it("a free-upgrade token is used before paying; the refund includes upgrades", () => {
    const s = { ...setup(), upgradeTokens: 1 };
    const up = step(s, [{ type: "upgrade", nodeId: 2 }], DT, ctx);
    expect(up.upgradeTokens).toBe(0);
    expect(up.stock.iron_ingot).toBe(s.stock.iron_ingot);
    const removed = step(up, [{ type: "remove", nodeId: 2 }], DT, ctx);
    expect(removed.stock.iron_ingot).toBe(s.stock.iron_ingot! + 2 + ingotsFor("smelter", 2)); // build cost + upgrade, full refund in a break
  });

  it("moving keeps links that still route and drops those that can't", () => {
    const s = setup();
    const near = step(s, [{ type: "move", nodeId: 2, x: 6, y: 6 }], DT, ctx);
    expect(near.errors).toEqual([]);
    expect(near.factory.nodes.find((n) => n.id === 2)).toMatchObject({ x: 6, y: 6 });
    expect(near.factory.links).toHaveLength(1);
    expect(near.factory.links[0]!.length).toBe(2);
    const far = step(s, [{ type: "move", nodeId: 2, x: 0, y: 8 }], DT, ctx); // across the path: no bridge route
    expect(far.errors).toEqual([]);
    expect(far.factory.links).toEqual([]);
    expect(far.dropped).toEqual([3]);
  });

  it("can't move onto bad tiles or during a wave", () => {
    const s = setup();
    expect(step(s, [{ type: "move", nodeId: 2, x: 4, y: 2 }], DT, ctx).errors[0]).toMatch(/path/);
    expect(step(s, [{ type: "move", nodeId: 2, x: 7, y: 7 }], DT, ctx).errors[0]).toMatch(/occupied/);
    expect(step(s, [{ type: "move", nodeId: 1, x: 6, y: 5 }], DT, ctx).errors[0]).toMatch(/ore/);
    const inWave = step(s, [{ type: "startWave" }], DT, ctx);
    expect(step(inWave, [{ type: "move", nodeId: 2, x: 6, y: 6 }], DT, ctx).errors[0]).toMatch(/during a wave/);
  });

  it("'Wider links' raises every link's capacity by a tier", () => {
    const s = { ...afterWave1Offer(["wider_links", "scrap_haul", "overclock"]) };
    const picked = step(s, [{ type: "pickCard", cardId: "wider_links" }], DT, ctx);
    expect(picked.factory.linkBonus).toBe(1);
  });

  function afterWave1Offer(offer: string[]): GameState {
    let s = step(newGame(biome1, MAP, 1), [{ type: "startWave" }], DT, ctx);
    s = untilBuild(s);
    return { ...s, cardOffer: offer };
  }
});

describe("research (M1.4)", () => {
  const POWER: GameInput[] = [
    { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 1 coal
    { type: "place", buildingId: "generator", x: 7, y: 4 }, // 2
    { type: "link", from: 1, to: 2 }, // 3
  ];
  /** Powered labs with packs already loaded (the pack chain is ordinary factory, tested elsewhere). */
  function labs(n: number, packs = 20): GameState {
    const tiles = [[6, 5], [6, 4], [5, 5], [6, 3]] as const;
    let s: GameState = { ...newGame(biome1, MAP, 1), stock: { iron_ingot: 100 } };
    s = step(s, [...POWER, ...tiles.slice(0, n).map(([x, y]): GameInput => ({ type: "place", buildingId: "lab", x, y }))], DT, ctx);
    if (s.errors.length) throw new Error(s.errors.join("; "));
    s = structuredClone(s);
    for (const lab of s.factory.nodes.filter((x) => x.buildingId === "lab")) lab.inputs = { red_pack: packs };
    return run(s, 1); // let the generator light
  }
  const node = (id: string) => biome1.research.find((r) => r.id === id)!;

  it("a powered lab researches the active node in its content time, using its pack cost", () => {
    let s = step(labs(1), [{ type: "research", nodeId: "press_plates" }], DT, ctx);
    const r = node("press_plates");
    s = run(s, r.time);
    expect(s.research.done).toEqual(["press_plates"]);
    expect(s.research.active).toBeNull();
    const lab = s.factory.nodes.find((x) => x.buildingId === "lab")!;
    expect(lab.inputs.red_pack).toBeCloseTo(20 - r.cost[0]!.qty, 6);
  });

  it("more labs research faster, up to the content cap", () => {
    const r = node("press_plates");
    const timeWith = (n: number) => {
      let s = step(labs(n), [{ type: "research", nodeId: "press_plates" }], DT, ctx);
      let t = 0;
      while (!s.research.done.length && t < 100) (s = step(s, [], DT, ctx)), (t += DT);
      return t;
    };
    expect(timeWith(2)).toBeCloseTo(r.time / 2, 0);
    expect(timeWith(4)).toBeCloseTo(r.time / biome1.rules.maxLabs, 0);
  });

  it("no packs or no power = no progress; it keeps going during a wave", () => {
    const empty = run(step(labs(1, 0), [{ type: "research", nodeId: "press_plates" }], DT, ctx), 5);
    expect(empty.research.progress.press_plates ?? 0).toBe(0);
    expect(empty.factory.nodes.find((x) => x.buildingId === "lab")!.status).toBe("starved");
    const inWave = run(step(labs(1), [{ type: "research", nodeId: "press_plates" }, { type: "startWave" }], DT, ctx), 5);
    expect(inWave.research.progress.press_plates).toBeGreaterThan(0.2);
  });

  it("prerequisites are enforced", () => {
    expect(step(labs(1), [{ type: "research", nodeId: "cannon_shells" }], DT, ctx).errors[0]).toMatch(/needs Press \+ plates first/);
  });

  it("locked towers, recipes and link tiers are refused until researched", () => {
    const s = { ...newGame(biome1, MAP, 1), stock: { iron_ingot: 100, plate: 20 } };
    expect(step(s, [{ type: "placeTower", towerId: "cannon", x: 6, y: 8 }], DT, ctx).errors[0]).toMatch(/needs research: Cannon \+ shells/);
    expect(step(s, [{ type: "place", buildingId: "press", x: 6, y: 7 }], DT, ctx).errors[0]).toMatch(/needs research: Press \+ plates/);
    expect(step(s, [{ type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_shells" }], DT, ctx).errors[0]).toMatch(/Cannon \+ shells/);
    const two = step(s, [{ type: "place", buildingId: "hub", x: 7, y: 5 }, { type: "placeTower", towerId: "gunner", x: 6, y: 8 }], DT, ctx);
    expect(step(two, [{ type: "link", from: 1, to: 2, itemId: "bullets", tier: 2 }], DT, ctx).errors[0]).toMatch(/Tier 2 links/);
    const done = { ...two, research: { ...two.research, done: ["links_t2"] } };
    expect(step(done, [{ type: "link", from: 1, to: 2, itemId: "bullets", tier: 2 }], DT, ctx).errors).toEqual([]);
  });

  it("Generator efficiency halves coal use", () => {
    const burnt = (s: GameState) => {
      const gen = s.factory.nodes.find((x) => x.buildingId === "generator")!;
      return gen.inputs.coal ?? 0;
    };
    const base = structuredClone(labs(0));
    base.factory.links = []; // no more coal coming in
    base.factory.nodes.find((x) => x.buildingId === "generator")!.inputs = { coal: 5 };
    const eff = structuredClone(base);
    eff.factory.fuelUse = 0.5;
    const secs = 8;
    expect(5 - burnt(run(eff, secs))).toBeCloseTo((5 - burnt(run(base, secs))) / 2, 1);
  });

  it("Sandbox starts with everything researched", () => {
    const s = newGame(biome1, MAP, 1, { allResearched: true });
    expect(s.research.done).toEqual(biome1.research.map((r) => r.id));
    expect(s.factory.fuelUse).toBe(0.5);
    const placed = step({ ...s, stock: { plate: 10 } }, [{ type: "placeTower", towerId: "cannon", x: 6, y: 8 }], DT, ctx);
    expect(placed.errors).toEqual([]);
  });
});

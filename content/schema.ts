/**
 * Content schema for Supply Line. All gameplay numbers live in content files validated here.
 * Balancing = a data edit, never a code change (CLAUDE.md invariant 2).
 *
 * Rates: a recipe takes `time` seconds at building speed 1, so
 *   output per second = outputs.qty / (time / building.speed).
 * Extractors have no recipe; they produce `extractRate` of the ore under them per second.
 */
import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]+$/, "ids are snake_case");

/* ---------- items ---------- */
export const ItemSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(["ore", "intermediate", "ammo", "science", "part"]),
});

export const StackSchema = z.object({ itemId: id, qty: z.number().int().positive() });

/* ---------- buildings ---------- */
export const BuildingSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(["extractor", "processor", "assembler", "hub", "generator", "lab"]),
  speed: z.number().positive().default(1),
  inputPorts: z.number().int().min(0).max(3),
  /** outgoing links allowed; hubs split, so they get more than 1 */
  outputPorts: z.number().int().min(0).max(3).default(1),
  bufferSize: z.number().int().positive(),
  needsPower: z.boolean(),
  buildCost: z.array(StackSchema),
  /** extractor only: items per second of the ore it sits on */
  extractRate: z.number().positive().optional(),
  /** generator only */
  fuel: z.object({ itemId: id, secondsPerItem: z.number().positive() }).optional(),
  powerRadius: z.number().int().positive().optional(),
  /**
   * In-place upgrades (spec §7.2): upgrades[0] is tier 2, upgrades[1] tier 3 …
   * `speed` is the total speed multiplier at that tier (relative to tier 1); `cost` is paid for that step.
   */
  upgrades: z.array(z.object({ speed: z.number().positive(), cost: z.array(StackSchema) })).default([]),
});

/* ---------- recipes ---------- */
export const RecipeSchema = z.object({
  id,
  buildingId: id,
  inputs: z.array(StackSchema).max(3),
  outputs: z.array(StackSchema).length(1),
  time: z.number().positive(),
  /** research node that unlocks it; omitted = available from the start */
  unlockedBy: id.optional(),
});

/* ---------- links ---------- */
export const LinkTierSchema = z.object({
  tier: z.number().int().min(1).max(3),
  itemsPerSecond: z.number().positive(),
  maxLength: z.number().int().positive(),
  /** research node that unlocks building links of this tier; omitted = available from the start */
  unlockedBy: id.optional(),
});

/* ---------- towers ---------- */
export const TowerSchema = z.object({
  id,
  name: z.string().min(1),
  ammo: z.array(id).min(1),
  fireRate: z.number().positive(), // stated shots per second
  damage: z.number().positive(),
  range: z.number().positive(), // tiles
  splash: z.number().nonnegative().default(0), // tiles
  airOnly: z.boolean().default(false),
  hitsAir: z.boolean().default(false),
  magazine: z.number().int().positive(),
  buildCost: z.array(StackSchema),
  unlockedBy: id.optional(),
});

/** Ammo modifiers: e.g. AP bullets ignore armour. Same tower, better ammo. */
export const AmmoSchema = z.object({
  itemId: id,
  damageMultiplier: z.number().positive().default(1),
  armourPiercing: z.boolean().default(false),
});

/* ---------- enemies & waves ---------- */
export const EnemySchema = z.object({
  id,
  name: z.string().min(1),
  hp: z.number().positive(),
  speed: z.number().positive(), // tiles per second
  armour: z.number().min(0).max(1).default(0), // fraction of non-AP damage blocked
  flying: z.boolean().default(false),
  coreDamage: z.number().positive(),
  targetsBuildings: z.boolean().default(false), // saboteurs
});

export const WaveSchema = z.object({
  number: z.number().int().positive(),
  groups: z
    .array(
      z.object({
        enemyId: id,
        count: z.number().int().positive(),
        spacing: z.number().positive(), // seconds between spawns
        delay: z.number().nonnegative().default(0), // seconds after wave start
      }),
    )
    .min(1),
});

/* ---------- maps ---------- */
/**
 * Grid legend:
 *   .  ground          #  rock (blocks building and links)
 *   S  path spawn      P  path      B  bridge (path a link may cross)   X  core (path end)
 *   I  iron ore        C  coal ore  U  copper ore   Y  crystal ore
 */
export const TILE_CHARS = [".", "#", "S", "P", "B", "X", "I", "C", "U", "Y"] as const;
export const PATH_CHARS = ["S", "P", "B", "X"] as const;
export const ORE_BY_CHAR: Record<string, string> = { I: "iron_ore", C: "coal", U: "copper_ore", Y: "crystal_ore" };

export const MapSchema = z.object({
  id,
  name: z.string().min(1),
  width: z.literal(9),
  rows: z.array(z.string()).min(16).max(28),
  /** axis-aligned waypoints [x, y] from spawn to core */
  path: z.array(z.tuple([z.number().int(), z.number().int()])).min(2),
  coreHp: z.number().positive(),
  startingStock: z.array(StackSchema),
  waves: z.array(WaveSchema).min(1),
});

/* ---------- research ---------- */
export const ResearchNodeSchema = z.object({
  id,
  name: z.string().min(1),
  branch: z.enum(["logistics", "industry", "arsenal", "power"]),
  tier: z.number().int().min(1).max(5),
  cost: z.array(StackSchema).min(1), // science packs
  time: z.number().positive(),
  requires: z.array(id).default([]),
  /** what it does besides unlocking things that name it in `unlockedBy` */
  effects: z
    .array(z.discriminatedUnion("type", [z.object({ type: z.literal("fuelUse"), multiplier: z.number().positive() })]))
    .default([]),
  /** one line for the research sheet */
  text: z.string().min(1),
});

/* ---------- cards (reward pick between waves, spec §2) ---------- */
/**
 * Card effects. Placeholder set for Phase 1: factory-side only, so no card makes towers stronger
 * without the factory (CLAUDE.md core pillar).
 */
export const CardEffectSchema = z.discriminatedUnion("type", [
  /** add items to the stockpile */
  z.object({ type: z.literal("grant"), items: z.array(StackSchema).min(1) }),
  /** multiply the speed of these buildings (stacks multiplicatively) */
  z.object({ type: z.literal("speed"), buildingIds: z.array(id).min(1), multiplier: z.number().positive() }),
  /** every link carries as if it were `delta` tiers higher (capped at the top tier) */
  z.object({ type: z.literal("linkTier"), delta: z.number().int().positive() }),
  /** free building upgrades to use any time */
  z.object({ type: z.literal("upgradeToken"), count: z.number().int().positive() }),
]);

export const CardSchema = z.object({
  id,
  name: z.string().min(1),
  text: z.string().min(1),
  effect: CardEffectSchema,
});

/* ---------- run rules ---------- */
export const RulesSchema = z.object({
  /** cards offered after each wave */
  cardsOffered: z.number().int().min(1).max(5),
  /**
   * Starting a wave early in the build break pays a bonus that shrinks linearly to 0 at `windowSeconds`.
   * Not paid for wave 1 (that break is for the opening build).
   */
  earlyStart: z.object({ windowSeconds: z.number().positive(), maxBonus: StackSchema }),
  /** fraction of build cost refunded on remove */
  refund: z.object({ buildBreak: z.number().min(0).max(1), wave: z.number().min(0).max(1) }),
  /** stars: core HP fraction needed for 3 and 2 stars when the run is won (1 star = won) */
  stars: z.object({ three: z.number().min(0).max(1), two: z.number().min(0).max(1) }),
  /** research (spec §7.1): labs beyond this many don't add speed */
  maxLabs: z.number().int().positive(),
});

/* ---------- bundle ---------- */
export const ContentSchema = z.object({
  items: z.array(ItemSchema),
  buildings: z.array(BuildingSchema),
  recipes: z.array(RecipeSchema),
  linkTiers: z.array(LinkTierSchema).min(1),
  towers: z.array(TowerSchema),
  ammo: z.array(AmmoSchema),
  enemies: z.array(EnemySchema),
  research: z.array(ResearchNodeSchema),
  cards: z.array(CardSchema),
  rules: RulesSchema,
  maps: z.array(MapSchema).min(1),
});

export type Content = z.infer<typeof ContentSchema>;
export type GameMap = z.infer<typeof MapSchema>;

/* ---------- cross-reference + map checks ---------- */
function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((i) => (seen.has(i) ? true : (seen.add(i), false)));
}

export function checkMap(map: GameMap): string[] {
  const errs: string[] = [];
  const at = (x: number, y: number) => map.rows[y]?.[x];
  map.rows.forEach((row, y) => {
    if (row.length !== map.width) errs.push(`map ${map.id}: row ${y} has width ${row.length}, expected ${map.width}`);
    for (const ch of row) if (!(TILE_CHARS as readonly string[]).includes(ch)) errs.push(`map ${map.id}: bad tile '${ch}' in row ${y}`);
  });

  const onRoute = new Set<string>();
  for (let i = 0; i < map.path.length - 1; i++) {
    const [ax, ay] = map.path[i]!;
    const [bx, by] = map.path[i + 1]!;
    if (ax !== bx && ay !== by) {
      errs.push(`map ${map.id}: path segment ${i} is not axis-aligned`);
      continue;
    }
    const dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
    for (let x = ax, y = ay; ; x += dx, y += dy) {
      onRoute.add(`${x},${y}`);
      const ch = at(x, y);
      if (!ch || !(PATH_CHARS as readonly string[]).includes(ch)) errs.push(`map ${map.id}: path crosses non-path tile (${x},${y})`);
      if (x === bx && y === by) break;
    }
  }
  const [sx, sy] = map.path[0]!;
  const [ex, ey] = map.path[map.path.length - 1]!;
  if (at(sx, sy) !== "S") errs.push(`map ${map.id}: path must start on S`);
  if (at(ex, ey) !== "X") errs.push(`map ${map.id}: path must end on X`);
  map.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if ((PATH_CHARS as readonly string[]).includes(ch) && !onRoute.has(`${x},${y}`))
        errs.push(`map ${map.id}: path tile (${x},${y}) is not on the waypoint route`);
    }),
  );
  return errs;
}

export function crossCheck(c: Content): string[] {
  const errs: string[] = [];
  const items = new Set(c.items.map((i) => i.id));
  const buildings = new Set(c.buildings.map((b) => b.id));
  const research = new Set(c.research.map((r) => r.id));
  const enemies = new Set(c.enemies.map((e) => e.id));

  for (const [what, list] of [
    ["item", c.items.map((i) => i.id)],
    ["building", c.buildings.map((b) => b.id)],
    ["recipe", c.recipes.map((r) => r.id)],
    ["tower", c.towers.map((t) => t.id)],
    ["enemy", c.enemies.map((e) => e.id)],
    ["research", c.research.map((r) => r.id)],
    ["card", c.cards.map((x) => x.id)],
    ["map", c.maps.map((m) => m.id)],
  ] as const)
    for (const d of dupes([...list])) errs.push(`duplicate ${what} id '${d}'`);

  const needItem = (where: string, itemId: string) => {
    if (!items.has(itemId)) errs.push(`${where}: unknown item '${itemId}'`);
  };
  const needResearch = (where: string, rid?: string) => {
    if (rid && !research.has(rid)) errs.push(`${where}: unknown research '${rid}'`);
  };

  for (const b of c.buildings) {
    b.buildCost.forEach((s) => needItem(`building ${b.id}`, s.itemId));
    if (b.kind === "extractor" && !b.extractRate) errs.push(`building ${b.id}: extractor needs extractRate`);
    if (b.kind === "generator" && (!b.fuel || !b.powerRadius)) errs.push(`building ${b.id}: generator needs fuel + powerRadius`);
    if (b.fuel) needItem(`building ${b.id} fuel`, b.fuel.itemId);
    b.upgrades.forEach((u, i) => {
      u.cost.forEach((s) => needItem(`building ${b.id} upgrade ${i + 2}`, s.itemId));
      const prev = i === 0 ? 1 : b.upgrades[i - 1]!.speed;
      if (u.speed <= prev) errs.push(`building ${b.id}: upgrade ${i + 2} speed must exceed tier ${i + 1}`);
    });
  }
  for (const r of c.recipes) {
    if (!buildings.has(r.buildingId)) errs.push(`recipe ${r.id}: unknown building '${r.buildingId}'`);
    const b = c.buildings.find((x) => x.id === r.buildingId);
    if (b && r.inputs.length > b.inputPorts) errs.push(`recipe ${r.id}: ${r.inputs.length} inputs but ${b.id} has ${b.inputPorts} ports`);
    [...r.inputs, ...r.outputs].forEach((s) => needItem(`recipe ${r.id}`, s.itemId));
    needResearch(`recipe ${r.id}`, r.unlockedBy);
  }
  for (const t of c.towers) {
    t.ammo.forEach((a) => needItem(`tower ${t.id}`, a));
    t.buildCost.forEach((s) => needItem(`tower ${t.id}`, s.itemId));
    needResearch(`tower ${t.id}`, t.unlockedBy);
  }
  for (const a of c.ammo) needItem("ammo", a.itemId);
  for (const r of c.research) {
    r.cost.forEach((s) => needItem(`research ${r.id}`, s.itemId));
    r.requires.forEach((q) => needResearch(`research ${r.id} requires`, q));
  }
  for (const t of c.linkTiers) needResearch(`link tier ${t.tier}`, t.unlockedBy);
  for (const card of c.cards) {
    const e = card.effect;
    if (e.type === "grant") e.items.forEach((s) => needItem(`card ${card.id}`, s.itemId));
    else if (e.type === "speed") e.buildingIds.forEach((b) => { if (!buildings.has(b)) errs.push(`card ${card.id}: unknown building '${b}'`); });
  }
  if (c.cards.length && c.cards.length < c.rules.cardsOffered) errs.push(`rules: offers ${c.rules.cardsOffered} cards but only ${c.cards.length} exist`);
  needItem("rules earlyStart", c.rules.earlyStart.maxBonus.itemId);
  if (c.rules.stars.two > c.rules.stars.three) errs.push("rules: stars.two must be ≤ stars.three");
  for (const m of c.maps) {
    errs.push(...checkMap(m));
    m.startingStock.forEach((s) => needItem(`map ${m.id} stock`, s.itemId));
    for (const w of m.waves)
      for (const g of w.groups) if (!enemies.has(g.enemyId)) errs.push(`map ${m.id} wave ${w.number}: unknown enemy '${g.enemyId}'`);
  }
  for (const ore of Object.values(ORE_BY_CHAR))
    if (c.maps.some((m) => m.rows.some((r) => [...r].some((ch) => ORE_BY_CHAR[ch] === ore)))) needItem("map ore", ore);
  return errs;
}

/** Parse + cross-check. Throws with every problem listed, so a bad edit fails loudly at import. */
export function validateContent(raw: unknown): Content {
  const parsed = ContentSchema.parse(raw);
  const errs = crossCheck(parsed);
  if (errs.length) throw new Error(`Content invalid:\n- ${errs.join("\n- ")}`);
  return parsed;
}

/** Output per second of a recipe in a given building, at full input supply. */
export function recipeRate(recipe: z.infer<typeof RecipeSchema>, building: z.infer<typeof BuildingSchema>): number {
  return recipe.outputs[0]!.qty / (recipe.time / building.speed);
}

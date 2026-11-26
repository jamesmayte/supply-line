/**
 * Biome 1 — Scrapyard. Iron + coal, walkers + swarmers (+ armoured as a preview on wave 5).
 * Numbers mirror docs/game-spec.md §4–§7. Edit balance HERE, not in /core.
 */
import { validateContent } from "./schema";

const raw = {
  items: [
    { id: "iron_ore", name: "Iron ore", kind: "ore" },
    { id: "coal", name: "Coal", kind: "ore" },
    { id: "iron_ingot", name: "Iron ingot", kind: "intermediate" },
    { id: "plate", name: "Iron plate", kind: "part" },
    { id: "powder", name: "Coal powder", kind: "intermediate" },
    { id: "bullets", name: "Bullets", kind: "ammo" },
    { id: "shells", name: "Shells", kind: "ammo" },
    { id: "red_pack", name: "Red science pack", kind: "science" },
  ],

  buildings: [
    { id: "extractor", name: "Extractor", kind: "extractor", inputPorts: 0, bufferSize: 10, needsPower: false, buildCost: [], extractRate: 1,
      upgrades: [{ speed: 2, cost: [{ itemId: "iron_ingot", qty: 4 }] }, { speed: 3, cost: [{ itemId: "iron_ingot", qty: 8 }] }] },
    { id: "smelter", name: "Smelter", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 2 }],
      upgrades: [{ speed: 2, cost: [{ itemId: "iron_ingot", qty: 5 }] }, { speed: 3, cost: [{ itemId: "iron_ingot", qty: 10 }] }] },
    { id: "press", name: "Press", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 4 }] },
    { id: "coal_mill", name: "Coal mill", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 2 }],
      upgrades: [{ speed: 2, cost: [{ itemId: "iron_ingot", qty: 4 }] }] },
    { id: "assembler", name: "Assembler", kind: "assembler", inputPorts: 3, bufferSize: 20, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 4 }],
      upgrades: [{ speed: 2, cost: [{ itemId: "iron_ingot", qty: 6 }] }, { speed: 3, cost: [{ itemId: "iron_ingot", qty: 12 }] }] },
    { id: "hub", name: "Hub", kind: "hub", inputPorts: 3, outputPorts: 3, bufferSize: 50, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 2 }] },
    { id: "generator", name: "Generator", kind: "generator", inputPorts: 1, bufferSize: 10, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 3 }], fuel: { itemId: "coal", secondsPerItem: 4 }, powerRadius: 3 },
    { id: "lab", name: "Lab", kind: "lab", inputPorts: 1, bufferSize: 20, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 6 }] }, // ingots: plates need research first
  ],

  // output/s = qty / time (speed 1).
  // M1.6: stages are deliberately NOT balanced. A starter chain (1 extractor → smelter → assembler) is limited
  // by its extractor (1 ore/s → 0.5 ingot/s → 2 bullets/s); each stage after it has headroom, so speeding up the
  // current bottleneck always helps and reveals the next one. (Perfect balance made single-stage boosts useless.)
  recipes: [
    { id: "smelt_iron", buildingId: "smelter", inputs: [{ itemId: "iron_ore", qty: 2 }], outputs: [{ itemId: "iron_ingot", qty: 1 }], time: 1.6 }, // up to 0.625/s (1.25 ore/s in)
    { id: "press_plate", buildingId: "press", inputs: [{ itemId: "iron_ingot", qty: 1 }], outputs: [{ itemId: "plate", qty: 2 }], time: 4, unlockedBy: "press_plates" }, // 0.5/s
    { id: "mill_powder", buildingId: "coal_mill", inputs: [{ itemId: "coal", qty: 1 }], outputs: [{ itemId: "powder", qty: 2 }], time: 2 }, // 1/s
    { id: "make_bullets", buildingId: "assembler", inputs: [{ itemId: "iron_ingot", qty: 1 }], outputs: [{ itemId: "bullets", qty: 4 }], time: 1.5 }, // up to 2.67/s (0.67 ingot/s in)
    { id: "make_shells", buildingId: "assembler", inputs: [{ itemId: "plate", qty: 1 }, { itemId: "powder", qty: 2 }], outputs: [{ itemId: "shells", qty: 2 }], time: 3, unlockedBy: "cannon_shells" },
    { id: "make_red_pack", buildingId: "assembler", inputs: [{ itemId: "iron_ingot", qty: 1 }, { itemId: "coal", qty: 1 }], outputs: [{ itemId: "red_pack", qty: 1 }], time: 5 },
  ],

  linkTiers: [
    { tier: 1, itemsPerSecond: 3, maxLength: 6 }, // > one chain's 2/s, so a starter chain isn't link-bound
    { tier: 2, itemsPerSecond: 5, maxLength: 9, unlockedBy: "links_t2" },
    { tier: 3, itemsPerSecond: 8, maxLength: 9, unlockedBy: "links_t3" },
  ],

  towers: [
    { id: "gunner", name: "Gunner", ammo: ["bullets"], fireRate: 3, damage: 6, range: 2.5, magazine: 20, buildCost: [{ itemId: "iron_ingot", qty: 3 }] },
    { id: "cannon", name: "Cannon", ammo: ["shells"], fireRate: 0.8, damage: 30, range: 3, splash: 1, magazine: 20, buildCost: [{ itemId: "plate", qty: 6 }], unlockedBy: "cannon_shells" },
  ],

  ammo: [
    { itemId: "bullets", damageMultiplier: 1, armourPiercing: false },
    { itemId: "shells", damageMultiplier: 1, armourPiercing: true },
  ],

  enemies: [
    // HP doubled in M0.6 (was 40 / 12 / 120) so that ammo, not tower count, limits a 3-Gunner defence.
    { id: "walker", name: "Walker", hp: 80, speed: 0.8, coreDamage: 5 },
    { id: "swarmer", name: "Swarmer", hp: 24, speed: 1.6, coreDamage: 2 },
    { id: "armoured", name: "Armoured", hp: 240, speed: 0.5, armour: 0.6, coreDamage: 15 },
    // M1.3: mini-boss (waves 5, 10) and map boss (wave 15). Boss adds (spec §6) come later.
    { id: "brute", name: "Brute", hp: 400, speed: 0.4, coreDamage: 25 },
    { id: "boss", name: "Scrap Titan", hp: 1500, speed: 0.3, armour: 0.2, coreDamage: 100 },
  ],

  // In-run research (spec §7.1, M1.4). Packs come from an assembler: 1 ingot + 1 coal → 1 red pack (5 s).
  research: [
    { id: "press_plates", name: "Press + plates", text: "Unlocks the Press: 1 ingot → 2 plates", branch: "industry", tier: 1, cost: [{ itemId: "red_pack", qty: 10 }], time: 20 },
    { id: "links_t2", name: "Tier 2 links", text: "Links carry 5/s and reach 9 tiles", branch: "logistics", tier: 1, cost: [{ itemId: "red_pack", qty: 15 }], time: 25 },
    { id: "cannon_shells", name: "Cannon + shells", text: "Unlocks the Cannon and shells: splash, ignores armour", branch: "arsenal", tier: 1, cost: [{ itemId: "red_pack", qty: 20 }], time: 30, requires: ["press_plates"] },
    { id: "gen_efficiency", name: "Generator efficiency", text: "Generators burn half as much coal", branch: "power", tier: 1, cost: [{ itemId: "red_pack", qty: 10 }], time: 20, effects: [{ type: "fuelUse", multiplier: 0.5 }] },
    { id: "links_t3", name: "Tier 3 links", text: "Links carry 8/s", branch: "logistics", tier: 2, cost: [{ itemId: "red_pack", qty: 30 }], time: 40, requires: ["links_t2"] },
  ],

  // Reward cards (M1.3, reworked M1.6 so every card can matter): factory-side only, nothing buffs towers directly.
  cards: [
    { id: "scrap_haul", name: "Scrap haul", text: "+8 iron ingots", effect: { type: "grant", items: [{ itemId: "iron_ingot", qty: 8 }] } },
    { id: "overclock", name: "Overclock", text: "Every extractor, smelter and assembler +15% speed", effect: { type: "speed", buildingIds: ["extractor", "smelter", "assembler", "coal_mill", "press"], multiplier: 1.15 } },
    { id: "wider_links", name: "Wider links", text: "Every link carries one tier more", effect: { type: "linkTier", delta: 1 } },
    { id: "rich_seams", name: "Rich seams", text: "Extractors +50% speed", effect: { type: "speed", buildingIds: ["extractor"], multiplier: 1.5 } },
    { id: "hot_smelters", name: "Hot smelters", text: "Smelters +25% speed", effect: { type: "speed", buildingIds: ["smelter"], multiplier: 1.25 } },
    { id: "quick_assembly", name: "Quick assembly", text: "Assemblers +25% speed", effect: { type: "speed", buildingIds: ["assembler"], multiplier: 1.25 } },
    { id: "free_upgrade", name: "Free upgrade", text: "Upgrade any building one tier, free", effect: { type: "upgradeToken", count: 1 } },
  ],

  rules: {
    cardsOffered: 3,
    earlyStart: { windowSeconds: 20, maxBonus: { itemId: "iron_ingot", qty: 4 } },
    refund: { buildBreak: 1, wave: 0.5 },
    stars: { three: 0.9, two: 0.5 },
    maxLabs: 3,
  },

  maps: [
    {
      id: "scrapyard_1",
      name: "Scrapyard 1 — First Feed",
      width: 9,
      rows: [
        "....S....", // 0  spawn
        "....P....", // 1
        "II..P..CC", // 2
        "II..P..CC", // 3
        ".PPPP....", // 4
        ".P.......", // 5
        ".P...#...", // 6
        ".P...#.II", // 7
        ".P.....II", // 8
        ".PPPPPPP.", // 9
        "CC.....P.", // 10
        "CC.....P.", // 11
        ".......B.", // 12 bridge: links may cross here
        ".......P.", // 13
        "II.....P.", // 14
        ".......X.", // 15 core
      ],
      path: [[4, 0], [4, 4], [1, 4], [1, 9], [7, 9], [7, 15]],
      coreHp: 100,
      startingStock: [{ itemId: "iron_ingot", qty: 20 }],
      // 15 waves (M1.3). Curve: 1–4 easy (the 20-ingot opening holds them), ramp from 5. Armoured (60% bullet
      // armour) restored in M1.4 now that research unlocks shells (armour-piercing); bullets alone struggle with them.
      //
      // mini-bosses on 5 and 10, boss on 15. Tuned against tests/waves.test.ts.
      waves: [
        { number: 1, groups: [{ enemyId: "walker", count: 4, spacing: 2.5 }] },
        { number: 2, groups: [{ enemyId: "walker", count: 6, spacing: 2 }] },
        { number: 3, groups: [{ enemyId: "swarmer", count: 8, spacing: 0.8 }] },
        { number: 4, groups: [{ enemyId: "walker", count: 5, spacing: 2.5 }, { enemyId: "swarmer", count: 4, spacing: 0.8, delay: 6 }] },
        { number: 5, groups: [{ enemyId: "walker", count: 6, spacing: 1.5 }, { enemyId: "brute", count: 1, spacing: 1, delay: 6 }] },
        { number: 6, groups: [{ enemyId: "walker", count: 10, spacing: 1.2 }, { enemyId: "swarmer", count: 6, spacing: 0.5, delay: 8 }] },
        { number: 7, groups: [{ enemyId: "swarmer", count: 12, spacing: 0.4 }, { enemyId: "armoured", count: 2, spacing: 4, delay: 3 }] },
        { number: 8, groups: [{ enemyId: "walker", count: 14, spacing: 1 }] },
        { number: 9, groups: [{ enemyId: "walker", count: 8, spacing: 1.2 }, { enemyId: "swarmer", count: 10, spacing: 0.5, delay: 6 }] },
        { number: 10, groups: [{ enemyId: "walker", count: 6, spacing: 1.5 }, { enemyId: "brute", count: 2, spacing: 8, delay: 4 }] },
        { number: 11, groups: [{ enemyId: "walker", count: 12, spacing: 1.1 }, { enemyId: "armoured", count: 3, spacing: 4, delay: 5 }] },
        { number: 12, groups: [{ enemyId: "swarmer", count: 16, spacing: 0.4 }, { enemyId: "walker", count: 8, spacing: 1.2, delay: 5 }] },
        { number: 13, groups: [{ enemyId: "walker", count: 14, spacing: 1 }, { enemyId: "armoured", count: 4, spacing: 4, delay: 6 }] },
        { number: 14, groups: [{ enemyId: "walker", count: 12, spacing: 1 }, { enemyId: "swarmer", count: 14, spacing: 0.4, delay: 5 }, { enemyId: "brute", count: 2, spacing: 6, delay: 12 }] },
        { number: 15, groups: [{ enemyId: "boss", count: 1, spacing: 1 }, { enemyId: "walker", count: 8, spacing: 2, delay: 4 }, { enemyId: "armoured", count: 3, spacing: 5, delay: 10 }] },
      ],
    },
  ],
};

export const biome1 = validateContent(raw);

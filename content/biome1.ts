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
    { id: "extractor", name: "Extractor", kind: "extractor", inputPorts: 0, bufferSize: 10, needsPower: false, buildCost: [], extractRate: 1 },
    { id: "smelter", name: "Smelter", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 2 }] },
    { id: "press", name: "Press", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 4 }] },
    { id: "coal_mill", name: "Coal mill", kind: "processor", inputPorts: 1, bufferSize: 10, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 2 }] },
    { id: "assembler", name: "Assembler", kind: "assembler", inputPorts: 3, bufferSize: 20, needsPower: true, buildCost: [{ itemId: "iron_ingot", qty: 4 }] },
    { id: "hub", name: "Hub", kind: "hub", inputPorts: 3, outputPorts: 3, bufferSize: 50, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 2 }] },
    { id: "generator", name: "Generator", kind: "generator", inputPorts: 1, bufferSize: 10, needsPower: false, buildCost: [{ itemId: "iron_ingot", qty: 3 }], fuel: { itemId: "coal", secondsPerItem: 4 }, powerRadius: 3 },
    { id: "lab", name: "Lab", kind: "lab", inputPorts: 1, bufferSize: 20, needsPower: true, buildCost: [{ itemId: "plate", qty: 6 }] },
  ],

  // output/s = qty / time (speed 1)
  recipes: [
    { id: "smelt_iron", buildingId: "smelter", inputs: [{ itemId: "iron_ore", qty: 2 }], outputs: [{ itemId: "iron_ingot", qty: 1 }], time: 2 }, // 0.5/s
    { id: "press_plate", buildingId: "press", inputs: [{ itemId: "iron_ingot", qty: 1 }], outputs: [{ itemId: "plate", qty: 2 }], time: 4, unlockedBy: "press_plates" }, // 0.5/s
    { id: "mill_powder", buildingId: "coal_mill", inputs: [{ itemId: "coal", qty: 1 }], outputs: [{ itemId: "powder", qty: 2 }], time: 2 }, // 1/s
    { id: "make_bullets", buildingId: "assembler", inputs: [{ itemId: "iron_ingot", qty: 1 }], outputs: [{ itemId: "bullets", qty: 4 }], time: 2 }, // 2/s
    { id: "make_shells", buildingId: "assembler", inputs: [{ itemId: "plate", qty: 1 }, { itemId: "powder", qty: 2 }], outputs: [{ itemId: "shells", qty: 2 }], time: 3, unlockedBy: "cannon_shells" },
    { id: "make_red_pack", buildingId: "assembler", inputs: [{ itemId: "iron_ingot", qty: 1 }, { itemId: "coal", qty: 1 }], outputs: [{ itemId: "red_pack", qty: 1 }], time: 5 },
  ],

  linkTiers: [
    { tier: 1, itemsPerSecond: 2, maxLength: 6 },
    { tier: 2, itemsPerSecond: 4, maxLength: 9 },
    { tier: 3, itemsPerSecond: 8, maxLength: 9 },
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
  ],

  research: [
    { id: "press_plates", name: "Press + plates", branch: "industry", tier: 1, cost: [{ itemId: "red_pack", qty: 10 }], time: 20 },
    { id: "links_t2", name: "Tier 2 links", branch: "logistics", tier: 1, cost: [{ itemId: "red_pack", qty: 15 }], time: 25 },
    { id: "cannon_shells", name: "Cannon + shells", branch: "arsenal", tier: 1, cost: [{ itemId: "red_pack", qty: 20 }], time: 30, requires: ["press_plates"] },
    { id: "gen_efficiency", name: "Generator efficiency", branch: "power", tier: 1, cost: [{ itemId: "red_pack", qty: 10 }], time: 20 },
  ],

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
      waves: [
        { number: 1, groups: [{ enemyId: "walker", count: 6, spacing: 1.5 }] },
        { number: 2, groups: [{ enemyId: "walker", count: 10, spacing: 1.2 }] },
        { number: 3, groups: [{ enemyId: "swarmer", count: 12, spacing: 0.4 }] },
        { number: 4, groups: [{ enemyId: "walker", count: 10, spacing: 1 }, { enemyId: "swarmer", count: 10, spacing: 0.4, delay: 6 }] },
        { number: 5, groups: [{ enemyId: "walker", count: 8, spacing: 1 }, { enemyId: "armoured", count: 2, spacing: 4, delay: 4 }] },
      ],
    },
  ],
};

export const biome1 = validateContent(raw);

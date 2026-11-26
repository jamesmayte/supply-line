/**
 * Scripted builds for scrapyard_1: the M0.6 interlock runs. Shared by tests/interlock.test.ts and the
 * harness demo, so what you watch on the phone is exactly what the test asserts on.
 * A script maps a game tick to the commands applied on that tick.
 */
import type { GameInput } from "../core/game";

/*
 * Shared build (ids from 1, in order): power, chain A, a hub, and three Gunners covering the path,
 * each fed from the hub by a tier-2 link. Three Gunners can fire 9/s, more than either factory makes,
 * so ammo, not tower count, is the limit.
 */
export const GUNS = [7, 8, 9];
const COMMON: GameInput[] = [
  { type: "place", buildingId: "extractor", x: 7, y: 3 }, // 1 coal
  { type: "place", buildingId: "generator", x: 7, y: 4 }, // 2 powers y 1..7
  { type: "place", buildingId: "extractor", x: 7, y: 7 }, // 3 iron
  { type: "place", buildingId: "smelter", x: 6, y: 7 }, // 4
  { type: "place", buildingId: "assembler", x: 6, y: 6, recipeId: "make_bullets" }, // 5
  { type: "place", buildingId: "hub", x: 7, y: 5 }, // 6
  { type: "placeTower", towerId: "gunner", x: 6, y: 8 }, // 7
  { type: "placeTower", towerId: "gunner", x: 4, y: 8 }, // 8
  { type: "placeTower", towerId: "gunner", x: 3, y: 7 }, // 9 (6 tiles from the hub: tier-1 reach)
  { type: "link", from: 1, to: 2 }, // 10
  { type: "link", from: 3, to: 4 }, // 11
  { type: "link", from: 4, to: 5 }, // 12
  { type: "link", from: 5, to: 6 }, // 13
  ...GUNS.map((g): GameInput => ({ type: "link", from: 6, to: g, itemId: "bullets" })), // 14..16 (tier 1: no research yet)
];

/** A script: commands to apply on a given tick of the build break. */
export type Script = Record<number, GameInput[]>;

/** Run A: one chain, 2 bullets/s. */
export const RUN_A: Script = { 0: COMMON };

/** Run B: bank ingots in the hub, then buy a second chain into the same hub (4 bullets/s). */
const BANK = COMMON.map((c): GameInput => (c.type === "link" && c.from === 4 && c.to === 5 ? { type: "link", from: 4, to: 6 } : c)); // link 12: smelter → hub
export const EXPAND_TICK = 210; // ~9 ingots banked by 21 s
export const RUN_B: Script = {
  0: BANK,
  [EXPAND_TICK]: [
    { type: "unlink", linkId: 12 },
    { type: "link", from: 4, to: 5 }, // 17: smelter → assembler, as in run A
    { type: "place", buildingId: "extractor", x: 8, y: 3 }, // 18 coal
    { type: "place", buildingId: "generator", x: 8, y: 5 }, // 19 powers y 2..8 (3 ingots)
    { type: "place", buildingId: "extractor", x: 8, y: 8 }, // 20 iron
    { type: "place", buildingId: "smelter", x: 5, y: 8 }, // 21 (2 ingots)
    { type: "place", buildingId: "assembler", x: 7, y: 6, recipeId: "make_bullets" }, // 22 (4 ingots)
    { type: "link", from: 18, to: 19 },
    { type: "link", from: 20, to: 21 },
    { type: "link", from: 21, to: 22 },
    { type: "link", from: 22, to: 6 },
  ],
};

import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { checkMap, recipeRate, validateContent } from "../content/schema";

const recipe = (id: string) => biome1.recipes.find((r) => r.id === id)!;
const building = (id: string) => biome1.buildings.find((b) => b.id === id)!;

describe("biome 1 content", () => {
  it("validates", () => {
    expect(biome1.maps.length).toBeGreaterThan(0);
  });

  it("starter chain delivers 1 ore/s -> 0.5 ingot/s -> 2 bullets/s, limited by the extractor (M1.6)", () => {
    const ore = building("extractor").extractRate!;
    expect(ore).toBe(1);
    const smelt = recipe("smelt_iron"), bullets = recipe("make_bullets");
    const ingot = ore / smelt.inputs[0]!.qty; // what one extractor's ore makes
    expect(ingot).toBe(0.5);
    expect(ingot * bullets.outputs[0]!.qty).toBe(2);
    // every later stage has headroom, so speeding up the bottleneck always helps (no perfect balance)
    expect(smelt.inputs[0]!.qty / smelt.time).toBeGreaterThan(ore);
    expect(bullets.inputs[0]!.qty / bullets.time).toBeGreaterThan(ingot);
    expect(biome1.linkTiers.find((t) => t.tier === 1)!.itemsPerSecond).toBeGreaterThan(ingot * bullets.outputs[0]!.qty);
  });

  it("a starter Gunner is underfed by one chain (the core tension)", () => {
    const gunner = biome1.towers.find((t) => t.id === "gunner")!;
    expect(gunner.fireRate).toBeGreaterThan(recipeRate(recipe("make_bullets"), building("assembler")));
  });

  it("map 1 path is valid", () => {
    expect(checkMap(biome1.maps[0]!)).toEqual([]);
  });
});

describe("validation catches bad edits", () => {
  const clone = () => structuredClone(biome1) as any;

  it("unknown item in a recipe", () => {
    const c = clone();
    c.recipes[0].inputs[0].itemId = "unobtainium";
    expect(() => validateContent(c)).toThrow(/unknown item 'unobtainium'/);
  });

  it("recipe with more inputs than the building has ports", () => {
    const c = clone();
    c.recipes[0].inputs.push({ itemId: "coal", qty: 1 });
    expect(() => validateContent(c)).toThrow(/ports/);
  });

  it("path that leaves the path tiles", () => {
    const c = clone();
    c.maps[0].path[1] = [4, 5];
    expect(() => validateContent(c)).toThrow(/path/);
  });

  it("ragged map row", () => {
    const c = clone();
    c.maps[0].rows[3] = "II..P..C";
    expect(() => validateContent(c)).toThrow(/width/);
  });
});

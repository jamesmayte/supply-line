import { describe, expect, it } from "vitest";
import { biome1 } from "../content/biome1";
import { checkMap, recipeRate, validateContent } from "../content/schema";

const recipe = (id: string) => biome1.recipes.find((r) => r.id === id)!;
const building = (id: string) => biome1.buildings.find((b) => b.id === id)!;

describe("biome 1 content", () => {
  it("validates", () => {
    expect(biome1.maps.length).toBeGreaterThan(0);
  });

  it("matches the spec's starter chain: 1 ore/s -> 0.5 ingot/s -> 2 bullets/s", () => {
    expect(building("extractor").extractRate).toBe(1);
    expect(recipeRate(recipe("smelt_iron"), building("smelter"))).toBe(0.5);
    expect(recipeRate(recipe("make_bullets"), building("assembler"))).toBe(2);
    // smelter consumes exactly what one extractor makes
    const r = recipe("smelt_iron");
    expect(r.inputs[0]!.qty / r.time).toBe(1);
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

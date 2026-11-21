import { describe, expect, it } from "vitest";
import { nextRandom } from "../core/rng";

describe("seeded rng", () => {
  it("is deterministic for a seed", () => {
    const run = (seed: number) => {
      let s = seed;
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = nextRandom(s);
        out.push(r.value);
        s = r.state;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
    for (const v of run(42)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

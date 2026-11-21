/**
 * Seeded RNG (mulberry32). The ONLY source of randomness allowed in /core.
 * State is a plain number so it can live inside the sim state and be hashed.
 */
export type RngState = number;

export function nextRandom(state: RngState): { value: number; state: RngState } {
  let t = (state + 0x6d2b79f5) | 0;
  const nextState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: nextState };
}

/**
 * Seeded pseudo-random number generator utilities.
 */

/**
 * Creates a Mulberry32 PRNG from a 32-bit seed.
 *
 * @param seed - Unsigned 32-bit seed value.
 * @returns A function that returns floats in [0, 1).
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns an inclusive integer in [min, max] using the given RNG.
 *
 * @param rng - Float generator in [0, 1).
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns A random integer in the range.
 */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

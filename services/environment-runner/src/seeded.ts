/**
 * @tradrl/environment-runner — deterministic seeded randomness.
 *
 * The reference world dynamics (StubEnvironment) derive every synthetic
 * value from the episode's SEED (L9: reproducible lineage): the same
 * spec+seed always produces the same value stream. The derivation is
 * STATELESS per draw — each value is a pure function of
 * (seed, episode, draw-index) — so the stream is deterministic regardless
 * of call order, and replaying any suffix of an episode reproduces exactly
 * the values the world would have produced.
 *
 * Algorithm: FNV-1a 32-bit over the draw key, then one round of the
 * public-domain mulberry32 generator. Zero dependencies, no wall clock.
 */

/** A deterministic uniform draw in [0, 1). */
export type SeededRandom = () => number;

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a sequential deterministic generator from a seed string (mulberry32
 * keyed by the FNV-1a hash of the seed). The SAME seed always yields the
 * SAME sequence.
 */
export function createSeededRandom(seed: string): SeededRandom {
  let state = fnv1a32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One stateless deterministic draw in [0, 1), keyed by (seed, scope, index):
 * `stubDraw('seed-alpha-1', 'ep-123', 7)`. Pure — no generator state is
 * retained between calls, so the value stream is order-independent.
 */
export function seededDraw(seed: string, scope: string, index: number): number {
  return createSeededRandom(`${seed}|${scope}|${index}`)();
}

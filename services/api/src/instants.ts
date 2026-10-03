// @tradrl/api-service — the injected instant source (the no-ambient-clock law).
//
// STRUCTURAL MIRROR of services/execution-gateway/src/ports.ts's
// InstantSource (T040) — the boundary never reads `Date.now()`; time
// arrives through this injected source. Each request consumes
// EXACTLY ONE instant (the request instant — the anchor for the rate
// window, the usage record and the audit record).

/** The host-injected instant source: each request consumes exactly ONE instant. */
export interface InstantSource {
  /** The next request instant (epoch ms; monotonic — a regression is a host error). */
  next(): number;
}

/**
 * The scripted instant source (the deterministic tests' clock): a
 * fixed list consumed in order; exhaustion fails loudly (a scripted
 * scenario that under-provisions instants is a test-authoring error,
 * never a silent reuse). Mirror of T040's scriptedInstants.
 */
export interface ScriptedInstants extends InstantSource {
  /** How many instants remain unconsumed. */
  remaining(): number;
}

/** Build a scripted instant source over an explicit, non-decreasing list. */
export function scriptedInstants(instants: readonly number[]): ScriptedInstants {
  if (instants.length === 0) throw new Error('scriptedInstants requires at least one instant');
  for (let index = 1; index < instants.length; index++) {
    if ((instants[index] as number) < (instants[index - 1] as number)) {
      throw new Error(`scriptedInstants requires a non-decreasing sequence (position ${index} regresses)`);
    }
  }
  let cursor = 0;
  return {
    next(): number {
      if (cursor >= instants.length) {
        throw new Error(`scriptedInstants exhausted after ${instants.length} instants — the scenario under-provisions the clock`);
      }
      const value = instants[cursor] as number;
      cursor += 1;
      return value;
    },
    remaining(): number {
      return instants.length - cursor;
    },
  };
}

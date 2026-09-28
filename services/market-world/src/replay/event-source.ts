/**
 * @tradrl/market-world (service) — the pure event source interface.
 *
 * Work order T009: the replay service is constructed from a world config +
 * an event source that is a PURE async iterator/generator of event batches.
 * NO I/O lives in this Work Order — fixture streams only; real data sources
 * (providers, files, the event store) are T008's territory and will adapt to
 * this same shape.
 *
 * CONSUMER CONTRACT (the discipline that keeps replay deterministic):
 *   - A source yields BATCHES (arrays) of UNTRUSTED event records; the world
 *     validates every record through its own mirrored guards (the stream IN).
 *   - A source is FINITE and REPLAYABLE: creating it twice from the same
 *     fixture yields the identical batch sequence (resume re-pulls and
 *     verifies a digest chain before continuing).
 *   - Batch order is significant (arrival order — the recorded stream order).
 */

/** A pure source of recorded event batches (async iterable; no I/O in this WO). */
export interface ReplayEventSource {
  [Symbol.asyncIterator](): AsyncIterator<readonly unknown[], undefined, undefined>;
}

/** Runtime guard: an object exposing an async iterator of event batches. */
export function isReplayEventSource(value: unknown): value is ReplayEventSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { [Symbol.asyncIterator]?: unknown };
  return typeof candidate[Symbol.asyncIterator] === 'function';
}

/**
 * Adapt any `AsyncIterable` of event batches into a {@link ReplayEventSource}
 * (an async generator already satisfies the interface structurally; this
 * helper exists for adapters over other shapes).
 */
export function asReplayEventSource(iterable: AsyncIterable<readonly unknown[]>): ReplayEventSource {
  return iterable as ReplayEventSource;
}

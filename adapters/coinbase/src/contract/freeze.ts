/**
 * @tradrl/adapter-coinbase — deep freezing of adapter records.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/freeze.ts (law D-004:
 * never imports). Everything the adapter hands out — the source
 * descriptor, mapping tables, entitlement envelope, rate/quota envelopes,
 * health thresholds, emitted canonical events, feasibility reports,
 * errors — is deep-frozen BY DEFENSE: a consumer that tries to mutate a
 * shared record fails immediately (strict mode throws) instead of
 * silently corrupting lineage-bearing data (L9).
 *
 * Pure: freezes in place and returns the same reference. Arrays, plain
 * objects and nested combinations are frozen recursively; primitives and
 * already-frozen values pass through unchanged.
 */

/** A value deeply frozen: every nested object/array is read-only. */
export type DeepFrozen<T> = T extends readonly (infer U)[]
  ? Readonly<DeepFrozen<U>>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepFrozen<T[K]> }
    : T;

/**
 * Recursively freeze a record. Returns the SAME reference, now deeply
 * frozen. Cycles are handled (already-seen objects are skipped); freezing
 * an already-frozen graph is a no-op.
 */
export function deepFreeze<T>(value: T): DeepFrozen<T> {
  const seen = new Set<unknown>();
  const freezeNode = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Object.isFrozen(node)) return; // assume deep-frozen already
    for (const key of Object.keys(node)) {
      freezeNode((node as Record<string, unknown>)[key]);
    }
    Object.freeze(node);
  };
  freezeNode(value);
  return value as DeepFrozen<T>;
}

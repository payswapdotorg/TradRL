/**
 * @tradrl/adapter-equities — deep freezing of SDK records.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/freeze.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). Everything the adapter hands out — the source descriptor, mapping
 * tables, entitlement envelopes, rate/quota envelopes, health thresholds,
 * the declared domain laws (calendar/embargo/window-release), emitted
 * canonical events, feasibility reports, errors — is deep-frozen BY
 * DEFENSE: a consumer that tries to mutate a shared record fails
 * immediately instead of silently corrupting lineage-bearing data (L9).
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

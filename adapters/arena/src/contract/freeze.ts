/**
 * @tradrl/adapter-arena — deep freezing.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/freeze.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). Every declared record this adapter
 * mints is deeply frozen (immutable evidence).
 */

/** A value that has been recursively frozen. */
export type DeepFrozen<T> = T;

/** Recursively freezes a JSON-compatible value (the returned record is immutable). */
export function deepFreeze<T>(value: T): T {
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach((member) => deepFreeze(member));
    Object.freeze(value);
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
      Object.freeze(value);
    }
  }
  return value;
}

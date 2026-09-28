/**
 * @tradrl/time-engine/knowledge — deep freezing for knowledge records.
 *
 * Knowledge records are immutable once validated (the append-only store is a
 * L9 lineage guarantee: a record that could mutate after being policed would
 * make every audit decision stale). This module mirrors the deep-freeze
 * discipline of `@tradrl/agent-body`'s primitives (structural mirror per
 * D-004 — no package edge, zero runtime deps): an iterative, cycle-safe,
 * already-frozen-skipping traversal.
 *
 * `Object.freeze` is shallow per object; `deepFreeze` walks the reachable
 * object graph. Brand types, primitives and `null` pass through untouched.
 */

/**
 * Deeply freeze a value: every reachable plain object and array becomes
 * `Object.isFrozen`. Already-frozen branches are skipped, so cycles terminate
 * and shared frozen substructures cost nothing. Returns the same reference.
 */
export function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return value;
}

/**
 * `true` when every reachable plain object and array of the value is
 * `Object.isFrozen`. The runtime guard behind "append-only, immutable
 * knowledge": a record or base that is not deeply frozen fails this check.
 * Functions and primitives are trivially frozen for this purpose.
 */
export function isDeeplyFrozen(value: unknown): boolean {
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue; // cycle-safe: re-visiting an already-verified node is fine
    seen.add(current);
    if (!Object.isFrozen(current)) return false;
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return true;
}

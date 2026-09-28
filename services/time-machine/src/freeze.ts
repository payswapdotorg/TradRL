/**
 * @tradrl/time-machine — deep freezing (Work Order T029).
 *
 * Structural mirror of the freeze discipline used by
 * `@tradrl/time-engine/knowledge` (T026) and `@tradrl/agent-body` (law
 * D-004: no package edge; identical semantics). An iterative, cycle-safe,
 * already-frozen-skipping traversal: records, views, receipts, audit logs
 * and snapshots are EVIDENCE and IMMUTABLE STATE — a record that could
 * mutate after being policed would make every as-of decision stale (L9
 * lineage stability by construction).
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
 * knowledge": a record, view or snapshot that is not deeply frozen fails
 * this check. Cycle-safe (re-visiting an already-verified node is fine).
 */
export function isDeeplyFrozen(value: unknown): boolean {
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
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

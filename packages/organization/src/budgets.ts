/**
 * @tradrl/organization — resource budgets for the organization search.
 *
 * Spec anchor — spec/ARCHITECTURE.md, "Organization compiler", VERBATIM:
 * "Given goals, constraints, market/data universe and RESOURCE BUDGETS,
 * discover agent count, specializations, body/model assignments, ..."
 * The budgets are EXPLICIT input limits the search must respect: every
 * budget violation on a candidate is a typed, structured rejection reason
 * (`budget-exceeded` with the axis, the measurement and the budget), so
 * budget enforcement is auditable, never implicit.
 *
 * The budgets also bound the search itself (`maxEnumeratedCandidates`,
 * `retainLimitK`) — the DECLARED retain-top-k-with-full-history law of the
 * reference strategy: k candidates are retained, the REST ARE RETAINED AS
 * REJECTED RECORDS (L11 — the search history is preserved, never pruned).
 */

import {
  deepFreeze,
  isPositiveInteger,
  isRecord,
} from './primitives';
import { type OrgResult, invalidField, invalidType } from './errors';

/**
 * The resource budgets and search bounds. All limits are positive
 * integers; `retainLimitK` is the retention window (the proposed
 * candidate is always retained IN ADDITION to the window when it is not
 * inside it — the window governs the `retained` disposition count).
 */
export interface CompileBudgets {
  /** Maximum agent count a blueprint may declare (>= 1). */
  readonly maxAgents: number;
  /** Maximum compute units a candidate may measure (>= 1). */
  readonly maxComputeUnits: number;
  /** Maximum topology wires a candidate may measure (>= 1). */
  readonly maxCoordinationWires: number;
  /** Maximum p95 latency (ms) a candidate may measure (>= 1). */
  readonly maxLatencyMs: number;
  /** Maximum candidates the search may enumerate (>= 1) — the search bound. */
  readonly maxEnumeratedCandidates: number;
  /** Retention window: how many non-proposed candidates are dispositioned `retained` (>= 1). */
  readonly retainLimitK: number;
}

/** Guard: `CompileBudgets`. */
export function isCompileBudgets(v: unknown): v is CompileBudgets {
  if (!isRecord(v)) return false;
  return (
    isPositiveInteger(v.maxAgents) &&
    isPositiveInteger(v.maxComputeUnits) &&
    isPositiveInteger(v.maxCoordinationWires) &&
    isPositiveInteger(v.maxLatencyMs) &&
    isPositiveInteger(v.maxEnumeratedCandidates) &&
    isPositiveInteger(v.retainLimitK)
  );
}

/**
 * Validates compile budgets (typed errors; collect-all over the six
 * limits). All limits must be positive integers — a zero or negative
 * budget is not a budget, it is a malformed input.
 */
export function validateCompileBudgets(v: unknown): OrgResult<CompileBudgets> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType('budgets must be an object')] };
  }
  const errors: ReturnType<typeof invalidField>[] = [];
  for (const limit of [
    'maxAgents',
    'maxComputeUnits',
    'maxCoordinationWires',
    'maxLatencyMs',
    'maxEnumeratedCandidates',
    'retainLimitK',
  ] as const) {
    if (!isPositiveInteger(v[limit])) {
      errors.push(invalidField(limit, 'must be an integer >= 1'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(v as unknown as CompileBudgets) }) };
}

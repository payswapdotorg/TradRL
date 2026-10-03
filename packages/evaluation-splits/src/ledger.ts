/**
 * @tradrl/evaluation-splits — the SPLIT PLAN LEDGER (Work Order T032):
 * the append-only, chain-verified history of materialized split plans.
 *
 * Spec anchors: ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to expose selection effects" — the split plans a
 * benchmark ran under are part of that history), L9 ("Reproducible
 * lineage" — the chain binds every appended plan in order), L12 ("Tenant
 * isolation" — the ledger is tenant/project scoped; plans themselves are
 * tenant-free DERIVED content, the T031 SplitDefinition/SplitRegistry
 * precedent), L4 (injected instants — every append carries the caller's
 * instant; nothing reads a clock).
 *
 * THE APPEND-ONLY LAW: the ledger's entry list grows ONLY through
 * {@link appendPlan}. There is no update, removal or reordering API
 * anywhere in this package (structurally tested). A plan id is ONE entry —
 * re-appending a content address fails `duplicate_plan`.
 *
 * THE CHAIN LAW (L9/L11): every ledger carries a `chain_head` binding the
 * ledger binding block (tenant, project) and EVERY appended plan, in
 * append order:
 *
 *     h(-1)  = digest(canonical(binding))
 *     h(i)   = digest("h(i-1)" + ":" + digest(canonical(plan)))
 *     head   = h(entries.length - 1)
 *
 * {@link verifyPlanLedger} recomputes the whole chain; ANY tamper — a
 * mutated field, a REORDERED log, or a REMOVED (hidden) plan — breaks the
 * head and fails `chain_mismatch`.
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { isProjectId, isSplitPlanId, isSplitPlanLedgerId, isTenantId } from './ids';
import type { ProjectId, SplitPlanLedgerId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type SplitDriverError, type SplitDriverResult } from './errors';
import { verifySplitPlan } from './plan';
import type { SplitPlan } from './plan';

// ---------------------------------------------------------------------------
// The ledger shapes
// ---------------------------------------------------------------------------

/** The ledger binding block: the scope every appended plan runs under (L12). */
export interface SplitPlanLedgerBinding {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** One appended ledger entry: the plan plus its INJECTED recording instant (L4). */
export interface SplitPlanLedgerEntry {
  readonly plan: SplitPlan;
  readonly recorded_at: TimestampMs;
}

/** The append-only, chain-verified split plan ledger. */
export interface SplitPlanLedger {
  /** Derived identity: `splr:<digest over the canonical binding>`. */
  readonly ledger_id: SplitPlanLedgerId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly SplitPlanLedgerEntry[];
  readonly chain_head: string;
}

/** Guard: `SplitPlanLedgerEntry`. */
export function isSplitPlanLedgerEntry(value: unknown): value is SplitPlanLedgerEntry {
  if (!isRecord(value)) return false;
  if (!isRecord(value.plan) || !isSplitPlanId((value.plan as { plan_id?: unknown }).plan_id)) return false;
  return isTimestampMs(value.recorded_at);
}

/** Guard: `SplitPlanLedger` (structural; the chain law is enforced by {@link verifyPlanLedger}). */
export function isSplitPlanLedger(value: unknown): value is SplitPlanLedger {
  if (!isRecord(value)) return false;
  if (typeof value.ledger_id !== 'string' || !isSplitPlanLedgerId(value.ledger_id)) return false;
  if (!isTenantId(value.tenant) || !isProjectId(value.project)) return false;
  if (!Array.isArray(value.entries)) return false;
  if (!(value.entries as readonly unknown[]).every((entry) => isSplitPlanLedgerEntry(entry))) return false;
  return typeof value.chain_head === 'string' && /^[0-9a-f]{16}$/.test(value.chain_head);
}

// ---------------------------------------------------------------------------
// The chain law (identical derivation shape to the search-lineage chain)
// ---------------------------------------------------------------------------

function bindingJson(binding: SplitPlanLedgerBinding): JsonObject {
  return { tenant: binding.tenant, project: binding.project };
}

/** The ledger's derived identity: `splr:<digest over tenant/project>`. */
export function splitPlanLedgerId(binding: SplitPlanLedgerBinding): SplitPlanLedgerId {
  return `splr:${stableDigestJson(bindingJson(binding))}` as SplitPlanLedgerId;
}

/** The chain genesis: digest(canonical(binding)). */
export function planChainGenesis(binding: SplitPlanLedgerBinding): string {
  return stableDigestJson(bindingJson(binding));
}

/** The chain fold: digest(prev + ":" + digest(plan)). */
export function planChainFold(previousHead: string, plan: SplitPlan): string {
  return stableDigest(`${previousHead}:${stableDigestJson(plan as unknown as JsonObject)}`);
}

/** The chain head recomputation over a binding and an entry sequence. */
export function computePlanChainHead(binding: SplitPlanLedgerBinding, plans: readonly SplitPlan[]): string {
  let head = planChainGenesis(binding);
  for (const plan of plans) head = planChainFold(head, plan);
  return head;
}

// ---------------------------------------------------------------------------
// Construction + append (the only mutation API — append-only)
// ---------------------------------------------------------------------------

/** Construct an open split plan ledger (no appended plans). */
export function createPlanLedger(value: unknown): SplitDriverResult<SplitPlanLedger> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('ledger input must be an object')] };
  }
  const errors: SplitDriverError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (Array.isArray(value.entries) && value.entries.length > 0) {
    errors.push(invalidField('entries', 'createPlanLedger builds an OPEN ledger; use appendPlan to grow it'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const binding: SplitPlanLedgerBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  return ok(
    deepFreeze({
      ledger_id: splitPlanLedgerId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries: [],
      chain_head: planChainGenesis(binding),
    } satisfies SplitPlanLedger),
  );
}

/**
 * Append one materialized split plan (the ONLY mutation API — the ledger is
 * append-only). The plan is VERIFIED first (structural laws + the content
 * address, `plan_mismatch` on disagreement); the recording instant is
 * INJECTED (L4) and must not rewind the log (`invalid_ledger`); a plan id
 * already appended fails `duplicate_plan` (one id, one entry — L11: no
 * rewrites). Returns a NEW ledger; the original is untouched.
 */
export function appendPlan(ledger: SplitPlanLedger, input: unknown): SplitDriverResult<SplitPlanLedger> {
  if (!isSplitPlanLedger(ledger)) {
    return { ok: false, errors: [invalidType('ledger must be a split plan ledger')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('append input must be an object')] };
  }
  if (input.plan === undefined) {
    return { ok: false, errors: [missingField('plan')] };
  }
  const planResult = verifySplitPlan(input.plan);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  if (input.recorded_at === undefined) {
    return { ok: false, errors: [missingField('recorded_at')] };
  }
  if (!isTimestampMs(input.recorded_at)) {
    return { ok: false, errors: [invalidField('recorded_at', 'must be a valid TimestampMs (the injected recording instant, L4)')] };
  }
  const recordedAt = input.recorded_at as TimestampMs;

  const lastEntry = ledger.entries[ledger.entries.length - 1];
  if (lastEntry !== undefined && recordedAt < lastEntry.recorded_at) {
    return fail(
      'invalid_ledger',
      `recording instant ${recordedAt} precedes the previous append's ${lastEntry.recorded_at} — the ledger is ordered (L4)`,
      'recorded_at',
    );
  }
  for (const entry of ledger.entries) {
    if (entry.plan.plan_id === plan.plan_id) {
      return fail(
        'duplicate_plan',
        `plan "${plan.plan_id}" is already appended — one id, one entry; the ledger is append-only and never rewrites (L11)`,
        'plan.plan_id',
      );
    }
  }

  const binding: SplitPlanLedgerBinding = { tenant: ledger.tenant, project: ledger.project };
  const entries: SplitPlanLedgerEntry[] = [...ledger.entries, deepFreeze({ plan, recorded_at: recordedAt })];
  return ok(
    deepFreeze({
      ledger_id: ledger.ledger_id,
      tenant: ledger.tenant,
      project: ledger.project,
      entries,
      chain_head: computePlanChainHead(binding, entries.map((entry) => entry.plan)),
    } satisfies SplitPlanLedger),
  );
}

// ---------------------------------------------------------------------------
// Verification (the chain law, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Verify a split plan ledger end-to-end: the binding's derived identity (a
 * forged `ledger_id` fails `chain_mismatch`), every entry's plan (structural
 * + content address), the log-level laws (unique plan ids, monotone
 * instants) and the CHAIN — the recomputed head over the plans AS STORED
 * must equal the recorded head; mutation, reordering and HIDING all break
 * it (`chain_mismatch`). On success the ledger is returned narrowed, deeply
 * frozen.
 */
export function verifyPlanLedger(value: unknown): SplitDriverResult<SplitPlanLedger> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('ledger must be an object')] };
  }
  const errors: SplitDriverError[] = [];
  for (const field of ['tenant', 'project'] as const) {
    if (value[field] === undefined) errors.push(missingField(field));
  }
  if (value.ledger_id === undefined) errors.push(missingField('ledger_id'));
  else if (!isSplitPlanLedgerId(value.ledger_id)) errors.push(invalidField('ledger_id', 'must be a ledger id ("splr:<digest>")'));
  if (value.chain_head === undefined) errors.push(missingField('chain_head'));
  else if (typeof value.chain_head !== 'string' || !/^[0-9a-f]{16}$/.test(value.chain_head)) {
    errors.push(invalidField('chain_head', 'must be a 16-hex digest'));
  }
  if (value.entries === undefined) errors.push(missingField('entries'));
  else if (!Array.isArray(value.entries)) errors.push(invalidField('entries', 'must be an array of ledger entries'));
  if (errors.length > 0) return { ok: false, errors };

  const binding: SplitPlanLedgerBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.ledger_id !== splitPlanLedgerId(binding)) {
    return fail('chain_mismatch', `ledger_id "${value.ledger_id}" does not match the binding's derived identity (L9)`, 'ledger_id');
  }

  const seenPlanIds = new Set<string>();
  let previousInstant: TimestampMs | undefined;
  const plans: SplitPlan[] = [];
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const candidate = (value.entries as unknown[])[index];
    if (!isRecord(candidate)) {
      return { ok: false, errors: [invalidType(`entries[${index}] must be an object`)] };
    }
    if (candidate.plan === undefined || candidate.recorded_at === undefined) {
      return { ok: false, errors: [invalidField(`entries[${index}]`, 'must carry plan and recorded_at')] };
    }
    const planResult = verifySplitPlan(candidate.plan, `entries[${index}].plan`);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;
    if (!isTimestampMs(candidate.recorded_at)) {
      return { ok: false, errors: [invalidField(`entries[${index}].recorded_at`, 'must be a valid TimestampMs (L4)')] };
    }
    const recordedAt = candidate.recorded_at as TimestampMs;
    if (seenPlanIds.has(plan.plan_id)) {
      return fail('duplicate_plan', `plan "${plan.plan_id}" appears twice in the ledger (L11)`, `entries[${index}].plan.plan_id`);
    }
    seenPlanIds.add(plan.plan_id);
    if (previousInstant !== undefined && recordedAt < previousInstant) {
      return fail('invalid_ledger', `entry ${index} rewinds the log's instants (L4)`, `entries[${index}].recorded_at`);
    }
    previousInstant = recordedAt;
    plans.push(plan);
  }

  const expectedHead = computePlanChainHead(binding, plans);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or truncated (L9/L11)`,
      'chain_head',
    );
  }

  const entries: SplitPlanLedgerEntry[] = [];
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index] as SplitPlan;
    const recordedAt = (value.entries as readonly { recorded_at: TimestampMs }[])[index]?.recorded_at;
    entries.push(deepFreeze({ plan, recorded_at: recordedAt }) as SplitPlanLedgerEntry);
  }
  return ok(
    deepFreeze({
      ledger_id: value.ledger_id as SplitPlanLedgerId,
      tenant: binding.tenant,
      project: binding.project,
      entries,
      chain_head: expectedHead,
    } satisfies SplitPlanLedger),
  );
}

/** The canonical JSON bytes of a ledger (determinism anchor). */
export function canonicalPlanLedger(ledger: SplitPlanLedger): string {
  return canonicalJson(ledger as unknown as JsonObject);
}

// @tradrl/execution-policy — the ExecutionPolicy: the versioned hard-gate
// DECLARATION (the L8 existential law of this lane).
//
// spec/ARCHITECTURE.md Execution — VERBATIM: "Consequential actions
// require hard controls outside prompts: identity, authorization,
// limits, venue permissions, rate limits, kill switch, credentials and
// audit." spec/ARCHITECTURE-LOCK.md L8: "External execution authority:
// models cannot bypass hard risk/authorization gates."
//
// THE TOTALITY LAW (the Work Order: "L8 hard-control totality — the
// existential law: the ExecutionPolicy is a HARD GATE, not advice.
// Every consequential intent passes through a policy record whose
// checks are EXHAUSTIVE and MACHINE-ENUMERABLE ... A policy that omits
// a check dimension is a typed error (negative test) — the gate is
// total or it is not a gate."):
//
//   - The eight dimensions of the ARCHITECTURE.md sentence are a CLOSED,
//     machine-enumerable list (CHECK_DIMENSIONS): kill_switch, identity,
//     authorization, limits, venue_permissions, rate_limits,
//     credentials, audit. `validateExecutionPolicy` fails with
//     `check_dimension_missing` when ANY of them is absent from the
//     declaration — the negative test enumerates every dimension.
//   - Seven of them are PRE-TRADE CHECKS (they can refuse an intent);
//     their order is DECLARED by `checkOrder` — a full permutation of
//     PRE_TRADE_CHECK_KINDS, with the kill switch FIRST (validated:
//     "a standing switch record that refuses EVERYTHING when thrown"
//     structurally dominates — a policy that buries the kill switch
//     behind other checks fails with `invalid_check_order`).
//   - The eighth (audit) is the RECORD dimension: the policy declares
//     that EVERY decision emits an audit record, and the audit module
//     enforces it structurally (check-machine.ts + audit.ts).
//   - Empty permission/budget/binding collections are LEGAL but
//     fail-closed: every check refuses when it finds no matching
//     declaration (an empty venue allowlist permits nothing; an absent
//     rate budget refuses; an unbound venue has no credentials). The
//     crime the totality law forbids is the ABSENT DIMENSION, never the
//     empty-but-declared one.
//
// CREDENTIAL OPACITY: the policy binds venues to OPAQUE `cred:` refs;
// the collect-all validator runs the credential-value trip wire
// (credentials.ts) over the whole record — embedding a value under any
// credential-shaped key fails with `credential_value_present`.
//
// LEARNED POLICIES (T013 mirror): a policy may carry its learning
// lineage (trial/arm/trajectory refs — opaque mirrors of
// @tradrl/rl-protocol's identity spaces) so an execution policy
// produced by search binds into the RL bridge's trial lineage shapes
// without this lane importing them (the interop trip wire proves the
// binding).
//
// L9/L12: the policy is scoped to one tenant + project, versioned
// (immutable revisions — a change is a NEW VERSION), and
// content-addressed (`xpol:` + digest of the canonical content minus
// the id): the same declaration always yields the same id.
//
// DOWNSTREAM (the Work Order's design contract): T020 (risk policy
// engine) refines the LIMITS dimension — this record exposes the limit
// records it deepens; T040 (live execution authority) binds real
// venues — this record's venue permissions, credential refs and rate
// budgets are the shapes that gateway enforces. Design records those
// lanes can consume, not implementations of their semantics.

import { deepFreeze, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import { isCanonicalPositiveDecimal } from './decimals';
import {
  type ArmId,
  type AuthorityScopeRef,
  type CredentialRef,
  type ExecutionPolicyId,
  type InstrumentId,
  type KillSwitchId,
  type ProjectId,
  type TenantId,
  type TrajectoryId,
  type TrialId,
  type VenueId,
  isArmId,
  isAuthorityScopeRef,
  isCredentialRef,
  isInstrumentId,
  isKillSwitchId,
  isProjectId,
  isTenantId,
  isTrajectoryId,
  isTrialId,
  isVenueId,
  mintExecutionPolicyId,
} from './ids';
import type { OrderKind } from './strategy-mirror';
import { isOrderKind } from './strategy-mirror';
import { credentialValueViolations } from './credentials';
import {
  type ExecutionPolicyError,
  type ExecutionPolicyResult,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The check-dimension taxonomy (the closed, machine-enumerable list)
// ---------------------------------------------------------------------------

/**
 * The EIGHT check dimensions of the hard gate — exactly the dimensions
 * spec/ARCHITECTURE.md's Execution sentence enumerates. Machine-
 * enumerable: `validateExecutionPolicy` walks this list and fails with
 * `check_dimension_missing` for any absent dimension.
 */
export type CheckDimension =
  /** A standing switch record that refuses EVERYTHING when thrown. */
  | 'kill_switch'
  /** Who — the declared principal scope. */
  | 'identity'
  /** May they — authority scope refs (what the grants permit). */
  | 'authorization'
  /** Position/notional/order-size caps, per instrument class. */
  | 'limits'
  /** Instrument x venue allowlists. */
  | 'venue_permissions'
  /** Per-venue declared budgets. */
  | 'rate_limits'
  /** Opaque credential refs (never values). */
  | 'credentials'
  /** Every decision emits an audit record. */
  | 'audit';

/** Runtime-checkable list of ALL check dimensions (the totality law's enumeration). */
export const CHECK_DIMENSIONS: readonly CheckDimension[] = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
  'audit',
] as const;

/**
 * The seven PRE-TRADE check kinds — the dimensions that can REFUSE an
 * intent. The kill switch is first: validated as the standing
 * dominance law ("once thrown, ALL subsequent intents are refused with
 * the kill-switch refusal kind" — a policy that orders any check
 * before it is not a hard gate).
 */
export type PreTradeCheckKind = Exclude<CheckDimension, 'audit'>;

/** Runtime-checkable list of the pre-trade check kinds (kill_switch first). */
export const PRE_TRADE_CHECK_KINDS: readonly PreTradeCheckKind[] = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
] as const;

/** Guard: a pre-trade check kind. */
export function isPreTradeCheckKind(value: unknown): value is PreTradeCheckKind {
  return isMemberOf(PRE_TRADE_CHECK_KINDS, value);
}

/** Guard: a check dimension. */
export function isCheckDimension(value: unknown): value is CheckDimension {
  return isMemberOf(CHECK_DIMENSIONS, value);
}

/**
 * The canonical check order (the program's declared default): the kill
 * switch first (standing dominance), then identity (who), authorization
 * (may they), limits (how much), venue permissions (where), rate
 * limits (how fast), credentials (with what binding).
 */
export const DEFAULT_CHECK_ORDER: readonly PreTradeCheckKind[] = [...PRE_TRADE_CHECK_KINDS];

// ---------------------------------------------------------------------------
// The dimension declarations
// ---------------------------------------------------------------------------

/**
 * IDENTITY — who may act: the principal allowlist. A principal here is
 * a STRATEGY SPEC identity (the lane's actor model: intents arrive from
 * compiled strategy runs — trading-strategy's `StrategyVersionRef.specId`).
 * The identity check also binds the tenant/project scope: an intent
 * from another tenant or project is not this policy's business (L12).
 */
export interface IdentityRequirement {
  /** The strategy spec ids permitted to act under this policy (may be empty — fail-closed: nobody may act). */
  readonly principals: readonly string[];
}

/** Guard: `IdentityRequirement`. */
export function isIdentityRequirement(v: unknown): v is IdentityRequirement {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.principals)) return false;
  if (!v.principals.every((x) => isNonEmptyString(x))) return false;
  return new Set(v.principals).size === v.principals.length; // unique
}

/**
 * AUTHORIZATION — may they: one authority grant. The `scopeRef` is an
 * OPAQUE `grant:`-prefixed reference to the control-plane authority
 * record (T007 owns the grant registry); `orderKinds` is what the
 * grant permits the principal to submit. The authorization check
 * passes an intent whose order kind at least one declared grant
 * permits; a kind no grant permits is refused (fail-closed).
 */
export interface AuthorityGrant {
  /** Opaque reference to the control-plane authority grant record. */
  readonly scopeRef: AuthorityScopeRef;
  /** The order kinds this grant permits (non-empty; core kinds or registered extensions). */
  readonly orderKinds: readonly OrderKind[];
}

/** Guard: `AuthorityGrant`. */
export function isAuthorityGrant(v: unknown): v is AuthorityGrant {
  if (!isRecord(v)) return false;
  if (!isAuthorityScopeRef(v.scopeRef)) return false;
  if (!Array.isArray(v.orderKinds) || v.orderKinds.length === 0) return false;
  if (!v.orderKinds.every((x) => isOrderKind(x))) return false;
  return new Set(v.orderKinds).size === v.orderKinds.length; // unique
}

/**
 * Which limit of a {@link LimitRecord} was breached — the refusal
 * reason's discriminator ("which limit").
 */
export type LimitKind = 'order_size' | 'order_notional' | 'position_size' | 'position_notional';

/** Runtime-checkable list. */
export const LIMIT_KINDS: readonly LimitKind[] = ['order_size', 'order_notional', 'position_size', 'position_notional'] as const;

/** Guard: a limit kind. */
export function isLimitKind(v: unknown): v is LimitKind {
  return isMemberOf(LIMIT_KINDS, v);
}

/**
 * LIMITS — how much: the cap record for one instrument class. All
 * caps are canonical positive decimals (a zero cap is inexpressible —
 * refuse by policy shape, not by magic numbers; use the venue
 * allowlist to prohibit). `instrumentClass` is the venue model's asset
 * class ('crypto', 'equity', ...); `'*'` is the catch-all class for
 * instruments whose class carries no specific record.
 */
export interface LimitRecord {
  /** The instrument class this record caps ('*' = catch-all). */
  readonly instrumentClass: string;
  /** Maximum single-order size in instrument units. */
  readonly maxOrderSize: string;
  /** Maximum single-order notional in quote currency (quantity x reference price). */
  readonly maxOrderNotional: string;
  /** Maximum post-trade position in instrument units. */
  readonly maxPositionSize: string;
  /** Maximum post-trade position notional in quote currency. */
  readonly maxPositionNotional: string;
}

/** Guard: `LimitRecord`. */
export function isLimitRecord(v: unknown): v is LimitRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  if (!isCanonicalPositiveDecimal(v.maxOrderSize)) return false;
  if (!isCanonicalPositiveDecimal(v.maxOrderNotional)) return false;
  if (!isCanonicalPositiveDecimal(v.maxPositionSize)) return false;
  if (!isCanonicalPositiveDecimal(v.maxPositionNotional)) return false;
  return true;
}

/**
 * VENUE PERMISSIONS — where: one permitted (venue, instrument) pair.
 * `instrumentClass` records the policy author's class mapping for the
 * pair (the limits check's record selector — kept here so the pair's
 * class is declared data, not a lookup heuristic).
 */
export interface VenuePermission {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The instrument's class (mirrors the venue model's asset_class). */
  readonly instrumentClass: string;
}

/** Guard: `VenuePermission`. */
export function isVenuePermission(v: unknown): v is VenuePermission {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  return true;
}

/**
 * RATE LIMITS — how fast: the declared per-venue budget. `windowMs`
 * is the budget's window in milliseconds (the venue state's
 * `rateWindowOrderCount` counts submissions within the CURRENT window
 * — the simulator owns the windowing; the gate compares the declared
 * budget against the provided counter).
 */
export interface RateBudget {
  readonly venue: VenueId;
  /** The budget's window length in milliseconds (>= 1). */
  readonly windowMs: number;
  /** Maximum orders submitted to the venue within one window (>= 0; 0 = venue paused by budget). */
  readonly maxOrders: number;
}

/** Guard: `RateBudget`. */
export function isRateBudget(v: unknown): v is RateBudget {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isPositiveSafeInteger(v.windowMs)) return false;
  if (typeof v.maxOrders !== 'number' || !Number.isSafeInteger(v.maxOrders) || v.maxOrders < 0) return false;
  return true;
}

/**
 * CREDENTIALS — with what binding: the OPAQUE `cred:` ref bound to one
 * venue. Never a value (the trip wire enforces opacity record-wide);
 * the secrets lane (T044) owns referents; T040 binds real venues.
 */
export interface CredentialBinding {
  readonly venue: VenueId;
  /** Opaque reference to the credential record ('cred:'-prefixed). */
  readonly credentialRef: CredentialRef;
}

/** Guard: `CredentialBinding`. */
export function isCredentialBinding(v: unknown): v is CredentialBinding {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isCredentialRef(v.credentialRef)) return false;
  return true;
}

/** The audit declaration (the record dimension): every decision emits an audit record. */
export type AuditDeclaration = { readonly emission: 'every_decision' };

/** Guard: `AuditDeclaration` (the only legal emission discipline). */
export function isAuditDeclaration(v: unknown): v is AuditDeclaration {
  return isRecord(v) && v.emission === 'every_decision';
}

/** The standing kill-switch binding: WHICH switch log this policy enforces. */
export interface KillSwitchBinding {
  /** The switch log's identity ('ksw:'-prefixed). */
  readonly switchId: KillSwitchId;
}

/** Guard: `KillSwitchBinding`. */
export function isKillSwitchBinding(v: unknown): v is KillSwitchBinding {
  return isRecord(v) && isKillSwitchId(v.switchId);
}

/**
 * The learning lineage of a LEARNED policy (T013 mirrors — opaque refs
 * into the RL bridge's trial/lineage shapes; `null` for hand-declared
 * policies). Mirrors trading-strategy's `LearningLineage` discipline.
 */
export interface PolicyLearningLineage {
  readonly trialId: TrialId;
  readonly armId: ArmId;
  readonly trajectoryId: TrajectoryId;
}

/** Guard: `PolicyLearningLineage`. */
export function isPolicyLearningLineage(v: unknown): v is PolicyLearningLineage {
  if (!isRecord(v)) return false;
  return isTrialId(v.trialId) && isArmId(v.armId) && isTrajectoryId(v.trajectoryId);
}

// ---------------------------------------------------------------------------
// The policy record
// ---------------------------------------------------------------------------

/**
 * The versioned hard-gate declaration (see the module header for the
 * totality law). Identity is `(policyId, version)`; the id is
 * content-addressed from the canonical declaration content; the record
 * is deeply frozen and JSON-serializable (L9).
 */
export interface ExecutionPolicy {
  /** Content-addressed identity: `xpol:` + digest of the canonical content. */
  readonly policyId: ExecutionPolicyId;
  /** Integer >= 1; monotonically increasing per policyId (revisions are NEW versions). */
  readonly version: number;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** IDENTITY — the principal allowlist (who). */
  readonly identity: IdentityRequirement;
  /** AUTHORIZATION — the authority grants (may they). */
  readonly authorization: readonly AuthorityGrant[];
  /** LIMITS — the per-instrument-class cap records (how much). */
  readonly limits: readonly LimitRecord[];
  /** VENUE PERMISSIONS — the (venue, instrument) allowlist (where). */
  readonly venuePermissions: readonly VenuePermission[];
  /** RATE LIMITS — the per-venue budgets (how fast). */
  readonly rateLimits: readonly RateBudget[];
  /** CREDENTIALS — the opaque per-venue credential refs (with what binding). */
  readonly credentials: readonly CredentialBinding[];
  /** KILL SWITCH — the standing switch log this policy enforces. */
  readonly killSwitch: KillSwitchBinding;
  /** AUDIT — the record dimension: every decision emits an audit record. */
  readonly audit: AuditDeclaration;
  /** The DECLARED order of the pre-trade checks (a full permutation, kill switch first). */
  readonly checkOrder: readonly PreTradeCheckKind[];
  /** The learning lineage of a learned policy (T013 mirrors), or null. */
  readonly learning: PolicyLearningLineage | null;
  /** The declaration instant (epoch ms; no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: `ExecutionPolicy` (structural; the totality laws live in `validateExecutionPolicy`). */
export function isExecutionPolicy(v: unknown): v is ExecutionPolicy {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.policyId) || !(v.policyId as string).startsWith('xpol:')) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isIdentityRequirement(v.identity)) return false;
  if (!Array.isArray(v.authorization) || !v.authorization.every((x) => isAuthorityGrant(x))) return false;
  if (!Array.isArray(v.limits) || !v.limits.every((x) => isLimitRecord(x))) return false;
  if (!Array.isArray(v.venuePermissions) || !v.venuePermissions.every((x) => isVenuePermission(x))) return false;
  if (!Array.isArray(v.rateLimits) || !v.rateLimits.every((x) => isRateBudget(x))) return false;
  if (!Array.isArray(v.credentials) || !v.credentials.every((x) => isCredentialBinding(x))) return false;
  if (!isKillSwitchBinding(v.killSwitch)) return false;
  if (!isAuditDeclaration(v.audit)) return false;
  if (!Array.isArray(v.checkOrder) || !v.checkOrder.every((x) => isPreTradeCheckKind(x))) return false;
  if (v.learning !== null && !isPolicyLearningLineage(v.learning)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The opacity trip wire (the guard half).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/**
 * The canonical JSON tree of a policy's CONTENT (everything except the
 * content-addressed `policyId`). The explicit-tree discipline: JSON
 * shape is proven by construction, never cast. Equal contents always
 * serialize byte-identically.
 */
export function policyContentTree(policy: Omit<ExecutionPolicy, 'policyId'>): JsonValue {
  return {
    version: policy.version,
    tenant: policy.tenant,
    project: policy.project,
    identity: { principals: [...policy.identity.principals] },
    authorization: policy.authorization.map((grant) => ({ scopeRef: grant.scopeRef, orderKinds: [...grant.orderKinds] })),
    limits: policy.limits.map((limit) => ({
      instrumentClass: limit.instrumentClass,
      maxOrderSize: limit.maxOrderSize,
      maxOrderNotional: limit.maxOrderNotional,
      maxPositionSize: limit.maxPositionSize,
      maxPositionNotional: limit.maxPositionNotional,
    })),
    venuePermissions: policy.venuePermissions.map((permission) => ({
      venue: permission.venue,
      instrument: permission.instrument,
      instrumentClass: permission.instrumentClass,
    })),
    rateLimits: policy.rateLimits.map((budget) => ({ venue: budget.venue, windowMs: budget.windowMs, maxOrders: budget.maxOrders })),
    credentials: policy.credentials.map((binding) => ({ venue: binding.venue, credentialRef: binding.credentialRef })),
    killSwitch: { switchId: policy.killSwitch.switchId },
    audit: { emission: policy.audit.emission },
    checkOrder: [...policy.checkOrder],
    learning:
      policy.learning === null
        ? null
        : { trialId: policy.learning.trialId, armId: policy.learning.armId, trajectoryId: policy.learning.trajectoryId },
    asOf: policy.asOf,
  };
}

/** The content digest of a policy's payload. Pure — same content, same digest (L9). */
export function policyContentDigest(policy: Omit<ExecutionPolicy, 'policyId'>): string {
  return stableDigest(policyContentTree(policy));
}

// ---------------------------------------------------------------------------
// Validation (collect-all — the totality law's enforcement)
// ---------------------------------------------------------------------------

/** Validate one list-of-declarations dimension: absent field -> `check_dimension_missing`; bad element -> `invalid_field`. */
function validateDeclarationList<T>(
  value: Record<string, unknown>,
  field: string,
  guard: (element: unknown) => element is T,
  dimension: CheckDimension,
  elementMessage: string,
  errors: ExecutionPolicyError[],
): readonly T[] | undefined {
  const raw = value[field];
  if (raw === undefined) {
    errors.push({
      code: 'check_dimension_missing',
      path: field,
      message: `the policy omits the ${dimension} check dimension ("${field}") — the gate is total or it is not a gate (L8)`,
    });
    return undefined;
  }
  if (!Array.isArray(raw)) {
    errors.push(invalidField(field, `must be an array of ${elementMessage}`));
    return undefined;
  }
  const errorsBefore = errors.length;
  for (let index = 0; index < raw.length; index++) {
    if (!guard(raw[index])) {
      errors.push(invalidField(`${field}[${index}]`, `must be ${elementMessage}`));
    }
  }
  if (errors.length > errorsBefore) return undefined;
  return raw as readonly T[];
}

/**
 * Collect-all validation of an untrusted execution policy — the
 * TOTALITY GATE. Enforces, beyond the structural guard:
 *   - every one of the EIGHT check dimensions is declared
 *     (`check_dimension_missing` per absent dimension);
 *   - `checkOrder` is a FULL permutation of the seven pre-trade kinds
 *     with `kill_switch` first (the standing-dominance law —
 *     `invalid_check_order`);
 *   - dimension coherence: unique limit classes, unique venue-
 *     permission pairs, one budget and one credential binding per
 *     venue;
 *   - credential opacity: the value trip wire over the whole record
 *     (`credential_value_present`);
 *   - L12 scope: tenant and project present.
 * On success the value is returned narrowed, deeply frozen, with the
 * content-addressed `policyId` derived (a supplied id that disagrees
 * with the content fails — content is the identity).
 */
export function validateExecutionPolicy(value: unknown, path = 'policy'): ExecutionPolicyResult<ExecutionPolicy> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];

  // --- L12 scope -------------------------------------------------------------
  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the policy carries no tenant scope (L12)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the tenant scope must be a non-empty id (L12)' });
  }
  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the policy carries no project scope (L12/L15)' });
  } else if (!isProjectId(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the project scope must be a non-empty id (L12/L15)' });
  }

  if (value.version === undefined) {
    errors.push(missingField(`${path}.version`));
  } else if (!isPositiveSafeInteger(value.version)) {
    errors.push(invalidField(`${path}.version`, 'must be a positive safe integer (revisions are new versions)'));
  }

  if (value.asOf === undefined) {
    errors.push(missingField(`${path}.asOf`));
  } else if (!isTimestampMs(value.asOf)) {
    errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms timestamp (no ambient clock)'));
  }

  // --- IDENTITY (who) ---------------------------------------------------------
  let identity: IdentityRequirement | undefined;
  if (value.identity === undefined) {
    errors.push({
      code: 'check_dimension_missing',
      path: `${path}.identity`,
      message: 'the policy omits the identity check dimension ("identity") — the gate is total or it is not a gate (L8)',
    });
  } else if (!isIdentityRequirement(value.identity)) {
    errors.push(invalidField(`${path}.identity`, 'must be { principals: unique non-empty strategy spec ids } (an empty list is legal and fail-closed: nobody may act)'));
  } else {
    identity = value.identity;
  }

  // --- AUTHORIZATION (may they) -------------------------------------------------
  const authorization = validateDeclarationList(value, 'authorization', isAuthorityGrant, 'authorization', 'an authority grant { scopeRef, orderKinds }', errors);

  // --- LIMITS (how much) ----------------------------------------------------------
  const limits = validateDeclarationList(value, 'limits', isLimitRecord, 'limits', 'a limit record { instrumentClass, maxOrderSize, maxOrderNotional, maxPositionSize, maxPositionNotional }', errors);
  if (limits !== undefined) {
    const seen = new Set<string>();
    limits.forEach((limit, index) => {
      if (seen.has(limit.instrumentClass)) {
        errors.push(invalidField(`${path}.limits[${index}].instrumentClass`, `duplicate class "${limit.instrumentClass}" — one record per class ('*' is the catch-all)`));
      }
      seen.add(limit.instrumentClass);
    });
  }

  // --- VENUE PERMISSIONS (where) -----------------------------------------------------
  const venuePermissions = validateDeclarationList(value, 'venuePermissions', isVenuePermission, 'venue_permissions', 'a venue permission { venue, instrument, instrumentClass }', errors);
  if (venuePermissions !== undefined) {
    const seen = new Set<string>();
    venuePermissions.forEach((permission, index) => {
      const key = `${permission.venue}|${permission.instrument}`;
      if (seen.has(key)) {
        errors.push(invalidField(`${path}.venuePermissions[${index}]`, `duplicate pair (${key}) — one record per (venue, instrument)`));
      }
      seen.add(key);
    });
  }

  // --- RATE LIMITS (how fast) -----------------------------------------------------------
  const rateLimits = validateDeclarationList(value, 'rateLimits', isRateBudget, 'rate_limits', 'a rate budget { venue, windowMs, maxOrders }', errors);
  if (rateLimits !== undefined) {
    const seen = new Set<string>();
    rateLimits.forEach((budget, index) => {
      if (seen.has(budget.venue)) {
        errors.push(invalidField(`${path}.rateLimits[${index}].venue`, `duplicate budget for venue "${budget.venue}" — one budget per venue`));
      }
      seen.add(budget.venue);
    });
  }

  // --- CREDENTIALS (with what binding) ------------------------------------------------------
  const credentials = validateDeclarationList(value, 'credentials', isCredentialBinding, 'credentials', 'a credential binding { venue, credentialRef } (opaque refs only)', errors);
  if (credentials !== undefined) {
    const seen = new Set<string>();
    credentials.forEach((binding, index) => {
      if (seen.has(binding.venue)) {
        errors.push(invalidField(`${path}.credentials[${index}].venue`, `duplicate binding for venue "${binding.venue}" — one credential ref per venue`));
      }
      seen.add(binding.venue);
    });
  }

  // --- KILL SWITCH (the standing dominance) ----------------------------------------------------
  let killSwitch: KillSwitchBinding | undefined;
  if (value.killSwitch === undefined) {
    errors.push({
      code: 'check_dimension_missing',
      path: `${path}.killSwitch`,
      message: 'the policy omits the kill_switch check dimension ("killSwitch") — the gate is total or it is not a gate (L8)',
    });
  } else if (!isKillSwitchBinding(value.killSwitch)) {
    errors.push(invalidField(`${path}.killSwitch`, 'must be { switchId } — the standing switch log this policy enforces'));
  } else {
    killSwitch = value.killSwitch;
  }

  // --- AUDIT (the record dimension) -----------------------------------------------------------
  let audit: AuditDeclaration | undefined;
  if (value.audit === undefined) {
    errors.push({
      code: 'check_dimension_missing',
      path: `${path}.audit`,
      message: 'the policy omits the audit check dimension ("audit") — every decision must emit an audit record (L8)',
    });
  } else if (!isAuditDeclaration(value.audit)) {
    errors.push(invalidField(`${path}.audit`, "must be { emission: 'every_decision' } — the only audit discipline this lane expresses"));
  } else {
    audit = value.audit;
  }

  // --- CHECK ORDER (the declared order — a full permutation, kill switch first) ----------------
  let checkOrder: readonly PreTradeCheckKind[] | undefined;
  if (value.checkOrder === undefined) {
    errors.push({
      code: 'check_dimension_missing',
      path: `${path}.checkOrder`,
      message: 'the policy omits the declared check order — pre-trade checks run in a DECLARED order (first failure wins)',
    });
  } else if (!Array.isArray(value.checkOrder) || !value.checkOrder.every((x) => isPreTradeCheckKind(x))) {
    errors.push(invalidField(`${path}.checkOrder`, `must be an array of pre-trade check kinds (${PRE_TRADE_CHECK_KINDS.join(' | ')})`));
  } else {
    const order = value.checkOrder as readonly PreTradeCheckKind[];
    const sorted = [...order].sort();
    const expected = [...PRE_TRADE_CHECK_KINDS].sort();
    if (order.length !== PRE_TRADE_CHECK_KINDS.length || sorted.join(',') !== expected.join(',')) {
      errors.push({
        code: 'invalid_check_order',
        path: `${path}.checkOrder`,
        message: `must be a FULL permutation of the seven pre-trade checks (${PRE_TRADE_CHECK_KINDS.join(' | ')}) — a check the policy does not order is a check it does not run`,
      });
    } else if (order[0] !== 'kill_switch') {
      errors.push({
        code: 'invalid_check_order',
        path: `${path}.checkOrder`,
        message: 'the kill switch must be ordered FIRST — "a standing switch record that refuses EVERYTHING when thrown" structurally dominates (L8); burying it behind other checks is not a hard gate',
      });
    } else {
      checkOrder = order;
    }
  }

  // --- LEARNING LINEAGE (T013 mirrors — optional) ------------------------------------------------
  let learning: PolicyLearningLineage | null = null;
  if (value.learning !== undefined && value.learning !== null) {
    if (!isPolicyLearningLineage(value.learning)) {
      errors.push(invalidField(`${path}.learning`, 'must be { trialId, armId, trajectoryId } (opaque rl-protocol refs) or null'));
    } else {
      learning = value.learning;
    }
  }

  // --- Credential opacity (the L8/L12 trip wire over the whole record) -----------------------------
  for (const crimePath of credentialValueViolations(value)) {
    errors.push({
      code: 'credential_value_present',
      path: `${path}.${crimePath}`,
      message: `policies carry credential REFERENCES, never values ("${crimePath}") — values live in the secrets lane (T044); venue binding is T040 (L12)`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: Omit<ExecutionPolicy, 'policyId'> = {
    version: value.version as number,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
    identity: identity as IdentityRequirement,
    authorization: authorization as readonly AuthorityGrant[],
    limits: limits as readonly LimitRecord[],
    venuePermissions: venuePermissions as readonly VenuePermission[],
    rateLimits: rateLimits as readonly RateBudget[],
    credentials: credentials as readonly CredentialBinding[],
    killSwitch: killSwitch as KillSwitchBinding,
    audit: audit as AuditDeclaration,
    checkOrder: checkOrder as readonly PreTradeCheckKind[],
    learning,
    asOf: value.asOf as TimestampMs,
  };
  const derivedId = mintExecutionPolicyId(policyContentDigest(payload));
  if (value.policyId !== undefined && value.policyId !== derivedId) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid_state',
          path: `${path}.policyId`,
          message: `the supplied policy id does not match the declared content (expected "${derivedId}") — identity is content-addressed (L9)`,
        },
      ],
    };
  }
  return ok(deepFreeze({ ...payload, policyId: derivedId }));
}

/**
 * The L9 anchor: the canonical JSON of a validated policy (the
 * content-addressed identity's basis). Equal policies produce
 * byte-identical bytes.
 */
export function canonicalPolicyJson(policy: ExecutionPolicy): string {
  return canonicalJson(policyContentTree(policy));
}

/** The human-audit summary of a policy's dimension coverage (every dimension named — totality made visible). */
export function describePolicyCoverage(policy: ExecutionPolicy): string {
  const declared: string[] = [
    `kill_switch:${policy.killSwitch.switchId}`,
    `identity:${policy.identity.principals.length} principal(s)`,
    `authorization:${policy.authorization.length} grant(s)`,
    `limits:${policy.limits.length} record(s)`,
    `venue_permissions:${policy.venuePermissions.length} pair(s)`,
    `rate_limits:${policy.rateLimits.length} budget(s)`,
    `credentials:${policy.credentials.length} binding(s)`,
    `audit:${policy.audit.emission}`,
  ];
  return declared.join(' ');
}

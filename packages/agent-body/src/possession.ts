// @tradrl/agent-body — Possession contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation), L13/L14
// (providers are adapters; substrates replaceable); spec/DOMAIN-MODEL.md
// ("Possession: BodyVersion + CognitiveSubstrate + adapter + runtime profile +
// environment profile + policy bundle"); spec/ADAPTERS.md ("A model provider
// never owns an Agent Body" — here, the SUBSTRATE possesses the BODY, never
// the reverse).
//
// Possession law: a possession is VALID only when the substrate satisfies the
// bound BodyVersion's substrate compatibility manifest (see compatibility.ts).
// Possession records are immutable; status changes are copy-on-write through
// the declared state machine below.

import {
  type BodyVersionId,
  type EnvironmentProfileRef,
  type ISO8601,
  type PolicyBundleRef,
  type PossessionId,
  type SubstrateRef,
  IllegalTransitionError,
  deepFreeze,
  isBodyVersionId,
  isEnum,
  isISO8601,
  isNonNegativeInteger,
  isNull,
  isPossessionId,
  isPositiveInteger,
  isRecord,
  isString,
  isSubstrateRef,
  isPolicyBundleRef,
  isEnvironmentProfileRef,
} from './primitives';
import {
  type BodyVersion,
  type FidelityMode,
  isFidelityMode,
} from './body';
import {
  type CompatibilityVerdict,
  evaluateSubstrateCompatibility,
} from './compatibility';
import type { CognitiveSubstrate } from './substrate';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** Possession lifecycle states. */
export const POSSESSION_STATUSES = ['draft', 'validated', 'active', 'suspended', 'retired'] as const;

/** Possession lifecycle state. */
export type PossessionStatus = (typeof POSSESSION_STATUSES)[number];

/** Guard: `PossessionStatus`. */
export const isPossessionStatus = isEnum(POSSESSION_STATUSES);

/**
 * The possession state machine (authoritative; see contracts/agent/possession.md):
 *
 * ```text
 *   draft ──► validated ──► active ◄──┐
 *     │           │           │  │    │ resume
 *     │           │      suspend│  ▼    │
 *     ▼           ▼           ▼  suspended
 *   retired ◄──── retired ◄──── retired
 * ```
 *
 * `draft -> validated` is only legal after `validatePossession` returned a
 * satisfied compatibility verdict (the OS must hold that evidence; the
 * contract declares the edge, the OS sequences it).
 */
export const POSSESSION_TRANSITIONS: Readonly<Record<PossessionStatus, readonly PossessionStatus[]>> =
  {
    draft: ['validated', 'retired'],
    validated: ['active', 'retired'],
    active: ['suspended', 'retired'],
    suspended: ['active', 'retired'],
    retired: [],
  };

/** `true` when `from -> to` is a legal possession transition. */
export function canTransitionPossession(from: PossessionStatus, to: PossessionStatus): boolean {
  if (!isPossessionStatus(from) || !isPossessionStatus(to)) return false;
  return POSSESSION_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Binding components
// ---------------------------------------------------------------------------

/**
 * The adapter that mediates between the substrate's native API and TradRL's
 * canonical substrate contract (L13: vendor specifics stay in adapters).
 * `configRef` is an opaque reference to adapter configuration held outside
 * this package (secrets never live in contract data — spec/SECURITY.md).
 */
export interface AdapterBinding {
  /** Opaque adapter identity (adapter lane, T036). */
  readonly adapterId: string;
  /** Opaque reference to the adapter configuration record. */
  readonly configRef: string;
}

/** Guard: `AdapterBinding`. */
export function isAdapterBinding(v: unknown): v is AdapterBinding {
  if (!isRecord(v)) return false;
  return isString(v.adapterId) && v.adapterId.length > 0 && isString(v.configRef) && v.configRef.length > 0;
}

/** Runtime invocation parameters for the possessed agent. */
export interface RuntimeProfile {
  /** Per-invocation timeout in milliseconds. */
  readonly timeoutMs: number;
  /** Maximum retries per invocation. */
  readonly maxRetries: number;
  /** Maximum concurrent substrate invocations. */
  readonly maxConcurrentInvocations: number;
  /** Opaque cost-budget reference (control-plane lane), or `null`. */
  readonly costBudgetRef: string | null;
}

/** Guard: `RuntimeProfile`. */
export function isRuntimeProfile(v: unknown): v is RuntimeProfile {
  if (!isRecord(v)) return false;
  return (
    isPositiveInteger(v.timeoutMs) &&
    isNonNegativeInteger(v.maxRetries) &&
    isPositiveInteger(v.maxConcurrentInvocations) &&
    (isNull(v.costBudgetRef) || (isString(v.costBudgetRef) && v.costBudgetRef.length > 0))
  );
}

/**
 * The environment the possessed agent operates in: an opaque environment
 * reference (T005 lane) plus the declared Market World fidelity mode (L5).
 */
export interface EnvironmentProfile {
  /** Opaque environment reference (T005 lane). */
  readonly environmentRef: EnvironmentProfileRef;
  /** Declared fidelity mode for this possession (L5). */
  readonly fidelityMode: FidelityMode;
}

/** Guard: `EnvironmentProfile`. */
export function isEnvironmentProfile(v: unknown): v is EnvironmentProfile {
  if (!isRecord(v)) return false;
  return isEnvironmentProfileRef(v.environmentRef) && isFidelityMode(v.fidelityMode);
}

// ---------------------------------------------------------------------------
// Possession
// ---------------------------------------------------------------------------

/** Draft accepted by `createPossession` — everything except lifecycle state. */
export type PossessionDraft = Omit<Possession, 'status'>;

/**
 * The binding of one BodyVersion to one CognitiveSubstrate, plus the adapter,
 * runtime profile, environment profile and policy bundle. This record is the
 * "Possession Configuration" component of the core law (L2).
 */
export interface Possession {
  /** Possession identity. */
  readonly id: PossessionId;
  /** The bound BodyVersion (`${bodyId}@${semver}`). */
  readonly bodyVersionId: BodyVersionId;
  /** The possessing substrate (canonical `provider/modelId@modelVersion`). */
  readonly substrateId: SubstrateRef;
  /** Adapter binding that mediates the substrate. */
  readonly adapter: AdapterBinding;
  /** Runtime invocation parameters. */
  readonly runtimeProfile: RuntimeProfile;
  /** Environment the possessed agent operates in. */
  readonly environmentProfile: EnvironmentProfile;
  /** Opaque policy-bundle reference (control-plane lane, T007/T020). */
  readonly policyBundleRef: PolicyBundleRef;
  /** Lifecycle state (state machine above). */
  readonly status: PossessionStatus;
  /** When the possession was created. */
  readonly createdAt: ISO8601;
}

/** Guard: `Possession`. */
export function isPossession(v: unknown): v is Possession {
  if (!isRecord(v)) return false;
  return (
    isPossessionId(v.id) &&
    isBodyVersionId(v.bodyVersionId) &&
    isSubstrateRef(v.substrateId) &&
    isAdapterBinding(v.adapter) &&
    isRuntimeProfile(v.runtimeProfile) &&
    isEnvironmentProfile(v.environmentProfile) &&
    isPolicyBundleRef(v.policyBundleRef) &&
    isPossessionStatus(v.status) &&
    isISO8601(v.createdAt)
  );
}

/**
 * Constructs a deeply frozen `Possession` in state `draft` (possessions are
 * born drafts — the state machine has a single entry point). Throws
 * `TypeError` (field-prefixed) on invalid input.
 */
export function createPossession(draft: PossessionDraft): Possession {
  const problems: string[] = [];
  if (!isPossessionId(draft.id)) problems.push('id: invalid PossessionId');
  if (!isBodyVersionId(draft.bodyVersionId)) {
    problems.push('bodyVersionId: invalid canonical BodyVersionId');
  }
  if (!isSubstrateRef(draft.substrateId)) problems.push('substrateId: invalid SubstrateRef');
  if (!isAdapterBinding(draft.adapter)) problems.push('adapter: invalid AdapterBinding');
  if (!isRuntimeProfile(draft.runtimeProfile)) problems.push('runtimeProfile: invalid RuntimeProfile');
  if (!isEnvironmentProfile(draft.environmentProfile)) {
    problems.push('environmentProfile: invalid EnvironmentProfile');
  }
  if (!isPolicyBundleRef(draft.policyBundleRef)) {
    problems.push('policyBundleRef: invalid PolicyBundleRef');
  }
  if (!isISO8601(draft.createdAt)) problems.push('createdAt: invalid ISO8601 timestamp');
  if (problems.length > 0) throw new TypeError(`createPossession: ${problems.join('; ')}`);
  const possession: Possession = { ...draft, status: 'draft' };
  return deepFreeze(possession);
}

/**
 * Copy-on-write lifecycle transition: returns a NEW deeply frozen possession
 * in state `to`; the input record is untouched (immutable records, L3-style
 * discipline for all versioned state). Throws `IllegalTransitionError` on an
 * illegal edge and `TypeError` on an unknown state.
 */
export function transitionPossession(possession: Possession, to: PossessionStatus): Possession {
  if (!isPossessionStatus(to)) throw new TypeError(`transitionPossession: unknown status ${JSON.stringify(to)}`);
  if (!canTransitionPossession(possession.status, to)) {
    throw new IllegalTransitionError('possession', possession.status, to);
  }
  const next: Possession = { ...possession, status: to };
  return deepFreeze(next);
}

// ---------------------------------------------------------------------------
// Possession validity
// ---------------------------------------------------------------------------

/** Why a possession is invalid. */
export const POSSESSION_VIOLATION_CODES = [
  'body-version-mismatch',
  'substrate-mismatch',
  'substrate-incompatible',
] as const;

/** Possession validity violation code. */
export type PossessionViolationCode = (typeof POSSESSION_VIOLATION_CODES)[number];

/** Guard: `PossessionViolationCode`. */
export const isPossessionViolationCode = isEnum(POSSESSION_VIOLATION_CODES);

/** One possession validity violation. */
export interface PossessionViolation {
  /** Violation code. */
  readonly code: PossessionViolationCode;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Result of `validatePossession`. */
export interface PossessionValidation {
  /** `true` iff there are no violations. */
  readonly valid: boolean;
  /** The compatibility verdict for the bound pair (null unless ids match). */
  readonly verdict: CompatibilityVerdict | null;
  /** All violations (empty iff `valid`). */
  readonly violations: readonly PossessionViolation[];
}

/**
 * Validates the possession law: the referenced body version and substrate
 * must be the ones the possession binds (id equality), and the substrate must
 * SATISFY the body version's substrate compatibility manifest. An
 * incompatible substrate cannot possess the body — `valid` is `false` with
 * code `substrate-incompatible` and the full compatibility verdict attached
 * (violated-with-reasons).
 *
 * Note: requiring a CERTIFIED body version for possession is a runtime
 * policy decision owned by the Agent OS lane (T006) — shadow/live gates may
 * demand it; this contract enforces the structural law only.
 */
export function validatePossession(
  possession: Possession,
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
): PossessionValidation {
  const violations: PossessionViolation[] = [];
  if (possession.bodyVersionId !== bodyVersion.id) {
    violations.push({
      code: 'body-version-mismatch',
      message: `possession binds bodyVersionId ${possession.bodyVersionId} but the given version is ${bodyVersion.id}`,
    });
  }
  if (possession.substrateId !== substrate.id) {
    violations.push({
      code: 'substrate-mismatch',
      message: `possession binds substrateId ${possession.substrateId} but the given substrate is ${substrate.id}`,
    });
  }
  let verdict: CompatibilityVerdict | null = null;
  if (violations.length === 0) {
    verdict = evaluateSubstrateCompatibility(
      bodyVersion.composition.substrateCompatibility,
      substrate,
    );
    if (!verdict.satisfied) {
      violations.push({
        code: 'substrate-incompatible',
        message: `substrate ${substrate.id} does not satisfy the compatibility manifest of ${bodyVersion.id}: ${verdict.violations.map((v) => v.code).join(', ')}`,
      });
    }
  }
  return { valid: violations.length === 0, verdict, violations };
}

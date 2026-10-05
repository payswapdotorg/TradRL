// @tradrl/capability-provider — the VERIFICATION CONTRACT: the typed
// goalposts a deliverable must clear, declared UP FRONT on the request
// and accepted VERBATIM by the quoting provider — never moved
// afterwards.
//
// THE LAWS THIS MODULE SERVES:
// - "Verification is code, never judgment-in-prompts" (L20): a
//   verification requirement is a STRUCTURED, closed-vocabulary record
//   (benchmark / measurement / local-evaluation), and the verdict is a
//   pure fold over the outcomes the platform's verification machinery
//   supplies — `verifyDeliverable` never reads provider text to decide
//   anything.
// - The goalpost law: the request's verification contract is frozen at
//   request time; a quote that does not accept it VERBATIM (canonical
//   bytes) is the typed `quote_mismatch`; a verification report whose
//   outcomes do not cover the contract EXACTLY (every requirement
//   answered once, none invented) is the typed
//   `verification_contract_breach`.
// - Verdict semantics: `verified` iff EVERY outcome passed — a
//   rejected deliverable is retained data (the append-only exchange log
//   keeps it; reproducibility records rejected candidates too,
//   spec/CAPABILITY-DISCOVERY.md).
//
// The kinds deliberately mirror the platform's own measured-evidence
// language (T017): a benchmark requirement is discharged by benchmark
// evidence, a measurement requirement by a structured metric value, a
// local-evaluation requirement by the platform's own evaluation record
// reference (the local evaluation the import path runs — L18).

import { isFiniteNumber, isMemberOf, isNonEmptyString, isRecord } from './primitives';
import type { ProviderResult } from './errors';
import { fail, invalidField, invalidType, missingField, ok } from './errors';
import { isProviderVerificationReportId, isDeliverableId, isEngagementId, isProjectId, isTenantId, deriveProviderVerificationReportId } from './ids';
import type { ProviderVerificationReportId, DeliverableId, EngagementId, TenantId, ProjectId } from './ids';
import type { MeasurementMetricMirror } from './mirrors';
import { isMeasurementMetricMirror } from './mirrors';
import type { TimestampMs } from './primitives';
import { isTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// The requirement vocabulary (closed)
// ---------------------------------------------------------------------------

/** The closed verification-kind vocabulary. */
export const VERIFICATION_KINDS = ['benchmark', 'measurement', 'local-evaluation'] as const;

/** One verification kind. */
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** Guard: `VerificationKind`. */
export function isVerificationKind(v: unknown): v is VerificationKind {
  return isMemberOf(VERIFICATION_KINDS, v);
}

/**
 * One structured verification requirement — what the deliverable must
 * clear. `requirementRef` identifies the requirement within its
 * contract (unique; the outcomes answer by this ref).
 */
export type VerificationRequirement =
  | {
      readonly kind: 'benchmark';
      readonly requirementRef: string;
      /** The benchmark suite the deliverable's evidence must cite. */
      readonly benchmarkId: string;
    }
  | {
      readonly kind: 'measurement';
      readonly requirementRef: string;
      /** The structured metric the platform measures. */
      readonly metric: MeasurementMetricMirror;
      /** The inclusive lower bound (absent = unbounded below). */
      readonly min?: number;
      /** The inclusive upper bound (absent = unbounded above). */
      readonly max?: number;
    }
  | {
      readonly kind: 'local-evaluation';
      readonly requirementRef: string;
      /** Opaque reference to the platform's evaluation suite definition. */
      readonly evaluationRef: string;
    };

/** Guard: `VerificationRequirement`. */
export function isVerificationRequirement(v: unknown): v is VerificationRequirement {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.requirementRef)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId);
    case 'measurement': {
      if (!isMeasurementMetricMirror(v.metric)) return false;
      const hasMin = v.min !== undefined;
      const hasMax = v.max !== undefined;
      if (hasMin && !isFiniteNumber(v.min)) return false;
      if (hasMax && !isFiniteNumber(v.max)) return false;
      if (!hasMin && !hasMax) return false; // at least one bound
      if (hasMin && hasMax && (v.min as number) > (v.max as number)) return false;
      return true;
    }
    case 'local-evaluation':
      return isNonEmptyString(v.evaluationRef);
    default:
      return false;
  }
}

/**
 * The requirement-list law: NON-EMPTY (a request without a
 * verification contract is unverifiable — `verification_required`)
 * with unique `requirementRef`s.
 */
export function verificationContractProblems(requirements: readonly unknown[], path: string): readonly string[] {
  const problems: string[] = [];
  if (requirements.length === 0) {
    problems.push(`${path}: the verification contract is NON-EMPTY — a request without verification requirements is unverifiable`);
    return problems;
  }
  const refs = new Set<string>();
  requirements.forEach((requirement, index) => {
    if (!isVerificationRequirement(requirement)) {
      problems.push(`${path}[${index}]: failed the closed VerificationRequirement union (benchmark | measurement | local-evaluation)`);
      return;
    }
    if (refs.has(requirement.requirementRef)) {
      problems.push(`${path}[${index}]: duplicate requirementRef "${requirement.requirementRef}" (unique within the contract)`);
    } else {
      refs.add(requirement.requirementRef);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// The verification outcome (what the platform's machinery supplies)
// ---------------------------------------------------------------------------

/** One requirement's checked outcome, as the platform's verification machinery measured it. */
export interface VerificationOutcome {
  /** The requirement this outcome answers (must exist in the engagement's contract). */
  readonly requirementRef: string;
  /** Whether the requirement was met. */
  readonly passed: boolean;
  /** The structured explanation (non-empty; what was measured/checked and where the record lives). */
  readonly detail: string;
}

/** Guard: `VerificationOutcome`. */
export function isVerificationOutcome(v: unknown): v is VerificationOutcome {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.requirementRef) &&
    typeof v.passed === 'boolean' &&
    isNonEmptyString(v.detail)
  );
}

// ---------------------------------------------------------------------------
// The verification report (the platform's typed verdict)
// ---------------------------------------------------------------------------

/** The verdict: `verified` iff every outcome passed (the pure fold — L20). */
export type VerificationVerdict = 'verified' | 'rejected';

/** Guard: `VerificationVerdict`. */
export function isVerificationVerdict(v: unknown): v is VerificationVerdict {
  return v === 'verified' || v === 'rejected';
}

/**
 * The platform's typed verification verdict over one deliverable: the
 * outcomes (one per contract requirement — EXACT coverage enforced by
 * the exchange), the fold verdict, and the full L12/L9 lineage. The
 * report is the ATTAINMENT EVIDENCE of the local-import path (L18): a
 * verified capability artifact cites it.
 */
export interface ProviderVerificationReport {
  /** Report identity (`vrf:<digest>` — content-addressed). */
  readonly reportId: ProviderVerificationReportId;
  /** The engagement whose frozen contract was verified. */
  readonly engagementId: EngagementId;
  /** The deliverable that was verified. */
  readonly deliverableId: DeliverableId;
  /** The fold verdict (`verified` iff every outcome passed). */
  readonly verdict: VerificationVerdict;
  /** The outcomes; EXACTLY one per contract requirement (the coverage law). */
  readonly outcomes: readonly VerificationOutcome[];
  /** Explicit verification instant (epoch ms — never a wall clock). */
  readonly verifiedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `ProviderVerificationReport`. */
export function isProviderVerificationReport(v: unknown): v is ProviderVerificationReport {
  if (!isRecord(v)) return false;
  if (!isProviderVerificationReportId(v.reportId)) return false;
  if (!isEngagementId(v.engagementId)) return false;
  if (!isDeliverableId(v.deliverableId)) return false;
  if (!isVerificationVerdict(v.verdict)) return false;
  if (!Array.isArray(v.outcomes) || v.outcomes.length === 0) return false;
  if (!v.outcomes.every(isVerificationOutcome)) return false;
  if (!isTimestampMs(v.verifiedAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  return true;
}

/**
 * The pure verdict fold: `verified` iff every outcome passed. This is
 * the ONLY verdict computation in the lane — never a prompt, never a
 * judgment call (L20).
 */
export function verdictOf(outcomes: readonly VerificationOutcome[]): VerificationVerdict {
  return outcomes.every((outcome) => outcome.passed) ? 'verified' : 'rejected';
}

/**
 * The EXACT-coverage law: the outcomes must answer every requirement of
 * the contract EXACTLY once, and invent no requirements. Returns the
 * typed failure list (empty when coverage is exact).
 */
export function coverageProblems(
  contract: readonly VerificationRequirement[],
  outcomes: readonly VerificationOutcome[],
): readonly string[] {
  const problems: string[] = [];
  const requiredRefs = new Set(contract.map((requirement) => requirement.requirementRef));
  const answeredRefs = new Set<string>();
  outcomes.forEach((outcome, index) => {
    if (!requiredRefs.has(outcome.requirementRef)) {
      problems.push(`outcomes[${index}]: answers requirementRef "${outcome.requirementRef}" which is not in the engagement's verification contract`);
    } else if (answeredRefs.has(outcome.requirementRef)) {
      problems.push(`outcomes[${index}]: duplicate answer for requirementRef "${outcome.requirementRef}"`);
    } else {
      answeredRefs.add(outcome.requirementRef);
    }
  });
  for (const requirement of contract) {
    if (!answeredRefs.has(requirement.requirementRef)) {
      problems.push(`the requirement "${requirement.requirementRef}" (${requirement.kind}) has no outcome — the contract must be covered EXACTLY`);
    }
  }
  return problems;
}

/**
 * Mints a verification report over an EXACTLY-covering outcome set:
 * validates the outcomes, enforces the coverage law, folds the verdict
 * (`verified` iff all passed), and content-addresses the identity. The
 * ONLY sanctioned report constructor (the exchange calls it).
 */
export function mintVerificationReport(input: {
  readonly engagementId: EngagementId;
  readonly deliverableId: DeliverableId;
  readonly contract: readonly VerificationRequirement[];
  readonly outcomes: readonly VerificationOutcome[];
  readonly verifiedAt: TimestampMs;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
}): ProviderResult<ProviderVerificationReport> {
  const path = 'verification';
  const errors: string[] = [];
  if (!isEngagementId(input.engagementId)) errors.push(`${path}.engagementId: invalid EngagementId`);
  if (!isDeliverableId(input.deliverableId)) errors.push(`${path}.deliverableId: invalid DeliverableId`);
  if (!Array.isArray(input.outcomes) || input.outcomes.length === 0) {
    errors.push(`${path}.outcomes: must be a non-empty array of VerificationOutcome`);
  } else if (!input.outcomes.every(isVerificationOutcome)) {
    errors.push(`${path}.outcomes: failed the VerificationOutcome shape (requirementRef + passed + detail)`);
  } else {
    for (const problem of coverageProblems(input.contract, input.outcomes)) {
      errors.push(`${path}.${problem}`);
    }
  }
  if (!isTimestampMs(input.verifiedAt)) errors.push(`${path}.verifiedAt: invalid TimestampMs (explicit instant — never a wall clock)`);
  if (!isTenantId(input.tenantId)) errors.push(`${path}.tenantId: every verification report carries its owning tenant (L12)`);
  if (!isProjectId(input.projectId)) errors.push(`${path}.projectId: every verification report carries its owning project (L12)`);
  if (errors.length > 0) return fail('verification_contract_breach', errors.join('; '), path);
  const verdict = verdictOf(input.outcomes);
  const report: ProviderVerificationReport = {
    reportId: deriveProviderVerificationReportId({
      engagementId: input.engagementId,
      deliverableId: input.deliverableId,
      verdict,
      outcomes: input.outcomes,
      verifiedAt: input.verifiedAt,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
    engagementId: input.engagementId,
    deliverableId: input.deliverableId,
    verdict,
    outcomes: input.outcomes,
    verifiedAt: input.verifiedAt,
    tenantId: input.tenantId,
    projectId: input.projectId,
  };
  return ok(deepFreezeReport(report));
}

/** Freeze helper (local, avoids a primitives import cycle in type-only spots). */
function deepFreezeReport<T extends object>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || Object.isFrozen(node)) return;
    for (const key of Object.keys(node as Record<string, unknown>)) freeze((node as Record<string, unknown>)[key]);
    Object.freeze(node);
  };
  freeze(clone);
  return clone;
}

/** Validates an untrusted verification report (structural; the exchange mints its own). */
export function validateVerificationReport(v: unknown, path = 'verification'): ProviderResult<ProviderVerificationReport> {
  if (!isRecord(v)) return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  const errors: import('./errors').ProviderError[] = [];
  if (v.reportId === undefined) errors.push(missingField(`${path}.reportId`));
  else if (!isProviderVerificationReportId(v.reportId)) errors.push(invalidField(`${path}.reportId`, 'invalid ProviderVerificationReportId (vrf:<16-hex>)'));
  if (v.engagementId === undefined) errors.push(missingField(`${path}.engagementId`));
  else if (!isEngagementId(v.engagementId)) errors.push(invalidField(`${path}.engagementId`, 'invalid EngagementId'));
  if (v.deliverableId === undefined) errors.push(missingField(`${path}.deliverableId`));
  else if (!isDeliverableId(v.deliverableId)) errors.push(invalidField(`${path}.deliverableId`, 'invalid DeliverableId'));
  if (v.verdict === undefined) errors.push(missingField(`${path}.verdict`));
  else if (!isVerificationVerdict(v.verdict)) errors.push(invalidField(`${path}.verdict`, 'must be "verified" | "rejected"'));
  if (v.outcomes === undefined) errors.push(missingField(`${path}.outcomes`));
  else if (!Array.isArray(v.outcomes) || v.outcomes.length === 0 || !v.outcomes.every(isVerificationOutcome)) {
    errors.push(invalidField(`${path}.outcomes`, 'must be a non-empty array of VerificationOutcome'));
  }
  if (v.verifiedAt === undefined) errors.push(missingField(`${path}.verifiedAt`));
  else if (!isTimestampMs(v.verifiedAt)) errors.push(invalidField(`${path}.verifiedAt`, 'invalid TimestampMs'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'missing_field', path: `${path}.tenantId`, message: 'every verification report carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'missing_field', path: `${path}.projectId`, message: 'every verification report carries its owning project (L12)' });
  if (errors.length > 0) return { ok: false, errors };
  return ok(v as unknown as ProviderVerificationReport);
}

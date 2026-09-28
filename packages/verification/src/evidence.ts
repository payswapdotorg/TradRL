/**
 * @tradrl/verification — evidence-chain verification.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Integrity: Validate schemas,
 * timestamps, duplicates, provenance ... and availability timing"),
 * spec/ARCHITECTURE.md "Time Machine" ("Track event time, source time when
 * known, availability time and ingestion time"), contracts/market/
 * 01-market-event-envelope.md (THE AVAILABILITY QUARTET), ARCHITECTURE-LOCK
 * L4 (point-in-time truth), L9 (reproducible lineage — lineage hashes must
 * be present and RECOMPUTABLE), L20 (fail-closed).
 *
 * WHAT A VERIFICATION CASE IS: one structured, checkable claim about an
 * evidence chain — DATA, never a lambda. Three kinds cover the acceptance
 * surface of this work order:
 *
 *   - `lineage-hash` — a record's lineage hash is present and recomputable:
 *     the case carries the canonical JSON payload and the claimed digest;
 *     the verifier recomputes `stableDigestJson(payload)` with the
 *     program-wide digest (the mirror of @tradrl/evaluation's algorithm —
 *     parity is trip-wired in interop.test.ts) and compares. A tampered
 *     payload or hash fails with `lineage-hash-mismatch`.
 *   - `quartet-monotone` — the availability quartets of the evidence are
 *     monotone and not future-dated: for every event,
 *     `available_time >= event_time` (the one ENFORCED ordering of the
 *     quartet contract — information about an event cannot be observable
 *     before the event occurred) AND `available_time <= asOf` (the chain's
 *     declared as-of boundary — a future-dated quartet is evidence the
 *     chain could not legitimately have seen).
 *   - `no-future-leakage` — every delivered observation sample respected
 *     its availability instant: `available_time <= clockNow` per sample
 *     (the point-in-time boundary, L4) AND `available_time <= asOf`.
 *
 * VERDICTS ARE BOOLEAN + REASONS, NEVER SCORES: a {@link VerificationReport}
 * carries `passed` (boolean) and typed failure records locating the exact
 * case and index that failed. There is no partial credit on an evidence
 * chain — a tampered hash fails the chain exactly as hard as a hundred
 * tampered hashes; the report counts, it never grades.
 */

import {
  canonicalJson,
  deepFreeze,
  isDigest,
  isJsonObject,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigestJson,
  type JsonObject,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  isEvaluatorVersionRef,
  isVerificationCaseId,
  type EvaluatorVersionRef,
  type VerificationCaseId,
  type VerificationReportId,
} from './ids';
import { fail, invalidField, invalidType, missingField, ok, type VerificationError, type VerificationResult } from './errors';

// ---------------------------------------------------------------------------
// The availability quartet (mirror of the market-protocol envelope quartet)
// ---------------------------------------------------------------------------

/**
 * The availability quartet of one evidence event — STRUCTURAL MIRROR of the
 * four timestamp fields of @tradrl/market-protocol's envelope (the canonical
 * owner; see contracts/market/01-market-event-envelope.md):
 *   - `event_time`     — when it happened in the world;
 *   - `source_time`    — when the source says it happened (null when the
 *                         source does not say; ADVISORY, no ordering enforced);
 *   - `available_time` — the earliest an agent may legitimately observe it
 *                         (THE information-boundary input, L4);
 *   - `ingestion_time` — when TradRL received it (INFORMATIONAL, deliberately
 *                         unordered against availability).
 */
export interface AvailabilityQuartet {
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
}

/** Guard: `AvailabilityQuartet` (all four timestamps structurally valid). */
export function isAvailabilityQuartet(v: unknown): v is AvailabilityQuartet {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.event_time)) return false;
  if (v.source_time !== null && !isTimestampMs(v.source_time)) return false;
  if (!isTimestampMs(v.available_time)) return false;
  return isTimestampMs(v.ingestion_time);
}

/** One delivered-observation sample: the clock it was seen under, and when it became available. */
export interface LeakageSample {
  readonly clockNow: TimestampMs;
  readonly available_time: TimestampMs;
}

/** Guard: `LeakageSample`. */
export function isLeakageSample(v: unknown): v is LeakageSample {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.clockNow) && isTimestampMs(v.available_time);
}

// ---------------------------------------------------------------------------
// Verification cases (DATA — checkable claims about an evidence chain)
// ---------------------------------------------------------------------------

/** A lineage-hash claim: the payload and the digest the chain attests for it. */
export interface LineageHashCase {
  readonly kind: 'lineage-hash';
  readonly caseId: VerificationCaseId;
  /** Opaque reference to the record the hash attests. */
  readonly recordRef: string;
  /** The canonical JSON payload the hash was computed over. */
  readonly payload: JsonObject;
  /** The claimed lineage hash (must be present and recomputable). */
  readonly claimedHash: string;
}

/** A quartet-monotonicity claim: the evidence quartets and the chain's as-of boundary. */
export interface QuartetMonotoneCase {
  readonly kind: 'quartet-monotone';
  readonly caseId: VerificationCaseId;
  /** The as-of boundary: no quartet may claim availability beyond it. */
  readonly asOf: TimestampMs;
  /** The availability quartets under audit, in evidence order. */
  readonly quartets: readonly AvailabilityQuartet[];
}

/** A no-future-leakage claim: delivered observation samples against clocks and the as-of boundary. */
export interface NoFutureLeakageCase {
  readonly kind: 'no-future-leakage';
  readonly caseId: VerificationCaseId;
  /** The as-of boundary: no sample may claim availability beyond it. */
  readonly asOf: TimestampMs;
  /** The delivered-observation samples under audit, in evidence order. */
  readonly samples: readonly LeakageSample[];
}

/** The closed verification-case vocabulary (discriminated by `kind`). */
export type VerificationCase = LineageHashCase | QuartetMonotoneCase | NoFutureLeakageCase;

/** Runtime-checkable list of case kinds. */
export const VERIFICATION_CASE_KINDS: readonly VerificationCase['kind'][] = ['lineage-hash', 'quartet-monotone', 'no-future-leakage'] as const;

/** Guard: `LineageHashCase`. */
export function isLineageHashCase(v: unknown): v is LineageHashCase {
  if (!isRecord(v)) return false;
  if (v.kind !== 'lineage-hash') return false;
  if (!isVerificationCaseId(v.caseId)) return false;
  if (!isNonEmptyString(v.recordRef)) return false;
  if (!isJsonObject(v.payload)) return false;
  return isNonEmptyString(v.claimedHash);
}

/** Guard: `QuartetMonotoneCase`. */
export function isQuartetMonotoneCase(v: unknown): v is QuartetMonotoneCase {
  if (!isRecord(v)) return false;
  if (v.kind !== 'quartet-monotone') return false;
  if (!isVerificationCaseId(v.caseId)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!Array.isArray(v.quartets)) return false;
  return v.quartets.every((quartet) => isAvailabilityQuartet(quartet));
}

/** Guard: `NoFutureLeakageCase`. */
export function isNoFutureLeakageCase(v: unknown): v is NoFutureLeakageCase {
  if (!isRecord(v)) return false;
  if (v.kind !== 'no-future-leakage') return false;
  if (!isVerificationCaseId(v.caseId)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!Array.isArray(v.samples)) return false;
  return v.samples.every((sample) => isLeakageSample(sample));
}

/** Guard: `VerificationCase` (any kind). */
export function isVerificationCase(v: unknown): v is VerificationCase {
  return isLineageHashCase(v) || isQuartetMonotoneCase(v) || isNoFutureLeakageCase(v);
}

// ---------------------------------------------------------------------------
// Verification failures and the report
// ---------------------------------------------------------------------------

/** Machine-checkable reason codes — VERDICTS ARE REASONS, NEVER SCORES. */
export const VERIFICATION_REASON_CODES = [
  /** The recomputed lineage hash differs from the claim (tampered payload or hash). */
  'lineage-hash-mismatch',
  /** The claimed lineage hash is not a well-formed digest (missing/malformed). */
  'lineage-hash-malformed',
  /** A quartet's available_time precedes its event_time (the enforced ordering). */
  'quartet-ordering-violation',
  /** A quartet's available_time exceeds the chain's as-of boundary (future-dated quartet). */
  'quartet-future-dated',
  /** A sample's available_time exceeds the clock it was delivered under (L4 leak). */
  'future-leakage',
  /** A sample's available_time exceeds the chain's as-of boundary. */
  'sample-future-dated',
] as const;

/** Machine-checkable reason code. */
export type VerificationReasonCode = (typeof VERIFICATION_REASON_CODES)[number];

/** Guard: a verification reason code. */
export function isVerificationReasonCode(v: unknown): v is VerificationReasonCode {
  return typeof v === 'string' && (VERIFICATION_REASON_CODES as readonly string[]).includes(v);
}

/** One failure: the case, the code, and the index of the offending item (structured, never free text). */
export interface VerificationFailure {
  readonly caseId: VerificationCaseId;
  readonly code: VerificationReasonCode;
  /** Index of the offending quartet/sample within the case (0 for whole-case failures). */
  readonly index: number;
}

/** Guard: `VerificationFailure`. */
export function isVerificationFailure(v: unknown): v is VerificationFailure {
  if (!isRecord(v)) return false;
  if (!isVerificationCaseId(v.caseId)) return false;
  if (!isVerificationReasonCode(v.code)) return false;
  return typeof v.index === 'number' && Number.isInteger(v.index) && v.index >= 0;
}

/**
 * The verification report: the aggregate verdict over a case set. Boolean +
 * reasons, never scores — `passed` is true iff NO failure was found; the
 * report locates every failure by (caseId, code, index). Deterministic: the
 * derived `reportId` is a digest over the canonical JSON of the verified
 * case list, so the same evidence chain always produces the same report.
 */
export interface VerificationReport {
  /** Deterministic derived id (digest over the verified cases). */
  readonly reportId: VerificationReportId;
  /** True iff no failure was found — the evidence chain verifies. */
  readonly passed: boolean;
  readonly casesChecked: number;
  readonly failures: readonly VerificationFailure[];
}

/** Guard: `VerificationReport`. */
export function isVerificationReport(v: unknown): v is VerificationReport {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.reportId)) return false;
  if (typeof v.passed !== 'boolean') return false;
  if (!Number.isInteger(v.casesChecked) || (v.casesChecked as number) < 0) return false;
  if (!Array.isArray(v.failures)) return false;
  if (!v.failures.every((failure) => isVerificationFailure(failure))) return false;
  // Consistency law: passed iff no failure was found (boolean + reasons, never scores).
  return v.passed === (v.failures.length === 0);
}

// ---------------------------------------------------------------------------
// The verifier (pure, total, fail-closed, never scores)
// ---------------------------------------------------------------------------

/**
 * Verify an evidence chain: validate every case structurally (collect-all),
 * then evaluate each case's claim. Every failure is located by
 * (caseId, code, index); the report's `passed` is boolean only.
 *
 * Determinism: the same case list always produces the deeply-equal report
 * (failures in case order, then item order). Never throws.
 */
export function verifyEvidenceChain(cases: readonly unknown[]): VerificationResult<VerificationReport> {
  if (!Array.isArray(cases)) {
    return { ok: false, errors: [invalidType('verifyEvidenceChain expects an array of verification cases')] };
  }
  const errors: VerificationError[] = [];
  const seenCaseIds = new Set<string>();
  const validated: VerificationCase[] = [];
  cases.forEach((candidate, index) => {
    const casePath = `cases[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(invalidType(`${casePath} must be an object`));
      return;
    }
    if (candidate.kind === undefined) {
      errors.push(missingField(`${casePath}.kind`));
      return;
    }
    if (!VERIFICATION_CASE_KINDS.includes(candidate.kind as VerificationCase['kind'])) {
      errors.push(invalidField(`${casePath}.kind`, `must be one of ${VERIFICATION_CASE_KINDS.join(' | ')}`));
      return;
    }
    if (candidate.caseId === undefined) {
      errors.push(missingField(`${casePath}.caseId`));
      return;
    }
    if (!isVerificationCaseId(candidate.caseId)) {
      errors.push(invalidField(`${casePath}.caseId`, 'must be a non-empty case id'));
      return;
    }
    if (seenCaseIds.has(candidate.caseId)) {
      errors.push(invalidField(`${casePath}.caseId`, `duplicate case id "${candidate.caseId}"`));
      return;
    }
    if (!isVerificationCase(candidate)) {
      if (candidate.kind === 'lineage-hash') {
        if (candidate.recordRef === undefined) errors.push(missingField(`${casePath}.recordRef`));
        else if (!isNonEmptyString(candidate.recordRef)) errors.push(invalidField(`${casePath}.recordRef`, 'must be a non-empty record ref'));
        if (candidate.payload === undefined) errors.push(missingField(`${casePath}.payload`));
        else if (!isJsonObject(candidate.payload)) errors.push(invalidField(`${casePath}.payload`, 'must be a JSON object (the canonical payload)'));
        if (candidate.claimedHash === undefined) errors.push(missingField(`${casePath}.claimedHash`));
        else if (!isNonEmptyString(candidate.claimedHash)) errors.push(invalidField(`${casePath}.claimedHash`, 'must be a non-empty claimed hash'));
      } else {
        if (candidate.asOf === undefined) errors.push(missingField(`${casePath}.asOf`));
        else if (!isTimestampMs(candidate.asOf)) errors.push(invalidField(`${casePath}.asOf`, 'must be a valid TimestampMs'));
        const items = candidate.kind === 'quartet-monotone' ? candidate.quartets : candidate.samples;
        const itemName = candidate.kind === 'quartet-monotone' ? 'quartets' : 'samples';
        if (items === undefined) errors.push(missingField(`${casePath}.${itemName}`));
        else if (!Array.isArray(items)) errors.push(invalidField(`${casePath}.${itemName}`, `must be an array of ${itemName}`));
        else if (items.length === 0) errors.push(invalidField(`${casePath}.${itemName}`, 'must be non-empty — a case claims something about its items'));
        else if (!items.every(isAvailabilityQuartet) && !items.every(isLeakageSample)) {
          errors.push(invalidField(`${casePath}.${itemName}`, `every ${itemName.slice(0, -1)} must carry structurally valid timestamps`));
        }
      }
      return;
    }
    seenCaseIds.add(candidate.caseId);
    validated.push(candidate);
  });
  if (errors.length > 0) return { ok: false, errors };

  const failures: VerificationFailure[] = [];
  for (const verificationCase of validated) {
    verifyCase(verificationCase, failures);
  }

  const reportId = `vr:${stableDigestJson(validated as unknown as JsonValue)}` as VerificationReportId;
  return ok(
    deepFreeze({
      reportId,
      passed: failures.length === 0,
      casesChecked: validated.length,
      failures,
    } satisfies VerificationReport),
  );
}

/** Evaluate one validated case, appending located failures (never scores). */
function verifyCase(verificationCase: VerificationCase, failures: VerificationFailure[]): void {
  switch (verificationCase.kind) {
    case 'lineage-hash': {
      if (!isDigest(verificationCase.claimedHash)) {
        failures.push({ caseId: verificationCase.caseId, code: 'lineage-hash-malformed', index: 0 });
        return;
      }
      const recomputed = stableDigestJson(verificationCase.payload);
      if (recomputed !== verificationCase.claimedHash) {
        failures.push({ caseId: verificationCase.caseId, code: 'lineage-hash-mismatch', index: 0 });
      }
      return;
    }
    case 'quartet-monotone': {
      verificationCase.quartets.forEach((quartet, index) => {
        if (quartet.available_time < quartet.event_time) {
          failures.push({ caseId: verificationCase.caseId, code: 'quartet-ordering-violation', index });
        }
        if (quartet.available_time > verificationCase.asOf) {
          failures.push({ caseId: verificationCase.caseId, code: 'quartet-future-dated', index });
        }
      });
      return;
    }
    case 'no-future-leakage': {
      verificationCase.samples.forEach((sample, index) => {
        if (sample.available_time > sample.clockNow) {
          failures.push({ caseId: verificationCase.caseId, code: 'future-leakage', index });
        }
        if (sample.available_time > verificationCase.asOf) {
          failures.push({ caseId: verificationCase.caseId, code: 'sample-future-dated', index });
        }
      });
      return;
    }
  }
}

/**
 * Mint the lineage hash of a canonical payload — the SAME digest the
 * evaluation lane mints (mirror algorithm; parity trip-wired in
 * interop.test.ts). Evaluator services use this when recording lineage;
 * {@link verifyEvidenceChain} recomputes it during verification.
 */
export function lineageHashOf(payload: JsonObject): string {
  return stableDigestJson(payload);
}

/** The canonical JSON of a payload — mirror of the evaluation lane's serializer. */
export function canonicalPayload(payload: JsonObject): string {
  return canonicalJson(payload);
}

/** Structural mirror of the evaluation lane's evaluator-version lineage ref (gate input). */
export type { EvaluatorVersionRef };

/** Guard for the mirror re-export above. */
export { isEvaluatorVersionRef };

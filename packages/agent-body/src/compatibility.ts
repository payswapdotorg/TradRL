// @tradrl/agent-body — substrate compatibility & substitution testing contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation — a model
// upgrade triggers compatibility testing, NOT body redevelopment); spec/
// DOMAIN-MODEL.md (Possession validity); spec/LEARNING-LOOP.md ("Body Version
// -> compatibility -> shadow"); spec/EVALUATION-PROTOCOL.md layer 7
// (model substitution); spec/REQUIREMENTS.md R28 (model/body compatibility
// testing).
//
// This module is pure: given a body's `SubstrateCompatibilityManifest` and a
// `CognitiveSubstrate`, it produces a deterministic `CompatibilityVerdict`
// (satisfied / violated-with-reasons). Tested-substrate records bind
// substitution-test results to evidence references.

import {
  type EvidenceRef,
  type ISO8601,
  type SubstitutionClass,
  type SubstrateRef,
  isArrayOf,
  isEnum,
  isISO8601,
  isNonEmptyString,
  isNonNegativeInteger,
  isNull,
  isNumber,
  isRecord,
  isString,
  isSubstitutionClass,
  isSubstrateRef,
  isEvidenceRef,
} from './primitives';
import { type CognitiveSubstrate, type Modality, isModality } from './substrate';

// ---------------------------------------------------------------------------
// Requirements & constraints
// ---------------------------------------------------------------------------

/** Whether a substrate capability is mandatory for a body. */
export const REQUIREMENT_LEVELS = ['required', 'optional'] as const;

/** Requirement level: `required` (substrate must have it) or `optional`. */
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

/** Guard: `RequirementLevel`. */
export const isRequirementLevel = isEnum(REQUIREMENT_LEVELS);

/**
 * The substrate capabilities a BodyVersion demands. Matching is
 * capability-based and provider-neutral (L13/L14): there is deliberately no
 * provider allow-list — any substrate that satisfies these requirements is a
 * substitution candidate.
 */
export interface SubstrateRequirements {
  /** Minimum acceptable total context window in tokens. */
  readonly minContextWindowTokens: number;
  /** Minimum acceptable single-response output budget in tokens. */
  readonly minMaxOutputTokens: number;
  /** Input modalities the body needs (must be a subset of the substrate's). */
  readonly requiredInputModalities: readonly Modality[];
  /** Output modalities the body needs. */
  readonly requiredOutputModalities: readonly Modality[];
  /** Whether tool calling is required of the substrate. */
  readonly toolUse: RequirementLevel;
  /** Whether structured/schema-constrained output is required of the substrate. */
  readonly structuredOutput: RequirementLevel;
}

/** Guard: `SubstrateRequirements`. */
export function isSubstrateRequirements(v: unknown): v is SubstrateRequirements {
  if (!isRecord(v)) return false;
  return (
    isPositiveIntegerOrZero(v.minContextWindowTokens) &&
    isPositiveIntegerOrZero(v.minMaxOutputTokens) &&
    isArrayOf(v.requiredInputModalities, isModality) &&
    isArrayOf(v.requiredOutputModalities, isModality) &&
    isRequirementLevel(v.toolUse) &&
    isRequirementLevel(v.structuredOutput)
  );
}

function isPositiveIntegerOrZero(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v >= 0;
}

/**
 * Hard substitution constraints. `null` means unconstrained. An empty
 * `allowedSubstitutionClasses` array is meaningful: NO substitution class is
 * approved yet (a body may not be possessed until the list is non-empty).
 */
export interface SubstrateConstraints {
  /** Substitution classes allowed to possess the body, or `null` for any class. */
  readonly allowedSubstitutionClasses: readonly SubstitutionClass[] | null;
  /** Ceiling on estimated input cost per 1M tokens, or `null`. */
  readonly maxInputCostPerMTokens: number | null;
  /** Ceiling on estimated output cost per 1M tokens, or `null`. */
  readonly maxOutputCostPerMTokens: number | null;
  /** Ceiling on estimated p95 time-to-first-token in milliseconds, or `null`. */
  readonly maxP95LatencyMs: number | null;
}

function isNullableNonNegativeInteger(v: unknown): v is number | null {
  return isNull(v) || (isNumber(v) && Number.isInteger(v) && v >= 0);
}

/** Guard: `SubstrateConstraints`. */
export function isSubstrateConstraints(v: unknown): v is SubstrateConstraints {
  if (!isRecord(v)) return false;
  return (
    (isNull(v.allowedSubstitutionClasses) ||
      isArrayOf(v.allowedSubstitutionClasses, isSubstitutionClass)) &&
    isNullableNonNegativeInteger(v.maxInputCostPerMTokens) &&
    isNullableNonNegativeInteger(v.maxOutputCostPerMTokens) &&
    isNullableNonNegativeInteger(v.maxP95LatencyMs)
  );
}

// ---------------------------------------------------------------------------
// Tested-substrate records
// ---------------------------------------------------------------------------

/** Outcome of a recorded substitution test against one substrate. */
export const SUBSTITUTION_TEST_RESULTS = ['pass', 'fail', 'conditional'] as const;

/**
 * Substitution test outcome: `pass`, `fail`, or `conditional`
 * (passed with caveats, e.g. degraded behavior under specific regimes).
 */
export type SubstitutionTestResult = (typeof SUBSTITUTION_TEST_RESULTS)[number];

/** Guard: `SubstitutionTestResult`. */
export const isSubstitutionTestResult = isEnum(SUBSTITUTION_TEST_RESULTS);

/**
 * A recorded substitution test: binds one substrate reference to a result and
 * an evidence reference. Records live inside the body's compatibility manifest
 * and are therefore frozen with the BodyVersion that carries them (L3):
 * adding or changing a test result requires a NEW BodyVersion.
 */
export interface TestedSubstrateRecord {
  /** The substrate that was tested (canonical `provider/modelId@modelVersion`). */
  readonly substrate: SubstrateRef;
  /** Test outcome. */
  readonly result: SubstitutionTestResult;
  /** When the test was recorded. */
  readonly testedAt: ISO8601;
  /** Evidence capsule reference for the test run (opaque; evidence lane). */
  readonly evidence: EvidenceRef;
  /** Optional human-readable caveats (e.g. for `conditional` results). */
  readonly notes: string | null;
}

/** Guard: `TestedSubstrateRecord`. */
export function isTestedSubstrateRecord(v: unknown): v is TestedSubstrateRecord {
  if (!isRecord(v)) return false;
  return (
    isSubstrateRef(v.substrate) &&
    isSubstitutionTestResult(v.result) &&
    isISO8601(v.testedAt) &&
    isEvidenceRef(v.evidence) &&
    (isNull(v.notes) || isNonEmptyString(v.notes))
  );
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * The substrate compatibility manifest carried by every BodyVersion: what the
 * body requires of substrates, hard substitution constraints, and the frozen
 * history of substitution tests performed for this body version.
 */
export interface SubstrateCompatibilityManifest {
  /** Capabilities a substrate must provide. */
  readonly requirements: SubstrateRequirements;
  /** Hard constraints on substitution class, cost and latency. */
  readonly constraints: SubstrateConstraints;
  /** Recorded substitution tests (frozen with the version — see L3). */
  readonly testedSubstrates: readonly TestedSubstrateRecord[];
}

/** Guard: `SubstrateCompatibilityManifest`. */
export function isSubstrateCompatibilityManifest(
  v: unknown,
): v is SubstrateCompatibilityManifest {
  if (!isRecord(v)) return false;
  return (
    isSubstrateRequirements(v.requirements) &&
    isSubstrateConstraints(v.constraints) &&
    isArrayOf(v.testedSubstrates, isTestedSubstrateRecord)
  );
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/** Check codes, in the fixed evaluation order. */
export const COMPATIBILITY_CHECK_CODES = [
  'context-window',
  'output-tokens',
  'input-modalities',
  'output-modalities',
  'tool-use',
  'structured-output',
  'substitution-class',
  'input-cost',
  'output-cost',
  'p95-latency',
] as const;

/** One compatibility check dimension. */
export type CompatibilityCheckCode = (typeof COMPATIBILITY_CHECK_CODES)[number];

/** Guard: `CompatibilityCheckCode`. */
export const isCompatibilityCheckCode = isEnum(COMPATIBILITY_CHECK_CODES);

/** A single check result: dimension, pass/fail, and expected vs actual values. */
export interface CompatibilityCheck {
  /** Check dimension. */
  readonly code: CompatibilityCheckCode;
  /** Whether the substrate satisfied this dimension. */
  readonly satisfied: boolean;
  /** What the body requires (human-readable). */
  readonly expected: string;
  /** What the substrate provides (human-readable). */
  readonly actual: string;
}

/** A violated check, with an explicit human-readable reason. */
export interface CompatibilityViolation {
  /** Check dimension that failed. */
  readonly code: CompatibilityCheckCode;
  /** What the body requires. */
  readonly expected: string;
  /** What the substrate provides. */
  readonly actual: string;
  /** Human-readable reason this substitution is rejected. */
  readonly message: string;
}

/**
 * Deterministic compatibility verdict: `satisfied === true` iff `violations`
 * is empty. `checks` always contains one entry per check code, in the fixed
 * order, so verdicts are auditable and diffable.
 */
export interface CompatibilityVerdict {
  /** Whether the substrate satisfies the body's compatibility manifest. */
  readonly satisfied: boolean;
  /** All checks in fixed order (pass and fail). */
  readonly checks: readonly CompatibilityCheck[];
  /** The violated checks with reasons — empty iff `satisfied`. */
  readonly violations: readonly CompatibilityViolation[];
}

function check(
  code: CompatibilityCheckCode,
  satisfied: boolean,
  expected: string,
  actual: string,
): CompatibilityCheck {
  return { code, satisfied, expected, actual };
}

function violationOf(checkResult: CompatibilityCheck): CompatibilityViolation {
  return {
    code: checkResult.code,
    expected: checkResult.expected,
    actual: checkResult.actual,
    message: `${checkResult.code}: body requires ${checkResult.expected}, substrate provides ${checkResult.actual}`,
  };
}

function missingModalities(required: readonly Modality[], available: readonly Modality[]): string {
  const availableSet = new Set<string>(available);
  return required.filter((m) => !availableSet.has(m)).join(', ');
}

/**
 * Evaluates whether `substrate` satisfies `manifest`. Pure and deterministic:
 * checks run in the fixed `COMPATIBILITY_CHECK_CODES` order and the verdict
 * reports every violated dimension with an explicit reason.
 *
 * Possession law (contracts/agent/possession.md): a substrate that does not
 * produce a satisfied verdict cannot possess the body.
 */
export function evaluateSubstrateCompatibility(
  manifest: SubstrateCompatibilityManifest,
  substrate: CognitiveSubstrate,
): CompatibilityVerdict {
  const requirements = manifest.requirements;
  const constraints = manifest.constraints;
  const capabilities = substrate.capabilities;
  const costLatency = substrate.costLatency;

  const checks: CompatibilityCheck[] = [
    check(
      'context-window',
      capabilities.contextWindowTokens >= requirements.minContextWindowTokens,
      `context window >= ${requirements.minContextWindowTokens} tokens`,
      `context window ${capabilities.contextWindowTokens} tokens`,
    ),
    check(
      'output-tokens',
      capabilities.maxOutputTokens >= requirements.minMaxOutputTokens,
      `max output >= ${requirements.minMaxOutputTokens} tokens`,
      `max output ${capabilities.maxOutputTokens} tokens`,
    ),
    check(
      'input-modalities',
      requirements.requiredInputModalities.every((m) =>
        capabilities.inputModalities.includes(m),
      ),
      `input modalities ⊇ {${[...requirements.requiredInputModalities].join(', ')}}`,
      `input modalities {${[...capabilities.inputModalities].join(', ')}}`,
    ),
    check(
      'output-modalities',
      requirements.requiredOutputModalities.every((m) =>
        capabilities.outputModalities.includes(m),
      ),
      `output modalities ⊇ {${[...requirements.requiredOutputModalities].join(', ')}}`,
      `output modalities {${[...capabilities.outputModalities].join(', ')}}`,
    ),
    check(
      'tool-use',
      requirements.toolUse === 'optional' || capabilities.toolUse,
      `tool use ${requirements.toolUse}`,
      `tool use ${capabilities.toolUse ? 'supported' : 'unsupported'}`,
    ),
    check(
      'structured-output',
      requirements.structuredOutput === 'optional' || capabilities.structuredOutput,
      `structured output ${requirements.structuredOutput}`,
      `structured output ${capabilities.structuredOutput ? 'supported' : 'unsupported'}`,
    ),
    check(
      'substitution-class',
      constraints.allowedSubstitutionClasses === null ||
        constraints.allowedSubstitutionClasses.includes(substrate.substitutionClass),
      constraints.allowedSubstitutionClasses === null
        ? 'any substitution class'
        : `substitution class ∈ {${[...constraints.allowedSubstitutionClasses].join(', ')}}`,
      `substitution class ${substrate.substitutionClass}`,
    ),
    check(
      'input-cost',
      constraints.maxInputCostPerMTokens === null ||
        costLatency.inputCostPerMTokens <= constraints.maxInputCostPerMTokens,
      constraints.maxInputCostPerMTokens === null
        ? 'no input cost ceiling'
        : `input cost <= ${constraints.maxInputCostPerMTokens} per 1M tokens`,
      `input cost ${costLatency.inputCostPerMTokens} ${costLatency.currency} per 1M tokens`,
    ),
    check(
      'output-cost',
      constraints.maxOutputCostPerMTokens === null ||
        costLatency.outputCostPerMTokens <= constraints.maxOutputCostPerMTokens,
      constraints.maxOutputCostPerMTokens === null
        ? 'no output cost ceiling'
        : `output cost <= ${constraints.maxOutputCostPerMTokens} per 1M tokens`,
      `output cost ${costLatency.outputCostPerMTokens} ${costLatency.currency} per 1M tokens`,
    ),
    check(
      'p95-latency',
      constraints.maxP95LatencyMs === null || costLatency.p95LatencyMs <= constraints.maxP95LatencyMs,
      constraints.maxP95LatencyMs === null
        ? 'no p95 latency ceiling'
        : `p95 latency <= ${constraints.maxP95LatencyMs} ms`,
      `p95 latency ${costLatency.p95LatencyMs} ms`,
    ),
  ];

  const violations = checks.filter((c) => !c.satisfied).map(violationOf);
  return { satisfied: violations.length === 0, checks, violations };
}

/** Convenience predicate: does `substrate` satisfy `manifest`? */
export function substrateSatisfiesManifest(
  manifest: SubstrateCompatibilityManifest,
  substrate: CognitiveSubstrate,
): boolean {
  return evaluateSubstrateCompatibility(manifest, substrate).satisfied;
}

/**
 * Returns the most recent (last) tested-substrate record for `ref`, or `null`
 * when that substrate has never been tested against this manifest.
 */
export function findTestedSubstrate(
  manifest: SubstrateCompatibilityManifest,
  ref: SubstrateRef,
): TestedSubstrateRecord | null {
  let found: TestedSubstrateRecord | null = null;
  for (const record of manifest.testedSubstrates) {
    if (record.substrate === ref) found = record;
  }
  return found;
}

/**
 * `true` when `substrate` has at least one recorded `pass` substitution test
 * in `manifest`. Strict: `conditional` results do not count as passing.
 */
export function hasPassingSubstitutionTest(
  manifest: SubstrateCompatibilityManifest,
  substrate: CognitiveSubstrate,
): boolean {
  return manifest.testedSubstrates.some(
    (record) => record.substrate === substrate.id && record.result === 'pass',
  );
}

// --- Verdict guards ----------------------------------------------------------

/** Guard: `CompatibilityCheck`. */
export function isCompatibilityCheck(v: unknown): v is CompatibilityCheck {
  if (!isRecord(v)) return false;
  return (
    isCompatibilityCheckCode(v.code) &&
    typeof v.satisfied === 'boolean' &&
    isString(v.expected) &&
    isString(v.actual)
  );
}

/** Guard: `CompatibilityViolation`. */
export function isCompatibilityViolation(v: unknown): v is CompatibilityViolation {
  if (!isRecord(v)) return false;
  return (
    isCompatibilityCheckCode(v.code) &&
    isString(v.expected) &&
    isString(v.actual) &&
    isNonEmptyString(v.message)
  );
}

/** Guard: `CompatibilityVerdict`. */
export function isCompatibilityVerdict(v: unknown): v is CompatibilityVerdict {
  if (!isRecord(v)) return false;
  return (
    typeof v.satisfied === 'boolean' &&
    isArrayOf(v.checks, isCompatibilityCheck) &&
    isArrayOf(v.violations, isCompatibilityViolation) &&
    (v.satisfied ? (v.violations as readonly unknown[]).length === 0 : true)
  );
}

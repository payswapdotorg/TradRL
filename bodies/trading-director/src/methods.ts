// @tradrl/body-trading-director — the DECLARED-METHOD discipline.
//
// Owning Work Order: T024, "Synthesis and the decision record": "The
// composition law is DECLARED and versioned (methods.ts: a
// MethodRecord/MethodRegistry discipline like the researchers' — a
// decision produced without a declared synthesis-method version is a
// typed error)."
//
// A MethodRecord is a versioned, structured, deeply-frozen declaration of
// HOW four research publications become one portfolio-level decision:
// the declared QUORUM (how many of the four lanes must be present —
// declared here, never hardcoded), the declared STANCE MAP (how each
// lane's report-level dominant category becomes a direction — never
// guessed), the declared LANE WEIGHTS, the declared TILT UNIT and
// ADJUSTMENT THRESHOLD (when a net tilt becomes a target-allocation
// adjustment), the declared OUTPUT SCALE/ROUNDING, and the declared
// CONFLICT POLICY (when conflicting positions are irreconcilable). Every
// knob is a declared field, never an implicit constant. The registry is
// the closed set a director body may run; every decision cites
// (methodId, methodVersion) and validation re-resolves the citation
// against the registry — a decision citing an unknown method id, a stale
// version, or a method of the wrong kind is a TYPED ERROR, not a warning.
//
// The four research lanes (the input enumeration — T021/T022/T023):
//   sentiment     — @tradrl/body-sentiment-researcher   (dominant polarity)
//   regime        — @tradrl/body-regime-researcher      (dominant regime label)
//   fundamental   — @tradrl/body-fundamental-researcher (dominant stance)
//   cross-market  — @tradrl/body-cross-market-researcher (dominant relation kind)
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock (`declaredAt` is an explicit literal instant);
// deepFreeze everything public; deterministic registry digest (L9 — the
// registry identity binds into every decision's lineage).

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isMemberOf, isArrayOf, canonicalJson, stableDigestJson, isDigest } from './primitives';
import { type MethodId, type MethodVersionRef, isMethodId, isMethodVersionRef } from './ids';
import { isUnsignedDecimal, isSignedDecimal } from './decimals';
import { type DirectorError, type DirectorResult, type DirectorValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// The research-lane enumeration (the four consumers of D-020)
// ---------------------------------------------------------------------------

/**
 * The four research lanes the decision hub consumes (D-020): one lane
 * per research body. Closed vocabulary — T021/T022/T023 own the bodies.
 */
export const RESEARCH_LANES = ['sentiment', 'regime', 'fundamental', 'cross-market'] as const;

/** A research lane. */
export type ResearchLane = (typeof RESEARCH_LANES)[number];

/** Guard: a research lane. */
export const isResearchLane = (v: unknown): v is ResearchLane => isMemberOf(RESEARCH_LANES, v);

/** The number of research lanes — the quorum ceiling. */
export const RESEARCH_LANE_COUNT: number = RESEARCH_LANES.length;

// ---------------------------------------------------------------------------
// The synthesis-direction vocabulary (what a lane's stance contributes)
// ---------------------------------------------------------------------------

/** The closed direction vocabulary a lane stance can contribute. */
export const SYNTHESIS_DIRECTIONS = ['bullish', 'bearish', 'flat'] as const;

/** A synthesis direction. */
export type SynthesisDirection = (typeof SYNTHESIS_DIRECTIONS)[number];

/** Guard: a synthesis direction. */
export const isSynthesisDirection = (v: unknown): v is SynthesisDirection =>
  isMemberOf(SYNTHESIS_DIRECTIONS, v);

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const METHOD_KINDS = ['synthesis'] as const;

/** A declared method kind. */
export type MethodKind = (typeof METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isMethodKind = (v: unknown): v is MethodKind => isMemberOf(METHOD_KINDS, v);

/** The declared input class (closed vocabulary). */
export const METHOD_INPUTS = ['research-reports'] as const;

/** A declared method input class. */
export type MethodInput = (typeof METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isMethodInput = (v: unknown): v is MethodInput => isMemberOf(METHOD_INPUTS, v);

// ---------------------------------------------------------------------------
// The conflict-policy vocabulary (when conflicts are irreconcilable)
// ---------------------------------------------------------------------------

/**
 * The declared conflict policies — when a conflict among per-body
 * positions is IRRECONCILABLE under the method (producing an
 * EscalationRecord instead of a decision):
 * - 'record-and-majority': conflicts are always recorded with per-body
 *   positions and the strict majority direction stands; a tie among
 *   non-flat directions yields a typed no-change verdict, never an
 *   escalation. Conflicts are NEVER silently averaged — the conflict
 *   record is the evidence.
 * - 'escalate-on-no-majority': a conflicted instrument with no strict
 *   majority among its non-flat positions is irreconcilable — the
 *   director escalates instead of emitting a silent no-change.
 * - 'escalate-on-any': ANY conflict is irreconcilable — the strictest
 *   discipline (the conservative variant's declaration).
 */
export const CONFLICT_POLICIES = ['record-and-majority', 'escalate-on-no-majority', 'escalate-on-any'] as const;

/** A declared conflict policy. */
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

/** Guard: a declared conflict policy. */
export const isConflictPolicy = (v: unknown): v is ConflictPolicy =>
  isMemberOf(CONFLICT_POLICIES, v);

// ---------------------------------------------------------------------------
// Structured parameters (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/** One declared stance-map entry: (lane, category) -> direction. */
export interface StanceMapEntry {
  readonly lane: ResearchLane;
  /** The lane's report-level dominant category, verbatim (e.g. 'positive', 'trending-up'). */
  readonly category: string;
  readonly direction: SynthesisDirection;
}

/** One declared lane weight: the lane's contribution to the net tilt. */
export interface LaneWeightEntry {
  readonly lane: ResearchLane;
  /** Unsigned decimal — the lane's tilt weight (scale-free). */
  readonly weight: string;
}

/**
 * Synthesis parameters: how the four research publications become one
 * portfolio-level decision. Every threshold, scale, mapping and policy is
 * declared here — nothing is implicit.
 */
export interface SynthesisParameters {
  readonly kind: 'synthesis';
  readonly input: 'research-reports';
  /**
   * The declared QUORUM: how many of the four lanes must be present
   * (consumed or conflicted) for a decision to be expressible. 1..4.
   * A quorum below this is an EscalationRecord (reason 'quorum-unmet'),
   * never a silent default. Declared by the method — never hardcoded.
   */
  readonly quorum: number;
  /**
   * The DECLARED stance map: how each lane's report-level dominant
   * category becomes a direction. A category absent from the map
   * contributes the declared `unmappedCategory` direction — never a
   * guess.
   */
  readonly stanceMap: readonly StanceMapEntry[];
  /** The declared fallback direction for unmapped categories. */
  readonly unmappedCategory: 'flat';
  /** The declared per-lane tilt weights (all four lanes, exactly once each). */
  readonly laneWeights: readonly LaneWeightEntry[];
  /**
   * The declared tilt unit: weight units of net tilt per unit of
   * target-allocation delta (unsigned decimal).
   */
  readonly tiltUnit: string;
  /**
   * The declared adjustment threshold: an instrument's |net tilt| at or
   * above this value produces a target-allocation adjustment; below it
   * contributes to a typed no-change verdict (unsigned decimal).
   */
  readonly adjustmentThreshold: string;
  /** The declared fixed decimal scale of every output weight delta. */
  readonly outputScale: number;
  /** The declared rounding mode for scaled arithmetic. */
  readonly rounding: 'half-even' | 'truncate';
  /** The declared conflict policy (see `ConflictPolicy`). */
  readonly conflictPolicy: ConflictPolicy;
}

/** The union of declared parameter shapes (one kind: synthesis). */
export type MethodParameters = SynthesisParameters;

// ---------------------------------------------------------------------------
// MethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every
 * director decision must cite. A decision produced without a declared
 * synthesis-method version is a typed error — the method-honesty law.
 */
export interface MethodRecord {
  /** Method identity (e.g. `method/director/synthesis`). */
  readonly methodId: MethodId;
  /** What the method is for. */
  readonly kind: MethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: MethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: MethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set a director body may run. */
export interface MethodRegistry {
  /** The declared methods, canonically ordered by method id. */
  readonly methods: readonly MethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isMethodKind(kind)) return [`${path}.kind: must be one of ${METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isMethodInput(input)) return [`${path}.input: must be one of ${METHOD_INPUTS.join('|')}`];
  if (kind === 'synthesis') {
    if (input !== 'research-reports') {
      problems.push(`${path}.input: synthesis methods consume research-reports`);
    }
    // THE QUORUM LAW: the quorum is declared here, never hardcoded.
    if (!isPositiveInteger(v.quorum) || (v.quorum as number) > RESEARCH_LANE_COUNT) {
      problems.push(`${path}.quorum: must be an integer in [1, ${RESEARCH_LANE_COUNT}]`);
    }
    if (v.unmappedCategory !== 'flat') {
      problems.push(`${path}.unmappedCategory: must be 'flat' (an unmapped category is never a guess)`);
    }
    if (!Array.isArray(v.stanceMap) || (v.stanceMap as readonly unknown[]).length === 0) {
      problems.push(`${path}.stanceMap: must be a non-empty array of { lane, category, direction } declarations`);
    } else {
      const seenPairs = new Set<string>();
      for (const entry of v.stanceMap as readonly Record<string, unknown>[]) {
        if (!isRecord(entry) || !isResearchLane(entry.lane)) {
          problems.push(`${path}.stanceMap: lane must be one of ${RESEARCH_LANES.join('|')}`);
        }
        if (!isRecord(entry) || !isNonEmptyString(entry.category)) {
          problems.push(`${path}.stanceMap: category must be a non-empty string`);
        }
        if (!isRecord(entry) || !isSynthesisDirection(entry.direction)) {
          problems.push(`${path}.stanceMap: direction must be one of ${SYNTHESIS_DIRECTIONS.join('|')}`);
        }
        if (isRecord(entry) && isResearchLane(entry.lane) && isNonEmptyString(entry.category)) {
          const key = `${entry.lane}|${entry.category}`;
          if (seenPairs.has(key)) {
            problems.push(`${path}.stanceMap: duplicate (lane, category) ${JSON.stringify(key)}`);
          }
          seenPairs.add(key);
        }
      }
    }
    if (!Array.isArray(v.laneWeights)) {
      problems.push(`${path}.laneWeights: must be an array of { lane, weight } declarations`);
    } else {
      const seenLanes = new Set<string>();
      for (const entry of v.laneWeights as readonly Record<string, unknown>[]) {
        if (!isRecord(entry) || !isResearchLane(entry.lane)) {
          problems.push(`${path}.laneWeights: lane must be one of ${RESEARCH_LANES.join('|')}`);
          continue;
        }
        if (seenLanes.has(entry.lane)) {
          problems.push(`${path}.laneWeights: duplicate lane ${JSON.stringify(entry.lane)}`);
        }
        seenLanes.add(entry.lane);
        if (!isUnsignedDecimal(entry.weight)) {
          problems.push(`${path}.laneWeights: weight must be an unsigned decimal string`);
        }
      }
      for (const lane of RESEARCH_LANES) {
        if (!seenLanes.has(lane)) {
          problems.push(`${path}.laneWeights: lane ${JSON.stringify(lane)} must declare a weight (all four lanes, exactly once each)`);
        }
      }
    }
    if (!isUnsignedDecimal(v.tiltUnit)) {
      problems.push(`${path}.tiltUnit: must be an unsigned decimal string`);
    }
    if (!isUnsignedDecimal(v.adjustmentThreshold)) {
      problems.push(`${path}.adjustmentThreshold: must be an unsigned decimal string`);
    }
    if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
      problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
    if (!isConflictPolicy(v.conflictPolicy)) {
      problems.push(`${path}.conflictPolicy: must be one of ${CONFLICT_POLICIES.join('|')}`);
    }
  }
  return problems;
}

/** Guard: `MethodRecord` (total — untrusted input never throws). */
export function isMethodRecord(v: unknown): v is MethodRecord {
  if (!isRecord(v)) return false;
  return (
    isMethodId(v.methodId) &&
    isMethodKind(v.kind) &&
    isMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateMethodRecord(v: unknown, path = ''): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${METHOD_KINDS.join('|')}`));
  if (!isMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
  if (!isRecord(v.parameters)) {
    errors.push(invalidType(`${path}parameters`, 'an object'));
  } else {
    for (const problem of parametersProblems(`${path}parameters`, v.parameters)) {
      errors.push(invalidField(`${path}parameters`, problem.replace(/^parameters: /, '')));
    }
    // THE QUORUM LAW (typed): a synthesis method without a declared,
    // well-formed quorum refuses validation.
    if (isRecord(v.parameters) && !isPositiveInteger(v.parameters.quorum)) {
      errors.push({
        code: 'quorum_not_declared',
        path: `${path}parameters.quorum`,
        message: 'the quorum is declared by the synthesis method (an integer in [1, 4]) — never hardcoded',
      });
    }
  }
  if (!isNonEmptyString(v.declaredBy)) errors.push(invalidField(`${path}declaredBy`, 'must be a non-empty string'));
  if (!isNonNegativeInteger(v.declaredAt)) errors.push(invalidField(`${path}declaredAt`, 'must be a non-negative epoch-millisecond integer'));
  return errors;
}

/**
 * Creates a validated, deeply-frozen method record. Refusal is typed data.
 */
export function createMethodRecord(draft: unknown): DirectorResult<MethodRecord> {
  const errors = validateMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as MethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateMethodRegistry(v: unknown): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isMethodId(method.methodId)) {
      if (seen.has(method.methodId)) {
        errors.push({ code: 'duplicate_method', path: `methods[${index}].methodId`, message: `duplicate method id ${method.methodId}` });
      }
      seen.add(method.methodId);
    }
  });
  return errors;
}

/**
 * Creates a validated, deeply-frozen method registry. Methods are stored
 * in CANONICAL ORDER (sorted by canonical JSON of the record — order can
 * never leak into the registry digest or into decision bytes).
 */
export function createMethodRegistry(methods: readonly unknown[]): DirectorResult<MethodRegistry> {
  const errors = validateMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly MethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findMethod(registry: MethodRegistry, methodId: string): MethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/** Resolves a (methodId, version) citation; typed errors on drift. */
export function resolveMethodCitation(
  registry: MethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: MethodKind,
): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isMethodId(methodId)) {
    return [invalidField('methodId', 'must match the compact identifier pattern')];
  }
  if (!isMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — a decision without a declared synthesis method is an unsupported claim`,
    });
    return errors;
  }
  if (isMethodVersionRef(version) && method.version !== version) {
    errors.push({
      code: 'method_version_mismatch',
      path: 'methodVersion',
      message: `method ${methodId} is declared at version ${method.version}, cited at ${version}`,
    });
  }
  if (method.kind !== expectedKind) {
    errors.push({
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${methodId} is declared as '${method.kind}', used as '${expectedKind}'`,
    });
  }
  return errors;
}

/** Guard: `MethodRegistry`. */
export function isMethodRegistry(v: unknown): v is MethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `MethodRegistry`. */
export function validateMethodRegistryRecord(v: unknown): DirectorValidation<MethodRegistry> {
  const errors = validateMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as DirectorValidation<MethodRegistry>;
  if (isRecord(v) && !isMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as DirectorValidation<MethodRegistry>;
  }
  return validationOf(v as MethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the trading-director
// body runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/**
 * The canonical method registry for the trading-director body: the
 * canonical synthesis method (quorum 3, record-and-majority conflicts)
 * and its conservative variant (quorum 4, escalate on ANY conflict).
 * `declaredAt` instants are explicit literals (no clock).
 */
export const DIRECTOR_METHOD_REGISTRY: MethodRegistry = (() => {
  const construction = createMethodRegistry([
    {
      methodId: 'method/director/synthesis',
      kind: 'synthesis',
      version: '1.0.0',
      parameters: {
        kind: 'synthesis',
        input: 'research-reports',
        quorum: 3,
        unmappedCategory: 'flat',
        stanceMap: [
          { lane: 'sentiment', category: 'positive', direction: 'bullish' },
          { lane: 'sentiment', category: 'negative', direction: 'bearish' },
          { lane: 'sentiment', category: 'mixed', direction: 'flat' },
          { lane: 'sentiment', category: 'neutral', direction: 'flat' },
          { lane: 'sentiment', category: 'no-reading', direction: 'flat' },
          { lane: 'regime', category: 'trending-up', direction: 'bullish' },
          { lane: 'regime', category: 'trending-down', direction: 'bearish' },
          { lane: 'regime', category: 'ranging', direction: 'flat' },
          { lane: 'regime', category: 'volatile', direction: 'flat' },
          { lane: 'regime', category: 'quiet', direction: 'flat' },
          { lane: 'regime', category: 'no-classification', direction: 'flat' },
          { lane: 'fundamental', category: 'positive', direction: 'bullish' },
          { lane: 'fundamental', category: 'negative', direction: 'bearish' },
          { lane: 'fundamental', category: 'neutral', direction: 'flat' },
          { lane: 'fundamental', category: 'no-assessment', direction: 'flat' },
          { lane: 'cross-market', category: 'co-movement', direction: 'flat' },
          { lane: 'cross-market', category: 'lead-lag', direction: 'flat' },
          { lane: 'cross-market', category: 'spread-divergence', direction: 'flat' },
          { lane: 'cross-market', category: 'no-relationship', direction: 'flat' },
        ],
        laneWeights: [
          { lane: 'sentiment', weight: '1' },
          { lane: 'regime', weight: '1' },
          { lane: 'fundamental', weight: '1' },
          { lane: 'cross-market', weight: '1' },
        ],
        tiltUnit: '0.01',
        adjustmentThreshold: '0.02',
        outputScale: 4,
        rounding: 'half-even',
        conflictPolicy: 'escalate-on-no-majority',
      },
      declaredBy: 'tradrl-director-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/director/synthesis-conservative',
      kind: 'synthesis',
      version: '1.0.0',
      parameters: {
        kind: 'synthesis',
        input: 'research-reports',
        quorum: 4,
        unmappedCategory: 'flat',
        stanceMap: [
          { lane: 'sentiment', category: 'positive', direction: 'bullish' },
          { lane: 'sentiment', category: 'negative', direction: 'bearish' },
          { lane: 'sentiment', category: 'mixed', direction: 'flat' },
          { lane: 'sentiment', category: 'neutral', direction: 'flat' },
          { lane: 'sentiment', category: 'no-reading', direction: 'flat' },
          { lane: 'regime', category: 'trending-up', direction: 'bullish' },
          { lane: 'regime', category: 'trending-down', direction: 'bearish' },
          { lane: 'regime', category: 'ranging', direction: 'flat' },
          { lane: 'regime', category: 'volatile', direction: 'flat' },
          { lane: 'regime', category: 'quiet', direction: 'flat' },
          { lane: 'regime', category: 'no-classification', direction: 'flat' },
          { lane: 'fundamental', category: 'positive', direction: 'bullish' },
          { lane: 'fundamental', category: 'negative', direction: 'bearish' },
          { lane: 'fundamental', category: 'neutral', direction: 'flat' },
          { lane: 'fundamental', category: 'no-assessment', direction: 'flat' },
          { lane: 'cross-market', category: 'co-movement', direction: 'flat' },
          { lane: 'cross-market', category: 'lead-lag', direction: 'flat' },
          { lane: 'cross-market', category: 'spread-divergence', direction: 'flat' },
          { lane: 'cross-market', category: 'no-relationship', direction: 'flat' },
        ],
        laneWeights: [
          { lane: 'sentiment', weight: '1' },
          { lane: 'regime', weight: '1' },
          { lane: 'fundamental', weight: '1' },
          { lane: 'cross-market', weight: '1' },
        ],
        tiltUnit: '0.01',
        adjustmentThreshold: '0.02',
        outputScale: 4,
        rounding: 'half-even',
        conflictPolicy: 'escalate-on-any',
      },
      declaredBy: 'tradrl-director-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
  ]);
  if (!construction.ok) {
    throw new TypeError(
      `DIRECTOR_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared synthesis method of the canonical registry. */
export const DIRECTOR_SYNTHESIS_METHOD: MethodRecord = DIRECTOR_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/director/synthesis',
) as MethodRecord;

/** The declared conservative synthesis method of the canonical registry. */
export const DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD: MethodRecord =
  DIRECTOR_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/director/synthesis-conservative',
  ) as MethodRecord;

// Re-exported for the parameter guards' consumers (scale-free decimal check).
export { isSignedDecimal };

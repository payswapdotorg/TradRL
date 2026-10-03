/**
 * @tradrl/research-benchmarks — the BENCHMARK DEFINITION (Work Order T032):
 * the declared, content-addressed design of one benchmark.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md (evaluation layers, stress,
 * generalization, selection integrity, "Simulation evidence and live
 * evidence are never conflated"), spec/LEARNING-LOOP.md (the regime
 * ladder), ARCHITECTURE-LOCK L9 (the definition is DATA with a
 * content-addressed identity), L12/L15 (tenant/project scoping on every
 * record), L4 (instants injected — definitions carry no instants; the RUN
 * does).
 *
 * THE DEFINITION BINDS, for one benchmark (each law typed, fail-closed):
 * - its DRIVER family: 'walk-forward-replay' (walk-forward evaluation over
 *   replay data — the T009 mirror) or 'regime-ladder-generative'
 *   (evaluation over generative regime populations — the T028 mirror, the
 *   LEARNING-LOOP regime ladder);
 * - its PHASE: 'search' (the run scores in-search window material) or
 *   'holdout' (the run scores reserved unseen material);
 * - its EVIDENCE CLASS: 'simulation' or 'live' (never conflated — the
 *   definition-level law lives in evidence.ts);
 * - its SPLIT PLAN (the T032 driver lane's materialized plan, consumed
 *   through the structural mirror and VERIFIED — content address, leakage
 *   law);
 * - its DATA SOURCE (replay dataset / generative population / live
 *   session — each validated by its mirror module);
 * - its EVALUATOR ref (L9: evaluation is part of lineage);
 * - its STRESS variations (the EVALUATION-PROTOCOL stress axes; may be
 *   empty — an unstressed benchmark is legal, an un DECLARED one is not);
 * - its SCORE SCALE (the exact-decimal scale every recorded score renders
 *   at);
 * - its LADDER LEVEL (the generative driver's regime ladder level);
 * - its SCOPE (tenant/project — L12/L15).
 *
 * Driver/source coherence and evidence-class/source coherence are enforced
 * typed (`invalid_definition`, `evidence_conflated`,
 * `live_claim_on_simulation`). The definition id is content-addressed
 * (`bmk:<digest>` over the canonical definition content) — identical
 * designs address identically (L9).
 */

import { deepFreeze, isNonEmptyString, isRecord, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { isEvaluatorVersionRef, isProjectId, isTenantId } from './ids';
import type { BenchmarkId, EvaluatorVersionRef, ProjectId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';
import { verifySplitPlanMirror, splitPlanDigest } from './split-mirror';
import type { SplitPlanMirror } from './split-mirror';
import { validateReplayDataSource, replaySourceDigest } from './replay-mirror';
import type { ReplayDataSource } from './replay-mirror';
import { validateRegimePopulationSource, generativeSourceDigest, isRegimeLadderLevel } from './generative-mirror';
import type { RegimeLadderLevel, RegimePopulationSource } from './generative-mirror';
import { validateLiveSessionSource, liveSourceDigest, isEvidenceClass, checkEvidenceClass } from './evidence';
import type { EvidenceClass, LiveSessionSource, SourceKind } from './evidence';
import { validateStressVariations } from './stress';
import type { StressVariation } from './stress';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The benchmark driver families (the Work Order's two driver surfaces). */
export const BENCHMARK_DRIVERS = ['walk-forward-replay', 'regime-ladder-generative'] as const;
export type BenchmarkDriver = (typeof BENCHMARK_DRIVERS)[number];

/** Runtime guard for a driver family. */
export function isBenchmarkDriver(value: unknown): value is BenchmarkDriver {
  return typeof value === 'string' && (BENCHMARK_DRIVERS as readonly string[]).includes(value);
}

/** The benchmark phases (the in-search vs holdout distinction). */
export const BENCHMARK_PHASES = ['search', 'holdout'] as const;
export type BenchmarkPhase = (typeof BENCHMARK_PHASES)[number];

/** Runtime guard for a phase. */
export function isBenchmarkPhase(value: unknown): value is BenchmarkPhase {
  return typeof value === 'string' && (BENCHMARK_PHASES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The data source union
// ---------------------------------------------------------------------------

/** The benchmark data source: replay dataset, generative population or live session. */
export type BenchmarkDataSource = ReplayDataSource | RegimePopulationSource | LiveSessionSource;

/** The origin of a data source (the provenance vocabulary mirror). */
export function dataSourceOrigin(source: BenchmarkDataSource): 'historical' | 'generated' {
  return source.origin;
}

/** The kind of a data source (the closed vocabulary). */
export function dataSourceKind(source: BenchmarkDataSource): SourceKind {
  return source.kind;
}

/** The content digest of a validated data source (manifest lineage binding). */
export function dataSourceDigest(source: BenchmarkDataSource): string {
  switch (source.kind) {
    case 'replay-dataset':
      return replaySourceDigest(source);
    case 'generative-population':
      return generativeSourceDigest(source);
    case 'live-session':
      return liveSourceDigest(source);
  }
}

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

/**
 * The benchmark definition: the declared, content-addressed design of one
 * benchmark. All fields are required data — a definition is closed, never
 * a bag.
 */
export interface BenchmarkDefinition {
  /** Derived identity: `bmk:<digest over the canonical definition content>`. */
  readonly benchmark_id: BenchmarkId;
  /** Human-readable name (non-empty). */
  readonly name: string;
  /** The driver family. */
  readonly driver: BenchmarkDriver;
  /** The phase: search (in-search window material) or holdout (reserved unseen material). */
  readonly phase: BenchmarkPhase;
  /** The evidence class — simulation or live, never conflated. */
  readonly evidence_class: EvidenceClass;
  /** The materialized split plan (verified through the T032 mirror). */
  readonly split_plan: SplitPlanMirror;
  /** The data/regime source (validated through its mirror). */
  readonly data_source: BenchmarkDataSource;
  /** The versioned evaluator that scores the benchmark (L9). */
  readonly evaluator: EvaluatorVersionRef;
  /** The declared stress variations (may be empty). */
  readonly stress: readonly StressVariation[];
  /** The exact-decimal scale every recorded score renders at (0..18). */
  readonly score_scale: number;
  /** The regime ladder level (generative driver only; null for the replay driver). */
  readonly ladder_level: RegimeLadderLevel | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The canonical definition JSON (the content-addressing input; no `benchmark_id`). */
export function definitionContentJson(definition: Omit<BenchmarkDefinition, 'benchmark_id'>): JsonObject {
  return {
    name: definition.name,
    driver: definition.driver,
    phase: definition.phase,
    evidence_class: definition.evidence_class,
    split_plan: definition.split_plan as unknown as JsonValue,
    data_source: definition.data_source as unknown as JsonValue,
    evaluator: definition.evaluator,
    stress: definition.stress as unknown as readonly JsonValue[],
    score_scale: definition.score_scale,
    ladder_level: definition.ladder_level,
    tenant: definition.tenant,
    project: definition.project,
  };
}

/** Compute the content address of a benchmark definition: `bmk:<digest>`. */
export function benchmarkId(content: Omit<BenchmarkDefinition, 'benchmark_id'>): BenchmarkId {
  return `bmk:${stableDigestJson(definitionContentJson(content))}` as BenchmarkId;
}

/** The content digest of a validated definition (manifest lineage binding). */
export function definitionDigest(definition: BenchmarkDefinition): string {
  return stableDigestJson(definitionContentJson(definition));
}

/**
 * Collect-all validation of an untrusted benchmark definition. Composes
 * every mirror's validation (split plan, data source, stress) and enforces
 * the coherence laws:
 * - driver/source coherence: 'walk-forward-replay' binds replay datasets
 *   or live sessions; 'regime-ladder-generative' binds generative
 *   populations and DECLARES its ladder level;
 * - evidence-class/source coherence (evidence.ts: `evidence_conflated` /
 *   `live_claim_on_simulation`);
 * - phase coherence: a holdout-phase definition's plan must carry reserved
 *   holdout material (`no_holdout_material`);
 * - the score scale is an integer in [0, 18].
 * On success the definition is returned narrowed, deeply frozen, with the
 * DERIVED content address (`bmk:<digest>`) — a supplied id that disagrees
 * with the content fails `invalid_field` (L9).
 */
export function validateBenchmarkDefinition(value: unknown, path = 'definition'): BenchmarkResult<BenchmarkDefinition> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];

  if (value.name === undefined) errors.push(missingField(`${path}.name`));
  else if (!isNonEmptyString(value.name)) errors.push(invalidField(`${path}.name`, 'must be a non-empty benchmark name'));

  if (value.driver === undefined) errors.push(missingField(`${path}.driver`));
  else if (!isBenchmarkDriver(value.driver)) errors.push(invalidField(`${path}.driver`, `must be one of ${BENCHMARK_DRIVERS.join(' | ')}`));

  if (value.phase === undefined) errors.push(missingField(`${path}.phase`));
  else if (!isBenchmarkPhase(value.phase)) errors.push(invalidField(`${path}.phase`, `must be one of ${BENCHMARK_PHASES.join(' | ')}`));

  if (value.evidence_class === undefined) errors.push(missingField(`${path}.evidence_class`));
  else if (!isEvidenceClass(value.evidence_class)) errors.push(invalidField(`${path}.evidence_class`, `must be one of ${'simulation'} | ${'live'}`));

  let splitPlan: SplitPlanMirror | undefined;
  if (value.split_plan === undefined) {
    errors.push(missingField(`${path}.split_plan`));
  } else {
    const planResult = verifySplitPlanMirror(value.split_plan, `${path}.split_plan`);
    if (planResult.ok) {
      splitPlan = planResult.value;
    } else {
      errors.push(...planResult.errors);
    }
  }

  let dataSource: BenchmarkDataSource | undefined;
  if (value.data_source === undefined) {
    errors.push(missingField(`${path}.data_source`));
  } else if (isRecord(value.data_source)) {
    const kind: unknown = value.data_source.kind;
    if (kind === 'replay-dataset') {
      const sourceResult = validateReplayDataSource(value.data_source, `${path}.data_source`);
      if (sourceResult.ok) dataSource = sourceResult.value;
      else errors.push(...sourceResult.errors);
    } else if (kind === 'generative-population') {
      const sourceResult = validateRegimePopulationSource(value.data_source, `${path}.data_source`);
      if (sourceResult.ok) dataSource = sourceResult.value;
      else errors.push(...sourceResult.errors);
    } else if (kind === 'live-session') {
      const sourceResult = validateLiveSessionSource(value.data_source, `${path}.data_source`);
      if (sourceResult.ok) dataSource = sourceResult.value;
      else errors.push(...sourceResult.errors);
    } else {
      errors.push(invalidField(`${path}.data_source.kind`, "must be 'replay-dataset', 'generative-population' or 'live-session'"));
    }
  } else {
    errors.push(invalidField(`${path}.data_source`, 'must be an object'));
  }

  if (value.evaluator === undefined) errors.push(missingField(`${path}.evaluator`));
  else if (!isEvaluatorVersionRef(value.evaluator)) errors.push(invalidField(`${path}.evaluator`, 'must be a non-empty versioned evaluator ref (L9)'));

  let stress: readonly StressVariation[] | undefined;
  if (value.stress === undefined) {
    errors.push(missingField(`${path}.stress`));
  } else {
    const stressResult = validateStressVariations(value.stress, `${path}.stress`);
    if (stressResult.ok) stress = stressResult.value;
    else errors.push(...stressResult.errors);
  }

  if (value.score_scale === undefined) {
    errors.push(missingField(`${path}.score_scale`));
  } else if (typeof value.score_scale !== 'number' || !Number.isInteger(value.score_scale) || value.score_scale < 0 || value.score_scale > 18) {
    errors.push(invalidField(`${path}.score_scale`, 'must be an integer in [0, 18] — the exact-decimal scale of every recorded score'));
  }

  let ladderLevel: RegimeLadderLevel | null | undefined;
  if (value.ladder_level === undefined) {
    errors.push(missingField(`${path}.ladder_level`));
  } else if (value.ladder_level !== null && !isRegimeLadderLevel(value.ladder_level)) {
    errors.push(invalidField(`${path}.ladder_level`, `must be one of the regime ladder levels or null`));
  } else {
    ladderLevel = value.ladder_level as RegimeLadderLevel | null;
  }

  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));

  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));

  if (errors.length > 0) return { ok: false, errors };

  const driver = value.driver as BenchmarkDriver;
  const phase = value.phase as BenchmarkPhase;
  const evidenceClass = value.evidence_class as EvidenceClass;
  const source = dataSource as BenchmarkDataSource;

  // Driver/source coherence.
  if (driver === 'walk-forward-replay' && source.kind === 'generative-population') {
    return fail('invalid_definition', `driver 'walk-forward-replay' binds replay datasets or live sessions — a generative population belongs to the 'regime-ladder-generative' driver`, `${path}.driver`);
  }
  if (driver === 'regime-ladder-generative' && source.kind !== 'generative-population') {
    return fail('invalid_definition', `driver 'regime-ladder-generative' binds generative regime populations — a '${source.kind}' source belongs to the 'walk-forward-replay' driver`, `${path}.driver`);
  }
  if (driver === 'regime-ladder-generative' && ladderLevel === null) {
    return fail('invalid_definition', `driver 'regime-ladder-generative' must declare its regime ladder level ('synthetic-single-regime' | 'synthetic-multi-regime' | 'unseen-multi-regime')`, `${path}.ladder_level`);
  }
  if (driver === 'walk-forward-replay' && ladderLevel !== null) {
    return fail('invalid_definition', `driver 'walk-forward-replay' carries no regime ladder level — the ladder belongs to the generative driver`, `${path}.ladder_level`);
  }

  // The evidence class law (definition level).
  const evidenceCheck = checkEvidenceClass(evidenceClass, source.kind, source.origin, `${path}.evidence_class`);
  if (!evidenceCheck.ok) return evidenceCheck;

  // Phase coherence: a holdout benchmark needs reserved unseen material.
  if (phase === 'holdout' && (splitPlan as SplitPlanMirror).holdout === null) {
    return fail('no_holdout_material', `holdout-phase benchmark scores reserved unseen material, but split plan "${(splitPlan as SplitPlanMirror).plan_id}" reserved none — declare the holdout reservation in the driver policy`, `${path}.split_plan`);
  }

  const content: Omit<BenchmarkDefinition, 'benchmark_id'> = {
    name: value.name as string,
    driver,
    phase,
    evidence_class: evidenceClass,
    split_plan: splitPlan as SplitPlanMirror,
    data_source: source,
    evaluator: value.evaluator as EvaluatorVersionRef,
    stress: stress as readonly StressVariation[],
    score_scale: value.score_scale as number,
    ladder_level: ladderLevel as RegimeLadderLevel | null,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  const derivedId = benchmarkId(content);
  if (value.benchmark_id !== undefined && value.benchmark_id !== derivedId) {
    return fail('invalid_field', `benchmark id "${value.benchmark_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.benchmark_id`);
  }
  return ok(deepFreeze({ benchmark_id: derivedId, ...content } satisfies BenchmarkDefinition));
}

export { splitPlanDigest };

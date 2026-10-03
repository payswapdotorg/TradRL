/**
 * @tradrl/research-benchmarks — the WALK-FORWARD BENCHMARK DRIVER (Work
 * Order T032): the executable machinery that turns a split plan into
 * reproducible evaluation evidence.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md (layers 2-4: historical
 * performance, blind generalization, execution stress; "Use unseen
 * periods, regimes, assets, venues or combinations not optimized against";
 * "Retain search histories and distinguish in-search performance from
 * holdout performance"; "Simulation evidence and live evidence are never
 * conflated"), spec/LEARNING-LOOP.md (the regime ladder), ARCHITECTURE-LOCK
 * L4 (the run instant is INJECTED), L7 (constraint-aware evaluation —
 * scores under stress, exact decimals), L9/L15 (full lineage on every
 * result), L11 (the in-search vs holdout separation runs THROUGH the
 * search-record mirror), L12 (tenant scoping).
 *
 * THE RUN LAWS (each typed, fail-closed, each negative-tested):
 * 1. PHASE/MATERIAL LAW — a 'search'-phase run scores WINDOW TEST segments
 *    (in-search material); its scored set may declare a subset (a search
 *    loop scores window by window) but may NEVER intersect the plan's
 *    reserved holdout: `holdout_in_search` (the Work Order's law — "a
 *    benchmark run that scores a holdout window inside a search loop is a
 *    typed error"). A 'holdout'-phase run scores RESERVED material only:
 *    `search_material_in_holdout` for the symmetric incoherence,
 *    `no_holdout_material` when the plan reserved nothing.
 * 2. SEARCH-CONTEXT LAW — a holdout run MUST bind the search record it
 *    judges (`search_context_required`): the record verifies through the
 *    MIRRORED chain (`chain_mismatch`), its tenant/project agree with the
 *    definition's (`tenant_mismatch`, L12), the bound trial exists
 *    (`unknown_trial`) and its classification AGREES with the run's phase
 *    (`classification_conflict` — the record is the authority; this is the
 *    in-search vs holdout separation enforced through the search-record
 *    mirror). A search run MAY bind its record (the same laws apply when
 *    provided).
 * 3. LADDER LAW — generative runs satisfy their regime ladder level's
 *    structural law (`ladder_violation`): single-regime populations
 *    generate exactly one regime; multi-regime populations generate two or
 *    more; unseen-multi-regime populations declare a disjoint unseen set,
 *    and a HOLDOUT run at that level scores material covering >= 2 regimes
 *    including >= 1 unseen one (the LEARNING-LOOP "unseen multi-regime
 *    tests"), while a SEARCH run never scores unseen-regime material.
 * 4. SCORING LAW — every scored segment carries an observation
 *    (`missing_observation`); stress variations apply EXACTLY (stress.ts)
 *    in declaration order; the per-window and aggregate scores are exact
 *    decimals with a SINGLE half-even rendering at the definition's
 *    declared score scale; the cumulative score is the exact sum rendered
 *    once.
 * 5. LINEAGE LAW — the result record binds its full L9/L15 lineage (the
 *    split plan id + digest, the data source id + digest, the evaluator
 *    ref, the judged search record id for holdout runs) plus its scope
 *    (tenant/project, L12) and its INJECTED recording instant (L4), and is
 *    content-addressed (`bres:<digest>`): identical inputs -> identical
 *    bytes (the determinism tests pin it).
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue, TimestampMs } from './primitives';
import { isBenchmarkId, isProjectId, isTenantId, isTrialId } from './ids';
import type { BenchmarkId, DataRef, EvaluatorVersionRef, ProjectId, TenantId, TrialId } from './ids';
import { addDecimals, meanAtScale, roundDecimalToScale } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';
import { validateBenchmarkDefinition, dataSourceDigest } from './definition';
import type { BenchmarkDefinition } from './definition';
import { validateObservationSet } from './observations';
import type { ObservationSet, SegmentObservation } from './observations';
import { applyStressVariations } from './stress';
import type { StressVariation } from './stress';
import { verifySearchRecordLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';
import { splitPlanDigest } from './split-mirror';
import type { SplitPlanMirror } from './split-mirror';
import type { RegimeLadderLevel } from './generative-mirror';

// ---------------------------------------------------------------------------
// The result record
// ---------------------------------------------------------------------------

/** One window's score (search-phase runs): the window ordinal, its test segment and its exact-decimal score. */
export interface WindowScore {
  readonly window: number;
  readonly test: DataRef;
  readonly score: DecimalString;
}

/** The result's L9/L15 lineage block. */
export interface BenchmarkResultLineage {
  /** The split plan the run scored under. */
  readonly split_plan: string;
  /** The content digest of the split plan. */
  readonly plan_digest: string;
  /** The data/regime source the run evaluated over. */
  readonly data_source: string;
  /** The content digest of the data source. */
  readonly source_digest: string;
  /** The versioned evaluator that scored the run (L9). */
  readonly evaluator: EvaluatorVersionRef;
  /** The judged search record (holdout runs only; null otherwise). */
  readonly search_id: string | null;
}

/** A compiled benchmark result record: exact scores + full lineage, content-addressed. */
export interface BenchmarkResultRecord {
  /** Derived identity: `bres:<digest over the canonical result content>`. */
  readonly result_id: string;
  readonly benchmark: BenchmarkId;
  readonly phase: 'search' | 'holdout';
  readonly evidence_class: 'simulation' | 'live';
  /** The scored segments, in scoring order. */
  readonly scored: readonly DataRef[];
  /** Per-window scores (search-phase runs; empty for holdout runs). */
  readonly window_scores: readonly WindowScore[];
  /** The aggregate score: the exact mean of the scored segments' adjusted PnL at the declared scale. */
  readonly aggregate_score: DecimalString;
  /** The cumulative score: the exact sum of the scored segments' adjusted PnL at the declared scale. */
  readonly cumulative_score: DecimalString;
  /** The stress variations applied (echo of the definition's; declaration order). */
  readonly stress_applied: readonly StressVariation[];
  readonly lineage: BenchmarkResultLineage;
  /** The INJECTED recording instant (L4). */
  readonly recorded_at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The canonical result JSON (the content-addressing input; no `result_id`). */
export function resultContentJson(record: Omit<BenchmarkResultRecord, 'result_id'>): JsonObject {
  return {
    benchmark: record.benchmark,
    phase: record.phase,
    evidence_class: record.evidence_class,
    scored: record.scored as unknown as readonly JsonValue[],
    window_scores: record.window_scores as unknown as readonly JsonValue[],
    aggregate_score: record.aggregate_score,
    cumulative_score: record.cumulative_score,
    stress_applied: record.stress_applied as unknown as readonly JsonValue[],
    lineage: record.lineage as unknown as JsonObject,
    recorded_at: record.recorded_at,
    tenant: record.tenant,
    project: record.project,
  };
}

/** Compute the content address of a benchmark result: `bres:<digest>`. */
export function benchmarkResultId(content: Omit<BenchmarkResultRecord, 'result_id'>): string {
  return `bres:${stableDigestJson(resultContentJson(content))}`;
}

/** The canonical JSON bytes of a result record (the determinism anchor). */
export function canonicalBenchmarkResult(record: BenchmarkResultRecord): string {
  return canonicalJson(record as unknown as JsonObject);
}

// ---------------------------------------------------------------------------
// The run input
// ---------------------------------------------------------------------------

/** The search-context binding: the verified search record plus the trial this run belongs to. */
export interface SearchContextBinding {
  readonly record: SearchRecordMirror;
  readonly trial: TrialId;
}

/** The run input: the definition, the observations, the optional search context and the injected instant. */
export interface BenchmarkRunInput {
  readonly definition: BenchmarkDefinition;
  readonly observations: ObservationSet;
  readonly search: SearchContextBinding | null;
  readonly recorded_at: TimestampMs;
}

// ---------------------------------------------------------------------------
// The driver (pure, total, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Run one benchmark: score the phase's material over the declared
 * observations under the declared stress, and compile the content-addressed
 * result record with full lineage. Deterministic and pure: the same
 * (definition, observations, search context, instant) always yields the
 * byte-identical record (L9 + the Work Order's determinism law).
 *
 * The run input's `scored` may be declared as a subset of the phase's
 * material (a search loop scores window by window); when absent, the run
 * scores the phase's full material.
 */
export function runBenchmark(input: unknown): BenchmarkResult<BenchmarkResultRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('run input must be an object')] };
  }
  if (input.definition === undefined) {
    return { ok: false, errors: [missingField('definition')] };
  }
  const definitionResult = validateBenchmarkDefinition(input.definition);
  if (!definitionResult.ok) return definitionResult;
  const definition = definitionResult.value;

  if (input.observations === undefined) {
    return { ok: false, errors: [missingField('observations')] };
  }
  const observationResult = validateObservationSet(input.observations, definition.split_plan);
  if (!observationResult.ok) return observationResult;
  const observations = observationResult.value;
  const observationBy = new Map<string, SegmentObservation>(observations.observations.map((observation) => [observation.segment, observation]));

  if (input.recorded_at === undefined) {
    return { ok: false, errors: [missingField('recorded_at')] };
  }
  if (!isTimestampMs(input.recorded_at)) {
    return { ok: false, errors: [invalidField('recorded_at', 'must be a valid TimestampMs (the injected run instant, L4)')] };
  }
  const recordedAt = input.recorded_at as TimestampMs;

  // --- The search-context law -------------------------------------------------
  let search: SearchContextBinding | null = null;
  if (input.search !== undefined && input.search !== null) {
    if (!isRecord(input.search)) {
      return { ok: false, errors: [invalidField('search', 'must be { search_record, trial } or null')] };
    }
    const verified = verifySearchRecordLineage(input.search.search_record ?? input.search.record);
    if (!verified.ok) return verified;
    const record = verified.value;
    if (input.search.trial === undefined) {
      return { ok: false, errors: [missingField('search.trial')] };
    }
    if (!isTrialId(input.search.trial)) {
      return { ok: false, errors: [invalidField('search.trial', 'must be a non-empty trial id')] };
    }
    const trial = input.search.trial as TrialId;
    if (record.tenant !== definition.tenant || record.project !== definition.project) {
      return fail(
        'tenant_mismatch',
        `search record "${record.search_id}" is scoped to tenant "${record.tenant}"/project "${record.project}" but the benchmark is scoped to "${definition.tenant}"/"${definition.project}" — a benchmark never crosses tenants or projects (L12)`,
        'search',
      );
    }
    const entry = record.entries.find((candidate) => candidate.trial === trial);
    if (entry === undefined) {
      return fail('unknown_trial', `search record "${record.search_id}" does not log trial "${trial}" — the run cannot bind a trial the search never recorded`, 'search.trial');
    }
    if (entry.classification !== definition.phase) {
      return fail(
        'classification_conflict',
        `benchmark phase "${definition.phase}" disagrees with the search record's classification of trial "${trial}" as "${entry.classification}" — the record is the authority on the in-search/holdout distinction (L11)`,
        'definition.phase',
      );
    }
    search = deepFreeze({ record, trial }) satisfies SearchContextBinding;
  }
  if (definition.phase === 'holdout' && search === null) {
    return fail(
      'search_context_required',
      `holdout-phase benchmark "${definition.benchmark_id}" carries no search context — holdout evidence always judges a search (L10/L11); bind the search record and trial it evaluates`,
      'search',
    );
  }

  // --- The phase/material law ---------------------------------------------------
  const plan = definition.split_plan;
  const holdoutRefs = new Set<string>((plan.holdout?.segments ?? []).map((segment) => segment.ref));
  const windowTestRefs = plan.windows.map((window) => window.test.ref);

  let scored: readonly DataRef[];
  if (input.scored !== undefined && input.scored !== null) {
    if (!Array.isArray(input.scored)) {
      return { ok: false, errors: [invalidField('scored', 'must be an array of dataset refs (the declared scored subset)')] };
    }
    const declared: DataRef[] = [];
    for (const ref of input.scored as readonly unknown[]) {
      if (typeof ref !== 'string' || ref.length === 0) {
        return { ok: false, errors: [invalidField('scored', 'every entry must be a non-empty dataset ref')] };
      }
      if (declared.includes(ref as DataRef)) {
        return { ok: false, errors: [invalidField('scored', `segment "${ref}" is scored twice`)] };
      }
      declared.push(ref as DataRef);
    }
    scored = declared;
  } else {
    scored =
      definition.phase === 'search'
        ? windowTestRefs
        : (plan.holdout?.segments ?? []).map((segment) => segment.ref);
  }

  if (definition.phase === 'search') {
    for (const ref of scored) {
      if (holdoutRefs.has(ref)) {
        return fail(
          'holdout_in_search',
          `search-phase benchmark "${definition.benchmark_id}" scores reserved unseen segment "${ref}" — a benchmark run that scores a holdout window inside a search loop is a typed error (the plan's holdout is never in-search material; R20/R21)`,
          'scored',
        );
      }
      if (!windowTestRefs.includes(ref)) {
        return { ok: false, errors: [invalidField('scored', `segment "${ref}" is not a window test segment of plan "${plan.plan_id}" — a search run scores window test material only`)] };
      }
    }
  } else {
    for (const ref of scored) {
      if (!holdoutRefs.has(ref)) {
        return fail(
          'search_material_in_holdout',
          `holdout-phase benchmark "${definition.benchmark_id}" scores segment "${ref}" which is not reserved unseen material — a holdout run judges the unseen reservoir only`,
          'scored',
        );
      }
    }
    if (scored.length === 0) {
      return { ok: false, errors: [invalidField('scored', 'the holdout run scores nothing')] };
    }
  }

  // --- The ladder law (generative driver) ----------------------------------------
  if (definition.driver === 'regime-ladder-generative' && definition.ladder_level !== null) {
    const ladderCheck = checkRegimeLadder(definition, plan, scored);
    if (!ladderCheck.ok) return ladderCheck;
  }

  // --- The scoring law ------------------------------------------------------------
  const adjustedBy = new Map<string, DecimalString>();
  for (const ref of scored) {
    const observation = observationBy.get(ref);
    if (observation === undefined) {
      return fail('missing_observation', `scored segment "${ref}" carries no observation — the driver never invents a number`, 'observations');
    }
    adjustedBy.set(ref, applyStressVariations(
      { pnl: observation.pnl, notional: observation.notional, trades: observation.trades, fill_value: observation.fill_value },
      definition.stress,
    ));
  }

  const windowScores: WindowScore[] = [];
  if (definition.phase === 'search') {
    for (const window of plan.windows) {
      if (!scored.includes(window.test.ref)) continue;
      const adjusted = adjustedBy.get(window.test.ref);
      if (adjusted === undefined) continue; // unreachable: scored ⊆ checked above
      windowScores.push({ window: window.index, test: window.test.ref, score: adjusted });
    }
  }

  const adjustedValues = scored.map((ref) => adjustedBy.get(ref) as DecimalString);
  let cumulativeExact = '0';
  for (const value of adjustedValues) {
    cumulativeExact = addDecimals(cumulativeExact, value);
  }
  const aggregateScore = meanAtScale(adjustedValues, definition.score_scale);
  const cumulativeScore = roundDecimalToScale(cumulativeExact, definition.score_scale, 'half-even');

  // --- The lineage law ---------------------------------------------------------------
  const content: Omit<BenchmarkResultRecord, 'result_id'> = {
    benchmark: definition.benchmark_id,
    phase: definition.phase,
    evidence_class: definition.evidence_class,
    scored,
    window_scores: windowScores,
    aggregate_score: aggregateScore,
    cumulative_score: cumulativeScore,
    stress_applied: definition.stress,
    lineage: {
      split_plan: plan.plan_id,
      plan_digest: splitPlanDigest(plan),
      data_source: definition.data_source.source_id,
      source_digest: dataSourceDigest(definition.data_source),
      evaluator: definition.evaluator,
      search_id: search === null ? null : search.record.search_id,
    },
    recorded_at: recordedAt,
    tenant: definition.tenant,
    project: definition.project,
  };
  return ok(deepFreeze({ result_id: benchmarkResultId(content), ...content } satisfies BenchmarkResultRecord));
}

// ---------------------------------------------------------------------------
// The ladder law
// ---------------------------------------------------------------------------

/**
 * The LEARNING-LOOP regime ladder law for generative benchmarks: a level's
 * structural law is data, not decoration (`ladder_violation` on breach).
 */
function checkRegimeLadder(definition: BenchmarkDefinition, plan: SplitPlanMirror, scored: readonly DataRef[]): BenchmarkResult<true> {
  const level: RegimeLadderLevel = definition.ladder_level as RegimeLadderLevel;
  const source = definition.data_source;
  if (source.kind !== 'generative-population') {
    return fail('invalid_definition', 'the ladder law requires a generative population source', 'data_source');
  }
  const regimes = source.regimes;
  const unseenRegimes = source.unseen_regimes;

  // The scored material's regime labels (from the plan's segments).
  const regimeOf = new Map<string, string>();
  for (const window of plan.windows) {
    for (const segment of window.train) regimeOf.set(segment.ref, segment.regime);
    regimeOf.set(window.test.ref, window.test.regime);
  }
  for (const segment of plan.holdout?.segments ?? []) regimeOf.set(segment.ref, segment.regime);
  const scoredRegimes = scored.map((ref) => regimeOf.get(ref)).filter((label): label is string => label !== undefined);
  const scoredDistinct = new Set(scoredRegimes);

  const vocabulary = new Set<string>([...regimes, ...unseenRegimes]);
  for (const label of scoredRegimes) {
    if (!vocabulary.has(label)) {
      return fail(
        'ladder_violation',
        `scored material carries regime "${label}" which the population does not generate (regimes: [${regimes.join(', ')}], unseen: [${unseenRegimes.join(', ')}]) — the scored axis and the population must agree`,
        'scored',
      );
    }
  }

  if (level === 'synthetic-single-regime') {
    if (regimes.length !== 1 || unseenRegimes.length > 0) {
      return fail(
        'ladder_violation',
        `ladder level 'synthetic-single-regime' demands a single-regime population with nothing unseen — the source generates [${regimes.join(', ')}] with unseen [${unseenRegimes.join(', ')}]`,
        'ladder_level',
      );
    }
    const foreign = [...scoredDistinct].filter((label) => !regimes.includes(label));
    if (foreign.length > 0) {
      return fail('ladder_violation', `single-regime level scored material outside the generated regime: [${foreign.join(', ')}]`, 'scored');
    }
    return ok(true);
  }

  if (level === 'synthetic-multi-regime') {
    if (regimes.length < 2 || unseenRegimes.length > 0) {
      return fail(
        'ladder_violation',
        `ladder level 'synthetic-multi-regime' demands a multi-regime population with nothing unseen — the source generates [${regimes.join(', ')}] with unseen [${unseenRegimes.join(', ')}]`,
        'ladder_level',
      );
    }
    const foreign = [...scoredDistinct].filter((label) => !regimes.includes(label));
    if (foreign.length > 0) {
      return fail('ladder_violation', `multi-regime level scored material outside the generated regimes: [${foreign.join(', ')}]`, 'scored');
    }
    return ok(true);
  }

  // level === 'unseen-multi-regime' — curriculum step 6: "Unseen multi-regime tests".
  if (regimes.length < 2) {
    return fail(
      'ladder_violation',
      `ladder level 'unseen-multi-regime' demands a multi-regime population — the source generates [${regimes.join(', ')}]`,
      'ladder_level',
    );
  }
  if (unseenRegimes.length < 1) {
    return fail(
      'ladder_violation',
      `ladder level 'unseen-multi-regime' demands a declared disjoint unseen regime set — combinations the search never optimized against`,
      'ladder_level',
    );
  }
  if (definition.phase === 'search') {
    // A search run never scores unseen-regime material (never optimize on the unseen).
    const unseenScored = [...scoredDistinct].filter((label) => unseenRegimes.includes(label));
    if (unseenScored.length > 0) {
      return fail(
        'ladder_violation',
        `search-phase run scores unseen-regime material [${unseenScored.join(', ')}] — the search never optimizes on the unseen regimes (spec/EVALUATION-PROTOCOL.md: material not optimized against)`,
        'scored',
      );
    }
    return ok(true);
  }
  // Holdout run at the unseen-multi-regime level: the unseen multi-regime TEST.
  const unseenCovered = [...scoredDistinct].filter((label) => unseenRegimes.includes(label));
  if (scoredDistinct.size < 2) {
    return fail(
      'ladder_violation',
      `unseen-multi-regime holdout test scored ${scoredDistinct.size} distinct regime(s) — the level demands multi-regime combinations (>= 2 distinct, including >= 1 unseen)`,
      'scored',
    );
  }
  if (unseenCovered.length < 1) {
    return fail(
      'ladder_violation',
      `unseen-multi-regime holdout test scored no UNSEEN regime (scored: [${[...scoredDistinct].join(', ')}], unseen: [${unseenRegimes.join(', ')}]) — the level demands combinations the search never optimized against`,
      'scored',
    );
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// Untrusted result verification (the standalone record laws)
// ---------------------------------------------------------------------------

/**
 * Collect-all verification of an untrusted benchmark result record: the
 * structural laws (ids, phases, classes, scored uniqueness, window-score
 coherence, exact decimals), and the CONTENT-ADDRESS law (the recorded
 `result_id` must equal the digest of the canonical result content —
 `result_mismatch`). On success the record is returned narrowed, deeply
 frozen.
 */
export function verifyBenchmarkResult(value: unknown, path = 'result'): BenchmarkResult<BenchmarkResultRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];
  if (value.result_id === undefined) errors.push(missingField(`${path}.result_id`));
  else if (typeof value.result_id !== 'string' || !value.result_id.startsWith('bres:')) {
    errors.push(invalidField(`${path}.result_id`, 'must be a result id ("bres:<digest>")'));
  }
  if (value.benchmark === undefined) errors.push(missingField(`${path}.benchmark`));
  else if (!isBenchmarkId(value.benchmark)) errors.push(invalidField(`${path}.benchmark`, 'must be a benchmark id ("bmk:<digest>")'));
  if (value.phase === undefined) errors.push(missingField(`${path}.phase`));
  else if (value.phase !== 'search' && value.phase !== 'holdout') errors.push(invalidField(`${path}.phase`, "must be 'search' or 'holdout'"));
  if (value.evidence_class === undefined) errors.push(missingField(`${path}.evidence_class`));
  else if (value.evidence_class !== 'simulation' && value.evidence_class !== 'live') {
    errors.push(invalidField(`${path}.evidence_class`, "must be 'simulation' or 'live'"));
  }
  if (value.scored === undefined) errors.push(missingField(`${path}.scored`));
  else if (!Array.isArray(value.scored) || value.scored.length === 0) {
    errors.push(invalidField(`${path}.scored`, 'must be a non-empty array of scored dataset refs'));
  } else {
    const seen = new Set<string>();
    for (const ref of value.scored as readonly unknown[]) {
      if (typeof ref !== 'string' || ref.length === 0) {
        errors.push(invalidField(`${path}.scored`, 'every entry must be a non-empty dataset ref'));
        break;
      }
      if (seen.has(ref)) {
        errors.push(invalidField(`${path}.scored`, `segment "${ref}" is scored twice`));
        break;
      }
      seen.add(ref);
    }
  }
  if (value.window_scores === undefined) errors.push(missingField(`${path}.window_scores`));
  else if (!Array.isArray(value.window_scores)) {
    errors.push(invalidField(`${path}.window_scores`, 'must be an array of window scores'));
  } else {
    const scoredSet = new Set((Array.isArray(value.scored) ? (value.scored as readonly string[]) : []));
    const windowIndexes = new Set<number>();
    for (let index = 0; index < (value.window_scores as unknown[]).length; index++) {
      const candidate = (value.window_scores as unknown[])[index];
      if (!isRecord(candidate)) {
        errors.push(invalidField(`${path}.window_scores[${index}]`, 'must be { window, test, score }'));
        continue;
      }
      if (typeof candidate.window !== 'number' || !Number.isInteger(candidate.window) || candidate.window < 0) {
        errors.push(invalidField(`${path}.window_scores[${index}].window`, 'must be a non-negative integer window ordinal'));
      } else if (windowIndexes.has(candidate.window)) {
        errors.push(invalidField(`${path}.window_scores[${index}].window`, `window ${candidate.window} is scored twice`));
      } else {
        windowIndexes.add(candidate.window);
      }
      if (typeof candidate.test !== 'string' || !scoredSet.has(candidate.test)) {
        errors.push(invalidField(`${path}.window_scores[${index}].test`, 'must be one of the scored refs'));
      }
      if (typeof candidate.score !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(candidate.score)) {
        errors.push(invalidField(`${path}.window_scores[${index}].score`, 'must be a well-formed exact decimal'));
      }
    }
    if ((value.phase as unknown) === 'holdout' && (value.window_scores as unknown[]).length > 0) {
      errors.push(invalidField(`${path}.window_scores`, 'a holdout run carries no window scores — it scores the unseen reservoir, not the window ladder'));
    }
  }
  if (value.aggregate_score === undefined) errors.push(missingField(`${path}.aggregate_score`));
  else if (typeof value.aggregate_score !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.aggregate_score)) {
    errors.push(invalidField(`${path}.aggregate_score`, 'must be a well-formed exact decimal'));
  }
  if (value.cumulative_score === undefined) errors.push(missingField(`${path}.cumulative_score`));
  else if (typeof value.cumulative_score !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.cumulative_score)) {
    errors.push(invalidField(`${path}.cumulative_score`, 'must be a well-formed exact decimal'));
  }
  if (value.stress_applied === undefined) errors.push(missingField(`${path}.stress_applied`));
  else if (!Array.isArray(value.stress_applied)) {
    errors.push(invalidField(`${path}.stress_applied`, 'must be an array of stress variations'));
  }
  if (value.lineage === undefined) errors.push(missingField(`${path}.lineage`));
  else if (!isRecord(value.lineage)) {
    errors.push(invalidField(`${path}.lineage`, 'must be a lineage block'));
  } else {
    const lineage = value.lineage;
    if (typeof lineage.split_plan !== 'string' || !lineage.split_plan.startsWith('splan:')) {
      errors.push(invalidField(`${path}.lineage.split_plan`, 'must be a split plan id ("splan:<digest>")'));
    }
    if (typeof lineage.plan_digest !== 'string' || !/^[0-9a-f]{16}$/.test(lineage.plan_digest)) {
      errors.push(invalidField(`${path}.lineage.plan_digest`, 'must be a 16-hex digest'));
    }
    if (typeof lineage.data_source !== 'string' || lineage.data_source.length === 0 || !lineage.data_source.includes(':')) {
      errors.push(invalidField(`${path}.lineage.data_source`, 'must be a content-addressed source id'));
    }
    if (typeof lineage.source_digest !== 'string' || !/^[0-9a-f]{16}$/.test(lineage.source_digest)) {
      errors.push(invalidField(`${path}.lineage.source_digest`, 'must be a 16-hex digest'));
    }
    if (typeof lineage.evaluator !== 'string' || lineage.evaluator.length === 0) {
      errors.push(invalidField(`${path}.lineage.evaluator`, 'must be a versioned evaluator ref (L9)'));
    }
    if (lineage.search_id !== null && (typeof lineage.search_id !== 'string' || !lineage.search_id.startsWith('srch:'))) {
      errors.push(invalidField(`${path}.lineage.search_id`, 'must be a search record id ("srch:<digest>") or null'));
    }
    if ((value.phase as unknown) === 'holdout' && (lineage.search_id === null || lineage.search_id === undefined)) {
      errors.push(invalidField(`${path}.lineage.search_id`, 'a holdout result binds the search record it judged — never null (L10/L11)'));
    }
  }
  if (value.recorded_at === undefined) errors.push(missingField(`${path}.recorded_at`));
  else if (!isTimestampMs(value.recorded_at)) errors.push(invalidField(`${path}.recorded_at`, 'must be a valid TimestampMs (L4)'));
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<BenchmarkResultRecord, 'result_id'> = {
    benchmark: value.benchmark as BenchmarkId,
    phase: value.phase as 'search' | 'holdout',
    evidence_class: value.evidence_class as 'simulation' | 'live',
    scored: value.scored as readonly DataRef[],
    window_scores: value.window_scores as readonly WindowScore[],
    aggregate_score: value.aggregate_score as string,
    cumulative_score: value.cumulative_score as string,
    stress_applied: value.stress_applied as readonly StressVariation[],
    lineage: value.lineage as unknown as BenchmarkResultLineage,
    recorded_at: value.recorded_at as TimestampMs,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  const derivedId = benchmarkResultId(content);
  if (value.result_id !== derivedId) {
    return fail(
      'result_mismatch',
      `result id "${value.result_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.result_id`,
    );
  }
  return ok(deepFreeze({ result_id: derivedId, ...content } satisfies BenchmarkResultRecord));
}

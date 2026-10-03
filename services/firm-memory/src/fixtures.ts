/**
 * @tradrl/firm-memory-service — the deterministic scenario fixtures
 * (test-support only): HAND-MINTED, mirror-valid T033-shaped outcome
 * records + post-mortem drafts (this module SIMULATES the producing
 * lane's minting law — the same content trees and the same
 * content-addressed ids — exactly as T033's own fixtures simulate
 * T030's records; the service itself NEVER imports
 * services/outcome-learning, and interop.test.ts drives the REAL T033
 * pipeline through the same mirrors).
 *
 * THE SCENARIOS (all one tenant/project unless stated; all
 * deterministic literals):
 *   - `scenarioSnapshotAdverse`      — three outcomes (adverse_gap /
 *     execution_shortfall / no_execution) whose post-mortems carry
 *     decision + market_move(adverse) + one model_error + one data_lag
 *     hypotheses: promotes decision_pattern/harmful/unresolved AND
 *     market_behavior/adverse (e=3); the model-error and data-lag
 *     candidates stay below the bar (e=1);
 *   - `scenarioSnapshotReinforce`    — two more adverse outcomes: the
 *     market/decision candidates REVISION their families (the dedupe
 *     fold: e=5) and the model_error over-projection candidate births
 *     (e=2);
 *   - `scenarioSnapshotChallenger`   — two favorable outcomes with
 *     market_move(favorable) hypotheses: a NON-dominating challenger
 *     (e=2 < the incumbent's 5) — the contest is recorded, the
 *     incumbent stands;
 *   - `scenarioSnapshotDominating`   — six favorable outcomes: the
 *     challenger DOMINATES (e=6 > 5) — the contest is recorded AND the
 *     family flips (the supersession append);
 *   - `scenarioSnapshotTenantB`      — tenant B's own scope (two
 *     adverse outcomes) — the isolation tests' second world;
 *   - `scenarioSnapshotInternalContest` — four outcomes, two per
 *     polarity of the decision_pattern/timing family (no existing
 *     entries): EQUAL counts — a contest is recorded and NEITHER
 *     polarity promotes;
 *   - `scenarioSnapshotInternalDomination` — five outcomes, 2 harmful
 *     vs 3 helpful on the same fresh family: the helpful side dominates
 *     (e=3 > 2) — a contest is recorded AND the helpful side promotes;
 *   - `scenarioSnapshotMinimal`      — two outcomes with market_move
 *     (adverse) hypotheses (the fresh-birth minimal case; pairs with
 *     the SHORT policy for the decay tests).
 */

import { asTimestampMs, canonicalJson, deepFreeze, fnv1a32Hex, type TimestampMs } from './imports';
import type {
  AttributionHypothesisMirror,
  EvidenceRefMirror,
  OutcomeRecordMirror,
  PostMortemRecordMirror,
} from './imports';
import type { PromotionPolicy, ServingPolicy } from './imports';

export const FIRM_T0 = 1_700_100_000_000;
export const FIRM_TENANT = 'tenant-brain-alpha';
export const FIRM_PROJECT = 'project-brain-alpha';
export const FIRM_TENANT_B = 'tenant-brain-beta';
export const FIRM_PROJECT_B = 'project-brain-beta';
export const FIRM_SESSION = 'shs:feedfeed';
export const FIRM_SESSION_B = 'shs:feedbeef';
export const FIRM_SEED = 't034-fixture-seed';

/** The default scenario promotion policy (the declared default: recurrence across >= 2 outcomes at >= 2 instants, weakest confidence >= 0.3, a 30-day decay horizon). */
export const firmScenarioPolicy: PromotionPolicy = deepFreeze({
  minEvidenceCount: 2,
  minAggregateConfidence: '0.3',
  windowStabilityCount: 2,
  validityWindowMs: 2_592_000_000,
});

/** The short-lived variant (the decay tests: a one-second validity window). */
export const firmScenarioShortPolicy: PromotionPolicy = deepFreeze({
  minEvidenceCount: 2,
  minAggregateConfidence: '0.3',
  windowStabilityCount: 2,
  validityWindowMs: 1_000,
});

/** The scenario serving policy (the whole append-only history). */
export const firmScenarioServingPolicy: ServingPolicy = deepFreeze({
  historyWindowMs: Number.MAX_SAFE_INTEGER,
});

// ---------------------------------------------------------------------------
// The T033-side minting simulation (content-addressed ids — T033's law, mirrored)
// ---------------------------------------------------------------------------

/** The T033 outcome content tree, mirrored field for field (the id's derivation basis). */
function outcomeContentTree(record: Omit<OutcomeRecordMirror, 'outcomeId'>): unknown {
  return {
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    decision: record.decision,
    outcomeClass: record.outcomeClass,
    expectation: record.expectation,
    realization: record.realization,
    deviation: record.deviation,
    evidence: record.evidence,
    lineage: record.lineage,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

/** The T033 post-mortem content tree, mirrored field for field (the id's derivation basis). */
function postMortemContentTree(record: Omit<PostMortemRecordMirror, 'postMortemId'>): unknown {
  return {
    ordinal: record.ordinal,
    subject: record.subject,
    expected: record.expected,
    happened: record.happened,
    gap: record.gap,
    hypotheses: record.hypotheses,
    evidence: record.evidence,
    lineage: record.lineage,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

// ---------------------------------------------------------------------------
// The hypothesis fixtures (the typed payloads, confidences from the T033 default draft policy)
// ---------------------------------------------------------------------------

/** A market_move hypothesis (two canonical marks + the position-relative direction). */
function marketMove(confidence: string, direction: 'adverse' | 'favorable'): AttributionHypothesisMirror {
  return deepFreeze({
    class: 'market_move',
    confidence,
    detail: deepFreeze({ markAtDecision: '50100', markAtWindow: direction === 'adverse' ? '49900' : '50300', direction }),
    evidence: [],
    note: null,
  });
}

/** A decision hypothesis (the implicated dimension — `unresolved` for drafts, `timing` for refinements). */
function decision(confidence: string, dimension: 'unresolved' | 'timing'): AttributionHypothesisMirror {
  return deepFreeze({
    class: 'decision',
    confidence,
    detail: deepFreeze({ dimension }),
    evidence: [],
    note: null,
  });
}

/** A model_error hypothesis (the projected/realized pair; the bias derives exactly). */
function modelError(confidence: string, projected: string, realized: string): AttributionHypothesisMirror {
  return deepFreeze({
    class: 'model_error',
    confidence,
    detail: deepFreeze({ projected, realized, kind: 'unresolved' }),
    evidence: [],
    note: null,
  });
}

/** A data_lag hypothesis (the exact L4 facts: the 150ms lag). */
function dataLag(confidence: string, decisionAt: number, availableAt: number): AttributionHypothesisMirror {
  return deepFreeze({
    class: 'data_lag',
    confidence,
    detail: deepFreeze({ decisionAt: asTimestampMs(decisionAt), availableAt: asTimestampMs(availableAt), lagMs: availableAt - decisionAt }),
    evidence: [],
    note: null,
  });
}

/** The canonical T033 hypothesis ordering (confidence descending, class ascending) — the fixtures emit sorted lists. */
function orderHypotheses(hypotheses: readonly AttributionHypothesisMirror[]): readonly AttributionHypothesisMirror[] {
  return [...hypotheses].sort((a, b) => {
    const scale = Math.max(a.confidence.split('.')[1]?.length ?? 0, b.confidence.split('.')[1]?.length ?? 0);
    const unitsOf = (c: string): bigint => {
      const [intPart, fracPart = ''] = c.split('.');
      return BigInt(intPart + fracPart.padEnd(scale, '0'));
    };
    const byConfidence = unitsOf(b.confidence) - unitsOf(a.confidence);
    if (byConfidence !== 0n) return byConfidence < 0n ? -1 : 1;
    return a.class < b.class ? -1 : a.class > b.class ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// The record builders
// ---------------------------------------------------------------------------

/** One outcome's raw material (the scenario's deterministic literals). */
interface OutcomeSpec {
  readonly ordinal: number;
  readonly suffix: string;
  readonly disposition: 'filled' | 'refused' | 'partial' | 'expired';
  readonly outcomeClass: 'adverse_gap' | 'favorable_gap' | 'execution_shortfall' | 'no_execution' | 'as_expected' | 'averted' | 'unbenchmarked_fill';
  readonly expectedRealized: string | null;
  readonly realizedOutcome: string;
  readonly filledQuantity: string | null;
  readonly tolerance: string;
  readonly asOf: number;
  readonly tenant?: string;
  readonly project?: string;
  readonly session?: string;
  readonly trajectory?: string | null;
  readonly experiment?: { experimentRef: string; trialRef: string } | null;
}

/** Mint one T033-shaped outcome record (content-addressed `out:` id, T030-shaped shadow lineage). */
function mintOutcome(spec: OutcomeSpec): OutcomeRecordMirror {
  const tenant = spec.tenant ?? FIRM_TENANT;
  const project = spec.project ?? FIRM_PROJECT;
  const session = spec.session ?? FIRM_SESSION;
  const trajectory = spec.trajectory === undefined ? 'trajectory-brain-1' : spec.trajectory;
  const experiment = spec.experiment === undefined ? { experimentRef: 'experiment-brain-1', trialRef: 'trial-brain-1' } : spec.experiment;
  const record: Omit<OutcomeRecordMirror, 'outcomeId'> = {
    ordinal: spec.ordinal,
    tenant,
    project,
    decision: deepFreeze({ decisionRef: `xd:brain-${spec.suffix}`, intentRef: `si:brain-${spec.suffix}`, disposition: spec.disposition }),
    outcomeClass: spec.outcomeClass,
    expectation: deepFreeze({
      expectedQuantity: spec.disposition === 'refused' ? '0' : '0.75',
      expectedRealized: spec.expectedRealized,
      tolerance: spec.tolerance,
      declaredBy: spec.expectedRealized === null ? null : 'body:brain-projectionist',
    }),
    realization: deepFreeze({
      filledQuantity: spec.filledQuantity,
      realizedOutcome: spec.realizedOutcome,
      feeTotal: '1.25',
      notionalTotal: '37575',
      unrealizedAtDecision: '12.5',
    }),
    deviation: deepFreeze({
      quantityShortfall: spec.filledQuantity === null ? null : '0',
      realizedGap: spec.expectedRealized === null ? null : signedGap(spec.realizedOutcome, spec.expectedRealized),
      withinTolerance: spec.expectedRealized === null ? null : withinBand(spec.realizedOutcome, spec.expectedRealized, spec.tolerance),
    }),
    evidence: deepFreeze([{ kind: 'shadow_outcome', ref: `swo:${spec.suffix}` } as EvidenceRefMirror]),
    lineage: deepFreeze({
      shadow: deepFreeze({
        sessionId: session,
        fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'ep-brain', version: 3 },
        riskPolicy: { policyId: 'rp-brain', version: 2 },
        configDigests: { worldConfigHash: 'wch-brain', engineConfigHash: 'ech-brain', dataset: 'dataset-brain' },
        run: { runId: 'run-brain', episodeId: 'epi-brain' },
        cursor: { cursorId: 'cur-brain', position: spec.ordinal * 3 },
        seed: FIRM_SEED,
        tenant,
        project,
      }),
      shadowOutcomeRef: `swo:${spec.suffix}`,
      shadowOutcomeOrdinal: spec.ordinal,
      shadowAsOf: asTimestampMs(spec.asOf),
      decisionStreamPosition: spec.ordinal,
      trajectoryRef: trajectory,
      experiment,
    }),
    asOf: asTimestampMs(spec.asOf),
    priorChainHead: '00000000',
  };
  return deepFreeze({ ...record, outcomeId: `out:${fnv1a32Hex(canonicalJson(outcomeContentTree(record)))}` } as OutcomeRecordMirror);
}

/** The signed realized gap (expected -> realized), exact. */
function signedGap(realized: string, expected: string): string {
  const parse = (v: string): { negative: boolean; units: bigint; scale: number } => {
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(v);
    if (match === null) throw new Error(`non-canonical fixture decimal ${v}`);
    const negative = match[1] === '-';
    const frac = match[3] ?? '';
    const units = BigInt(match[2] + frac);
    return units === 0n ? { negative: false, units: 0n, scale: frac.length } : { negative, units, scale: frac.length };
  };
  const a = parse(realized);
  const b = parse(expected);
  const scale = Math.max(a.scale, b.scale);
  const rescale = (p: { units: bigint; scale: number }): bigint => p.units * 10n ** BigInt(scale - p.scale);
  const difference = (a.negative ? -rescale(a) : rescale(a)) - (b.negative ? -rescale(b) : rescale(b));
  if (difference === 0n) return '0';
  const negative = difference < 0n;
  const units = negative ? -difference : difference;
  let digits = units.toString();
  let fraction = '';
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
    digits = digits.slice(0, digits.length - scale);
  }
  return `${negative ? '-' : ''}${digits}${fraction === '' ? '' : `.${fraction}`}`;
}

/** |gap| <= tolerance (the within-band verdict), exact. */
function withinBand(realized: string, expected: string, tolerance: string): boolean {
  const gap = signedGap(realized, expected);
  const abs = gap.startsWith('-') ? gap.slice(1) : gap;
  return compareUnsigned(abs, tolerance) <= 0;
}

/** Exact unsigned comparison (fixture-local). */
function compareUnsigned(a: string, b: string): number {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const unitsOf = (v: string): bigint => {
    const [intPart, fracPart = ''] = v.split('.');
    return BigInt(intPart + fracPart.padEnd(scale, '0'));
  };
  const left = unitsOf(a);
  const right = unitsOf(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** One post-mortem's raw material. */
interface PostMortemSpec {
  readonly ordinal: number;
  readonly subject: OutcomeRecordMirror;
  readonly hypotheses: readonly AttributionHypothesisMirror[];
  readonly asOf: number;
  readonly tenant?: string;
  readonly project?: string;
  readonly session?: string;
  readonly trajectory?: string | null;
  readonly experiment?: { experimentRef: string; trialRef: string } | null;
}

/** Mint one T033-shaped post-mortem draft (content-addressed `pmr:` id). */
function mintPostMortem(spec: PostMortemSpec): PostMortemRecordMirror {
  const tenant = spec.tenant ?? FIRM_TENANT;
  const project = spec.project ?? FIRM_PROJECT;
  const session = spec.session ?? FIRM_SESSION;
  const trajectory = spec.trajectory === undefined ? 'trajectory-brain-1' : spec.trajectory;
  const experiment = spec.experiment === undefined ? { experimentRef: 'experiment-brain-1', trialRef: 'trial-brain-1' } : spec.experiment;
  const record: Omit<PostMortemRecordMirror, 'postMortemId'> = {
    ordinal: spec.ordinal,
    subject: deepFreeze({
      outcomeRecordRef: spec.subject.outcomeId,
      decisionRef: spec.subject.decision.decisionRef,
      intentRef: spec.subject.decision.intentRef,
      outcomeClass: spec.subject.outcomeClass,
    }),
    expected: deepFreeze({
      expectedQuantity: spec.subject.expectation.expectedQuantity,
      expectedRealized: spec.subject.expectation.expectedRealized,
      tolerance: spec.subject.expectation.tolerance,
    }),
    happened: deepFreeze({
      disposition: spec.subject.decision.disposition,
      filledQuantity: spec.subject.realization.filledQuantity,
      realizedOutcome: spec.subject.realization.realizedOutcome,
      feeTotal: spec.subject.realization.feeTotal,
      notionalTotal: spec.subject.realization.notionalTotal,
    }),
    gap: deepFreeze({
      quantityShortfall: spec.subject.deviation.quantityShortfall,
      realizedGap: spec.subject.deviation.realizedGap,
      withinTolerance: spec.subject.deviation.withinTolerance,
    }),
    hypotheses: orderHypotheses(spec.hypotheses),
    evidence: deepFreeze([{ kind: 'shadow_outcome', ref: spec.subject.lineage.shadowOutcomeRef } as EvidenceRefMirror]),
    lineage: deepFreeze({
      tenant,
      project,
      shadowSessionRef: session,
      shadowOutcomeRef: spec.subject.lineage.shadowOutcomeRef,
      trajectoryRef: trajectory,
      experiment,
    }),
    asOf: asTimestampMs(spec.asOf),
    priorChainHead: '00000000',
  };
  return deepFreeze({ ...record, postMortemId: `pmr:${fnv1a32Hex(canonicalJson(postMortemContentTree(record)))}` } as PostMortemRecordMirror);
}

// ---------------------------------------------------------------------------
// The scenario snapshots
// ---------------------------------------------------------------------------

/** Batch 1: three adverse-leaning outcomes — decision + market(adverse) promote; model_error/data_lag stay below the bar. */
export function scenarioSnapshotAdverse(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const o1 = mintOutcome({ ordinal: 1, suffix: '1', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '5.25', realizedOutcome: '-1.75', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 25_000 });
  const o2 = mintOutcome({ ordinal: 2, suffix: '2', disposition: 'partial', outcomeClass: 'execution_shortfall', expectedRealized: '5', realizedOutcome: '5', filledQuantity: '0.3', tolerance: '1', asOf: FIRM_T0 + 120_000 });
  const o3 = mintOutcome({ ordinal: 3, suffix: '3', disposition: 'expired', outcomeClass: 'no_execution', expectedRealized: '1', realizedOutcome: '0', filledQuantity: '0', tolerance: '1', asOf: FIRM_T0 + 150_000 });
  return deepFreeze({
    outcomes: [o1, o2, o3],
    postMortems: [
      mintPostMortem({ ordinal: 1, subject: o1, hypotheses: [modelError('0.6', '5.25', '-1.75'), marketMove('0.5', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 180_000 }),
      mintPostMortem({ ordinal: 2, subject: o2, hypotheses: [marketMove('0.5', 'adverse'), decision('0.4', 'unresolved'), dataLag('0.3', FIRM_T0 + 120_000, FIRM_T0 + 120_150)], asOf: FIRM_T0 + 181_000 }),
      mintPostMortem({ ordinal: 3, subject: o3, hypotheses: [marketMove('0.5', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 182_000 }),
    ],
    at: asTimestampMs(FIRM_T0 + 200_000),
  });
}

/** Batch 2: two more adverse outcomes — the market/decision families REVISION; model_error over-projection births. */
export function scenarioSnapshotReinforce(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const o4 = mintOutcome({ ordinal: 4, suffix: '4', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '4', realizedOutcome: '-2', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 300_000 });
  const o5 = mintOutcome({ ordinal: 5, suffix: '5', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '3', realizedOutcome: '-1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 310_000 });
  return deepFreeze({
    outcomes: [o4, o5],
    postMortems: [
      mintPostMortem({ ordinal: 4, subject: o4, hypotheses: [modelError('0.55', '4', '-2'), marketMove('0.45', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 380_000 }),
      mintPostMortem({ ordinal: 5, subject: o5, hypotheses: [modelError('0.5', '3', '-1'), marketMove('0.4', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 381_000 }),
    ],
    at: asTimestampMs(FIRM_T0 + 400_000),
  });
}

/** Batch 3: two favorable outcomes — a NON-dominating market(favorable) challenger (e=2 < incumbent's 5): the contest is recorded, the incumbent stands. */
export function scenarioSnapshotChallenger(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const o6 = mintOutcome({ ordinal: 6, suffix: '6', disposition: 'filled', outcomeClass: 'favorable_gap', expectedRealized: '-1', realizedOutcome: '1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 500_000 });
  const o7 = mintOutcome({ ordinal: 7, suffix: '7', disposition: 'filled', outcomeClass: 'favorable_gap', expectedRealized: '-1', realizedOutcome: '2', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 510_000 });
  return deepFreeze({
    outcomes: [o6, o7],
    postMortems: [
      mintPostMortem({ ordinal: 6, subject: o6, hypotheses: [marketMove('0.5', 'favorable')], asOf: FIRM_T0 + 580_000 }),
      mintPostMortem({ ordinal: 7, subject: o7, hypotheses: [marketMove('0.45', 'favorable')], asOf: FIRM_T0 + 581_000 }),
    ],
    at: asTimestampMs(FIRM_T0 + 600_000),
  });
}

/** Batch 4: six favorable outcomes — the market(favorable) challenger DOMINATES (e=6 > 5): the contest is recorded AND the family flips. */
export function scenarioSnapshotDominating(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const outcomes: OutcomeRecordMirror[] = [];
  const postMortems: PostMortemRecordMirror[] = [];
  for (let index = 0; index < 6; index++) {
    const suffix = String(8 + index);
    const outcome = mintOutcome({ ordinal: 8 + index, suffix, disposition: 'filled', outcomeClass: 'favorable_gap', expectedRealized: '-1', realizedOutcome: '2', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 700_000 + index });
    outcomes.push(outcome);
    postMortems.push(mintPostMortem({ ordinal: 8 + index, subject: outcome, hypotheses: [marketMove('0.5', 'favorable')], asOf: FIRM_T0 + 780_000 + index }));
  }
  return deepFreeze({ outcomes, postMortems, at: asTimestampMs(FIRM_T0 + 800_000) });
}

/** Tenant B's own scope (the isolation tests' second world): two adverse outcomes, market(adverse) promotes. */
export function scenarioSnapshotTenantB(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const b1 = mintOutcome({ ordinal: 1, suffix: 'b1', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '2', realizedOutcome: '-1', filledQuantity: '0.5', tolerance: '1', asOf: FIRM_T0 + 40_000, tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, session: FIRM_SESSION_B, trajectory: 'trajectory-brain-b', experiment: { experimentRef: 'experiment-brain-b', trialRef: 'trial-brain-b' } });
  const b2 = mintOutcome({ ordinal: 2, suffix: 'b2', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '2', realizedOutcome: '-1.5', filledQuantity: '0.5', tolerance: '1', asOf: FIRM_T0 + 50_000, tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, session: FIRM_SESSION_B, trajectory: 'trajectory-brain-b', experiment: { experimentRef: 'experiment-brain-b', trialRef: 'trial-brain-b' } });
  return deepFreeze({
    outcomes: [b1, b2],
    postMortems: [
      mintPostMortem({ ordinal: 1, subject: b1, hypotheses: [marketMove('0.5', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 190_000, tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, session: FIRM_SESSION_B, trajectory: 'trajectory-brain-b', experiment: { experimentRef: 'experiment-brain-b', trialRef: 'trial-brain-b' } }),
      mintPostMortem({ ordinal: 2, subject: b2, hypotheses: [marketMove('0.5', 'adverse'), decision('0.4', 'unresolved')], asOf: FIRM_T0 + 191_000, tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, session: FIRM_SESSION_B, trajectory: 'trajectory-brain-b', experiment: { experimentRef: 'experiment-brain-b', trialRef: 'trial-brain-b' } }),
    ],
    at: asTimestampMs(FIRM_T0 + 250_000),
  });
}

/** The decision_pattern/timing internal contest (no existing family): 2 harmful vs 2 helpful — EQUAL counts, NEITHER promotes. */
export function scenarioSnapshotInternalContest(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const outcomes: OutcomeRecordMirror[] = [];
  const postMortems: PostMortemRecordMirror[] = [];
  const classes: readonly ['adverse_gap', 'favorable_gap'] = ['adverse_gap', 'favorable_gap'];
  for (let index = 0; index < 4; index++) {
    const outcomeClass = classes[index % 2] as 'adverse_gap' | 'favorable_gap';
    const suffix = `i${index + 1}`;
    const outcome = mintOutcome({ ordinal: 20 + index, suffix, disposition: 'filled', outcomeClass, expectedRealized: outcomeClass === 'adverse_gap' ? '2' : '-1', realizedOutcome: outcomeClass === 'adverse_gap' ? '-1' : '1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 900_000 + index * 10_000 });
    outcomes.push(outcome);
    postMortems.push(mintPostMortem({ ordinal: 20 + index, subject: outcome, hypotheses: [decision('0.4', 'timing')], asOf: FIRM_T0 + 950_000 + index }));
  }
  return deepFreeze({ outcomes, postMortems, at: asTimestampMs(FIRM_T0 + 1_000_000) });
}

/** The decision_pattern/timing internal DOMINATION (no existing family): 2 harmful vs 3 helpful — the helpful side (e=3) promotes + the contest is recorded. */
export function scenarioSnapshotInternalDomination(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const outcomes: OutcomeRecordMirror[] = [];
  const postMortems: PostMortemRecordMirror[] = [];
  // 2 harmful (adverse_gap) + 3 helpful (favorable_gap).
  const plan: readonly ('adverse_gap' | 'favorable_gap')[] = ['adverse_gap', 'adverse_gap', 'favorable_gap', 'favorable_gap', 'favorable_gap'];
  for (let index = 0; index < plan.length; index++) {
    const outcomeClass = plan[index] as 'adverse_gap' | 'favorable_gap';
    const suffix = `d${index + 1}`;
    const outcome = mintOutcome({ ordinal: 30 + index, suffix, disposition: 'filled', outcomeClass, expectedRealized: outcomeClass === 'adverse_gap' ? '2' : '-1', realizedOutcome: outcomeClass === 'adverse_gap' ? '-1' : '1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 1_100_000 + index * 10_000 });
    outcomes.push(outcome);
    postMortems.push(mintPostMortem({ ordinal: 30 + index, subject: outcome, hypotheses: [decision('0.4', 'timing')], asOf: FIRM_T0 + 1_150_000 + index }));
  }
  return deepFreeze({ outcomes, postMortems, at: asTimestampMs(FIRM_T0 + 1_200_000) });
}

/** The minimal fresh-birth batch (two outcomes, market(adverse)): pairs with the SHORT policy for the decay tests. */
export function scenarioSnapshotMinimal(): { readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly at: TimestampMs } {
  const m1 = mintOutcome({ ordinal: 40, suffix: 'm1', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '2', realizedOutcome: '-1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 1_300_000 });
  const m2 = mintOutcome({ ordinal: 41, suffix: 'm2', disposition: 'filled', outcomeClass: 'adverse_gap', expectedRealized: '2', realizedOutcome: '-1', filledQuantity: '0.75', tolerance: '1', asOf: FIRM_T0 + 1_310_000 });
  return deepFreeze({
    outcomes: [m1, m2],
    postMortems: [
      mintPostMortem({ ordinal: 40, subject: m1, hypotheses: [marketMove('0.5', 'adverse')], asOf: FIRM_T0 + 1_350_000 }),
      mintPostMortem({ ordinal: 41, subject: m2, hypotheses: [marketMove('0.5', 'adverse')], asOf: FIRM_T0 + 1_351_000 }),
    ],
    at: asTimestampMs(FIRM_T0 + 1_400_000),
  });
}

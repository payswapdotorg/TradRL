/**
 * T049 — the benchmark MACHINERY's unit laws (benchmarks/platform, tested
 * from the Work Order's only vitest-collected surface, research/
 * public-evaluation/src — see benchmarks/README.md).
 *
 * Every run law, axis law, log law, adoption law and discharge law is
 * pinned positively AND negatively (the typed error is the contract).
 * All fixtures are deterministic trusted literals; no clock, no
 * randomness, no network.
 */

import { describe, expect, it } from 'vitest';

import {
  deepFreeze,
  fixtureCandidateSuite,
  fixtureGenerativeSource,
  fixtureHoldoutReplaySource,
  fixtureHoldoutRunInput,
  fixtureLiveSource,
  fixturePlatformSuite,
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureRunInput,
  fixtureSearchRecord,
  fixtureSliceReport,
  fixtureSplitPlan,
  fixtureSubject,
  subjectForEvidence,
  suiteId,
  TENANT,
  PROJECT,
  validateSuiteDefinition,
  appendMeasurement,
  computeMeasurementChainHead,
  createMeasurementLog,
  measurementLogId,
  runSuiteMeasurement,
  searchRecordIdMirror,
  computeChainHeadMirror,
  verifyMeasurementRecord,
  verifyMeasurementLog,
  evaluateAdoptionGate,
  dischargeBenchmarkRequirements,
  isSubjectBinding,
  validateSubjectBinding,
  measurementId,
  canonicalMeasurement,
  type JsonObject,
  type MeasurementLog,
  type MeasurementRecord,
  type PlatformResult,
  type SuiteAxis,
  type SuiteDefinition,
  type SubjectBinding,
} from '../../../benchmarks/platform/src/index';

// ---------------------------------------------------------------------------
// Helpers (pure, local)
// ---------------------------------------------------------------------------

type Failure = { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message?: string }[] };

function firstError(result: Failure): string {
  return result.errors[0]?.code ?? '';
}

function runOf(overrides: Record<string, unknown>): PlatformResult<MeasurementRecord> {
  return runSuiteMeasurement({ ...fixtureRunInput(), ...overrides });
}

function holdoutRunOf(overrides: Record<string, unknown>): PlatformResult<MeasurementRecord> {
  return runSuiteMeasurement({ ...fixtureHoldoutRunInput(), ...overrides });
}

/** A mutable deep copy of a frozen fixture (the tamper target — fixtures are deeply frozen). */
function thaw<T>(value: T): T {
  return structuredClone(value);
}

/** A deep mutable copy of the fixture report with one tamper applied (typed as the fixture's own shape). */
function tamperedReport(tamper: (report: Record<string, unknown>) => void): JsonObject {
  const report = thaw(fixtureSliceReport()) as unknown as Record<string, unknown>;
  tamper(report);
  return report as unknown as JsonObject;
}

/** One axis off the fixture suite, replaced by name. */
function suiteWithAxes(axes: readonly SuiteAxis[]): SuiteDefinition {
  const content = fixturePlatformSuite();
  const replaced: Omit<SuiteDefinition, 'suite_id'> = { ...content, axes };
  return deepFreeze({ suite_id: suiteId(replaced), ...replaced });
}

// ---------------------------------------------------------------------------
// The suite-definition laws
// ---------------------------------------------------------------------------

describe('T049 machinery — the capability-suite definition', () => {
  it('content-addresses the platform suite: the same design addresses identically (cbms:)', () => {
    const content = fixturePlatformSuite();
    const again = fixturePlatformSuite();
    expect(suiteId(content)).toBe(suiteId(again));
    expect(suiteId(content)).toMatch(/^cbms:[0-9a-f]{16}$/);
  });

  it('a different axis set addresses differently (the id pins the exact design)', () => {
    const base = fixturePlatformSuite();
    const changed = suiteWithAxes(base.axes.slice(0, -1));
    expect(changed.suite_id).not.toBe(fixturePlatformSuiteRecord().suite_id);
  });

  it('verifies the fixture suite through the mirrored validator (collect-all + the content-address law)', () => {
    const result = validateSuiteDefinition(fixturePlatformSuiteRecord());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suite_id).toBe(fixturePlatformSuiteRecord().suite_id);
      expect(result.value.axes).toHaveLength(20);
    }
  });

  it('refuses a suite whose id disagrees with its content (L9)', () => {
    const suite = fixturePlatformSuiteRecord();
    const tampered = { ...suite, name: 'reference-slice-platform-v2' };
    const result = validateSuiteDefinition(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('invalid_field');
      expect(result.errors[0]?.message).toContain('content and address cannot disagree');
    }
  });

  it('refuses an axis naming a measurable outside the closed vocabulary (unknown_measurable)', () => {
    const offAxis: SuiteAxis = { axis: 'bad', measurable: 'marketData.embargoAvailableAt', kind: 'count', scale: null, attainment: {} };
    const result = validateSuiteDefinition(suiteWithAxes([offAxis]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path.includes('measurable'))).toBe(true);
      expect(result.errors[0]?.message).toContain('not a measurable');
    }
  });

  it('refuses a kind-mismatched axis (the axis kind must equal the measurable\'s kind)', () => {
    const mismatched: SuiteAxis = { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'count', scale: null, attainment: {} };
    const result = validateSuiteDefinition(suiteWithAxes([mismatched]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.message.includes("must equal the measurable's kind"))).toBe(true);
  });

  it('refuses a decimal axis without a declared exact scale (the scale law — the book money\'s scale is the report\'s own)', () => {
    // The book measurables are FLEXIBLE-SCALE (the REAL T048 report carries
    // realizedPnl at scale 0 and cash at scale 3; the fixture report at 2):
    // each suite's axis DECLARES the exact scale it expects, so a decimal
    // axis without one is a config error, never a guess.
    const noScale: SuiteAxis = { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'decimal', scale: null, attainment: {} };
    const result = validateSuiteDefinition(suiteWithAxes([noScale]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.message.includes('must declare the exact decimal scale'))).toBe(true);
  });

  it('measures the same book measurable at different exact scales across lawful suites (the flexible-scale law)', () => {
    // A report whose book carries scale-0 money; a suite declaring scale 0.
    const scaleZeroReport = tamperedReport((draft) => {
      const outcomes = draft.outcomes as Record<string, unknown>;
      const book = outcomes.book as Record<string, unknown>;
      book.realizedPnl = '0';
      book.cash = '989980';
    });
    const scaleZero: SuiteAxis = { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'decimal', scale: 0, attainment: { min: '0' } };
    const scaleZeroSuite = suiteWithAxes([scaleZero, { axis: 'cash', measurable: 'outcomes.cash', kind: 'decimal', scale: 0, attainment: {} }]);
    const zeroResult = runOf({ suite: scaleZeroSuite, evidence: scaleZeroReport, subject: subjectForEvidence(scaleZeroReport) });
    expect(zeroResult.ok).toBe(true);
    if (!zeroResult.ok) throw new Error(zeroResult.errors.map((error) => error.message).join('; '));
    expect(zeroResult.value.axes.find((axis) => axis.axis === 'realized-pnl')?.value).toBe('0');
    expect(zeroResult.value.axes.find((axis) => axis.axis === 'cash')?.value).toBe('989980');

    // The SAME measurable at scale 2 (the fixture report's own): the fixture suite is lawful as-is.
    const twoResult = runOf({});
    expect(twoResult.ok).toBe(true);
    if (!twoResult.ok) throw new Error(twoResult.errors.map((error) => error.message).join('; '));
    expect(twoResult.value.axes.find((axis) => axis.axis === 'realized-pnl')?.value).toBe('0.00');
  });

  it('refuses duplicate axis names and empty axis lists (collect-all)', () => {
    const axis: SuiteAxis = { axis: 'crypto-events', measurable: 'marketData.binanceEvents', kind: 'count', scale: null, attainment: { min: 1 } };
    const dupResult = validateSuiteDefinition(suiteWithAxes([axis, { ...axis }]));
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) expect(dupResult.errors.some((error) => error.message.includes('declared twice'))).toBe(true);

    const empty = validateSuiteDefinition({
      suite_id: 'cbms:x',
      name: 'n',
      subject_kind: 'reference-slice',
      evidence_class: 'simulation',
      evaluator: 'e://v1',
      axes: [],
      tenant: TENANT,
      project: PROJECT,
    });
    expect(empty.ok).toBe(false);
  });

  it('refuses an unsatisfiable decimal criterion (min > max at the exact decimal compare)', () => {
    const unsatisfiable: SuiteAxis = {
      axis: 'realized-pnl',
      measurable: 'outcomes.realizedPnl',
      kind: 'decimal',
      scale: 2,
      attainment: { min: '10.00', max: '1.00' },
    };
    const result = validateSuiteDefinition(suiteWithAxes([unsatisfiable]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.message.includes('coherent attainment criterion'))).toBe(true);
  });

  it('refuses digest/flag axes carrying min/max bounds (the criterion-kind law)', () => {
    const flagWithBounds: SuiteAxis = { axis: 'audit-coherent', measurable: 'gateway.auditCoherent', kind: 'flag', scale: null, attainment: { min: 1 } };
    const result = validateSuiteDefinition(suiteWithAxes([flagWithBounds]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.message.includes('coherent attainment criterion'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The subject-binding laws (L9)
// ---------------------------------------------------------------------------

describe('T049 machinery — the subject binding', () => {
  it('accepts the fixture binding', () => {
    const subject = fixtureSubject();
    expect(isSubjectBinding(subject)).toBe(true);
    expect(validateSubjectBinding(subject).ok).toBe(true);
  });

  it('collects EVERY missing lineage ref (the L9 binding is complete or refused)', () => {
    const subject = fixtureSubject() as unknown as Record<string, unknown>;
    const stripped = { ...subject };
    delete stripped.body;
    delete stripped.substrate;
    const result = validateSubjectBinding(stripped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.path)).toContain('subject.body');
      expect(result.errors.map((error) => error.path)).toContain('subject.substrate');
    }
  });

  it('refuses artifact digests that are not 16-hex content addresses', () => {
    const subject = fixtureSubject() as unknown as Record<string, unknown>;
    const forged = { ...subject, artifacts: [{ ref: 'slice://x', digest: 'not-a-digest' }] };
    expect(validateSubjectBinding(forged).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The measurement runner laws
// ---------------------------------------------------------------------------

describe('T049 machinery — runSuiteMeasurement (the runner laws)', () => {
  it('compiles the fixture in-search measurement: content-addressed, attained, deeply frozen', () => {
    const result = runOf({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const record = result.value;
    expect(record.measurement_id).toMatch(/^cbmm:[0-9a-f]{16}$/);
    expect(record.phase).toBe('in-search');
    expect(record.attained).toBe(true);
    expect(record.axes).toHaveLength(20);
    expect(record.subject.kind).toBe('reference-slice');
    expect(record.material.source_id).toMatch(/^rsrc:/);
    expect(record.material.origin).toBe('historical');
    expect(record.plan?.plan_id).toMatch(/^splan:/);
    expect(record.search).toBeNull();
    expect(record.tenant).toBe(TENANT);
    expect(record.project).toBe(PROJECT);
    expect(record.evaluator).toBe('evaluator://benchmark-platform/v1');
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('compiles the fixture holdout measurement with the bound search + reserved material', () => {
    const result = holdoutRunOf({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.phase).toBe('holdout');
    expect(result.value.search?.record_id).toMatch(/^srch:/);
    expect(result.value.search?.trial).toBe('trial-fixture-holdout-0001');
  });

  it('refuses a subject whose kind disagrees with the suite (subject_kind_mismatch)', () => {
    const subject: SubjectBinding = { ...fixtureSubject(), kind: 'capability-candidate' };
    const result = runOf({ subject });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('subject_kind_mismatch');
  });

  it('refuses evidence that is not a reference-slice report (invalid_evidence)', () => {
    const result = runOf({ evidence: { marketData: {} } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('invalid_evidence');
  });

  it('refuses evidence that violates a station invariant (pipeline_incoherent — the L16 clock law)', () => {
    const report = tamperedReport((draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      const orders = lineage.orderDecisions as { orderClock: number; decisionAsOf: number }[];
      orders[0] = { ...orders[0]!, orderClock: orders[0]!.decisionAsOf - 1 };
    });
    const result = runOf({ evidence: report, subject: subjectForEvidence(report) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('pipeline_incoherent');
      expect(result.errors[0]?.message).toContain('order clock precedes');
    }
  });

  it('refuses evidence whose content does not address to the pinned artifact digest (evidence_mismatch)', () => {
    const report = fixtureSliceReport();
    const otherSubject: SubjectBinding = { ...fixtureSubject(), artifacts: [{ ref: 'slice://other', digest: '0000000000000000' }] };
    const result = runOf({ evidence: report, subject: otherSubject });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('evidence_mismatch');
  });

  it('refuses a live-class suite over replay material (live_claim_on_simulation — a replay is simulation)', () => {
    const content = fixturePlatformSuite();
    const liveContent = deepFreeze({ ...content, evidence_class: 'live' as const });
    const liveSuite = deepFreeze({ suite_id: suiteId(liveContent), ...liveContent }) as SuiteDefinition;
    const result = runOf({ suite: liveSuite });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('live_claim_on_simulation');
  });

  it('refuses a live-class suite over a generative population (live_claim_on_simulation — L5/L6)', () => {
    const content = fixturePlatformSuite();
    const liveContent = deepFreeze({ ...content, evidence_class: 'live' as const });
    const liveSuite = deepFreeze({ suite_id: suiteId(liveContent), ...liveContent }) as SuiteDefinition;
    const result = runOf({ suite: liveSuite, material: fixtureGenerativeSource() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('live_claim_on_simulation');
      expect(result.errors[0]?.message).toContain('generated material');
    }
  });

  it('refuses a simulation-class suite over a live session (evidence_conflated)', () => {
    const result = runOf({ material: fixtureLiveSource() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('evidence_conflated');
  });

  it('refuses an in-search measurement whose material intersects the reserved unseen material (holdout_in_search)', () => {
    const result = runOf({ material: fixtureHoldoutReplaySource() }); // in-search phase over the RESERVED window
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('holdout_in_search');
      expect(result.errors[0]?.message).toContain('reserved unseen segment');
    }
  });

  it('refuses a holdout measurement without a search binding (search_context_required — holdout judges a search)', () => {
    const result = holdoutRunOf({ search: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('search_context_required');
      expect(result.errors[0]?.message).toContain('no search context');
    }
  });

  it('refuses a holdout measurement without a split plan (search_context_required — unseen material must be RESERVED)', () => {
    const result = holdoutRunOf({ plan: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('search_context_required');
      expect(result.errors[0]?.message).toContain('no split plan');
    }
  });

  it('refuses a holdout measurement over a generative population (synthetic_holdout — synthetic data is never unseen evidence)', () => {
    const result = holdoutRunOf({ material: fixtureGenerativeSource() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('synthetic_holdout');
      expect(result.errors[0]?.message).toContain('exploration instruments');
    }
  });

  it('refuses a holdout measurement over search (non-reserved) material (search_material_in_holdout)', () => {
    const result = holdoutRunOf({ material: fixtureReplaySource() }); // the SEARCH window, not the reserved one
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('search_material_in_holdout');
  });

  it('refuses a measurement binding a trial the search record never logged (unknown_trial)', () => {
    const result = holdoutRunOf({ search: { record: fixtureSearchRecord(), trial: 'trial-never-logged' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('unknown_trial');
  });

  it('refuses a phase that disagrees with the search record classification (classification_conflict)', () => {
    const result = holdoutRunOf({ search: { record: fixtureSearchRecord(), trial: 'trial-fixture-search-0001' } }); // in-search trial under a holdout phase
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('classification_conflict');
  });

  it('refuses a tampered search record (chain_mismatch — the mirrored T031 chain law)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as { trial: string }[];
    entries[0] = { ...entries[0]!, trial: 'trial-fixture-rewritten-0001' };
    const result = holdoutRunOf({ search: { record: tampered, trial: 'trial-fixture-holdout-0001' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('chain_mismatch');
  });

  it('refuses a search record scoped to another tenant (tenant_mismatch — L12)', () => {
    // Re-mint the record's identity + chain over the foreign binding first —
    // otherwise the (correct) identity law fires before the scope law and the
    // scope law is what this test pins.
    const foreign = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    foreign.tenant = 'tenant-somebody-else';
    const binding = {
      experiment: foreign.experiment as never,
      evaluator: foreign.evaluator as never,
      tenant: 'tenant-somebody-else' as never,
      project: foreign.project as never,
    };
    foreign.search_id = searchRecordIdMirror(binding);
    foreign.chain_head = computeChainHeadMirror(binding, foreign.entries as never);
    const result = holdoutRunOf({ search: { record: foreign, trial: 'trial-fixture-holdout-0001' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('tenant_mismatch');
  });

  it('refuses a tampered split plan (the mirrored T032 content-address law surfaces verbatim)', () => {
    const plan = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    plan.policy_ref = 'split-policy://forged';
    const result = holdoutRunOf({ plan });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const code = firstError(result);
      expect(code === 'invalid_field' || code === 'holdout_in_search' || code === 'search_context_required').toBe(true);
    }
  });

  it('judges attainment exactly: a failing criterion marks the record unattained without touching the others', () => {
    const impossible: SuiteAxis = { axis: 'impossible', measurable: 'gateway.routed', kind: 'count', scale: null, attainment: { min: 99 } };
    const result = runOf({ suite: suiteWithAxes([...fixturePlatformSuite().axes, impossible]) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.attained).toBe(false);
    expect(result.value.axes.find((axis) => axis.axis === 'impossible')?.attained).toBe(false);
    expect(result.value.axes.find((axis) => axis.axis === 'audit-coherent')?.attained).toBe(true);
  });

  it('refuses decimal evidence off the declared exact scale (scale_mismatch)', () => {
    const report = tamperedReport((draft) => {
      const outcomes = draft.outcomes as Record<string, unknown>;
      const book = outcomes.book as Record<string, unknown>;
      book.realizedPnl = '0.0'; // scale 1; the measurable declares 2
    });
    const result = runOf({ evidence: report, subject: subjectForEvidence(report) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('scale_mismatch');
  });

  it('measures a capability-candidate subject against the candidate suite (the discovery-loop lane)', () => {
    const candidateContent = fixtureCandidateSuite();
    const candidateSuite = deepFreeze({ suite_id: suiteId(candidateContent), ...candidateContent }) as SuiteDefinition;
    const result = runOf({ suite: candidateSuite, subject: subjectForEvidence(fixtureSliceReport(), 'capability-candidate') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.subject.kind).toBe('capability-candidate');
    expect(result.value.axes.map((axis) => axis.axis)).toEqual(['routed', 'realized-pnl', 'report-digest']);
  });
});

// ---------------------------------------------------------------------------
// The measurement record verifier
// ---------------------------------------------------------------------------

describe('T049 machinery — verifyMeasurementRecord (the L9 content-address gate)', () => {
  it('verifies the runner\'s own output', () => {
    const result = runOf({});
    if (!result.ok) throw new Error('unreachable');
    expect(verifyMeasurementRecord(result.value).ok).toBe(true);
  });

  it('refuses any mutated field (content and address cannot disagree)', () => {
    const result = runOf({});
    if (!result.ok) throw new Error('unreachable');
    const tampered = { ...result.value, attained: !result.value.attained };
    const verification = verifyMeasurementRecord(tampered);
    expect(verification.ok).toBe(false);
    if (!verification.ok) expect(firstError(verification)).toBe('measurement_mismatch');
  });

  it('re-derives the identical id from the record content (the recipe\'s expected id recomputes)', () => {
    const result = runOf({});
    if (!result.ok) throw new Error('unreachable');
    const { measurement_id: drop, ...content } = result.value;
    void drop;
    expect(measurementId(content)).toBe(result.value.measurement_id);
    expect(canonicalMeasurement(result.value).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The measurement log (L11 append-only + chain)
// ---------------------------------------------------------------------------

describe('T049 machinery — the measurement log', () => {
  function twoMeasurements(): [MeasurementRecord, MeasurementRecord] {
    const first = runOf({});
    const second = holdoutRunOf({});
    if (!first.ok || !second.ok) throw new Error('fixtures must compile');
    return [first.value, second.value];
  }

  function grownLog(): MeasurementLog {
    const [first, second] = twoMeasurements();
    const open = createMeasurementLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error(open.errors.map((error) => error.message).join('; '));
    const firstAppend = appendMeasurement(open.value, { measurement: first });
    if (!firstAppend.ok) throw new Error(firstAppend.errors.map((error) => error.message).join('; '));
    const secondAppend = appendMeasurement(firstAppend.value, { measurement: second });
    if (!secondAppend.ok) throw new Error(secondAppend.errors.map((error) => error.message).join('; '));
    return secondAppend.value;
  }

  it('opens a log with the derived identity and the genesis head', () => {
    const result = createMeasurementLog({ tenant: TENANT, project: PROJECT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.log_id).toBe(measurementLogId({ tenant: TENANT, project: PROJECT }));
    expect(result.value.log_id).toMatch(/^cbml:[0-9a-f]{16}$/);
    expect(result.value.entries).toHaveLength(0);
    expect(result.value.chain_head).toMatch(/^[0-9a-f]{16}$/);
  });

  it('appends in order, verifies end-to-end, and the chain advances', () => {
    const log = grownLog();
    expect(log.entries).toHaveLength(2);
    const verified = verifyMeasurementLog(log);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.errors.map((error) => error.message).join('; '));
    expect(verified.value.chain_head).toBe(computeMeasurementChainHead({ tenant: TENANT, project: PROJECT }, log.entries));
  });

  it('is append-only: appending returns a NEW log; the original is untouched', () => {
    const [first] = twoMeasurements();
    const open = createMeasurementLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const append = appendMeasurement(open.value, { measurement: first });
    if (!append.ok) throw new Error('unreachable');
    expect(append.value).not.toBe(open.value);
    expect(open.value.entries).toHaveLength(0);
    expect(append.value.entries).toHaveLength(1);
  });

  it('refuses a duplicate measurement id (one id, one entry — L11)', () => {
    const [first] = twoMeasurements();
    const open = createMeasurementLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const once = appendMeasurement(open.value, { measurement: first });
    if (!once.ok) throw new Error('unreachable');
    const twice = appendMeasurement(once.value, { measurement: first });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(firstError(twice)).toBe('duplicate_measurement');
  });

  it('refuses an entry that rewinds the log (L4 order)', () => {
    const [inSearch, holdout] = twoMeasurements(); // in-search at T0+30s, holdout at T0+40s
    const open = createMeasurementLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const appendHoldout = appendMeasurement(open.value, { measurement: holdout });
    if (!appendHoldout.ok) throw new Error('unreachable');
    const rewind = appendMeasurement(appendHoldout.value, { measurement: inSearch }); // earlier instant after a later one
    expect(rewind.ok).toBe(false);
    if (!rewind.ok) expect(rewind.errors[0]?.message).toContain('precedes the previous append');
  });

  it('refuses a foreign-tenant measurement (tenant_mismatch — L12)', () => {
    const [first] = twoMeasurements();
    const foreign = createMeasurementLog({ tenant: 'tenant-somebody-else' as never, project: PROJECT });
    if (!foreign.ok) throw new Error('unreachable');
    const append = appendMeasurement(foreign.value, { measurement: first });
    expect(append.ok).toBe(false);
    if (!append.ok) expect(firstError(append)).toBe('tenant_mismatch');
  });

  it('detects a REMOVED entry (hiding a failed measurement breaks the head — chain_mismatch)', () => {
    const log = grownLog();
    const memoryHoled = { ...log, entries: log.entries.slice(0, 1) };
    const verified = verifyMeasurementLog(memoryHoled);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('chain_mismatch');
  });

  it('detects a MUTATED entry (any field change fails the content-address gate)', () => {
    const log = grownLog();
    const mutated = {
      ...log,
      entries: log.entries.map((entry, index) => (index === 0 ? { ...entry, suite_name: 'reference-slice-platform-v2' } : entry)),
    };
    const verified = verifyMeasurementLog(mutated);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('measurement_mismatch');
  });

  it('refuses a forged log id (identity and binding cannot disagree — L9)', () => {
    const log = grownLog();
    const verified = verifyMeasurementLog({ ...log, log_id: 'cbml:0000000000000000' });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('chain_mismatch');
  });
});

// ---------------------------------------------------------------------------
// The adoption gate (the T035 evidence gates over measured evidence)
// ---------------------------------------------------------------------------

describe('T049 machinery — the adoption gate (the T035 discipline)', () => {
  /** A measured fixture bound to the retained search record (in-search or holdout trial, attained or not). */
  function measurementOf(phase: 'in-search' | 'holdout', attained: boolean): MeasurementRecord {
    const trial = phase === 'holdout' ? 'trial-fixture-holdout-0001' : 'trial-fixture-search-0001';
    const search = { record: fixtureSearchRecord(), trial };
    const base = phase === 'holdout' ? { ...fixtureHoldoutRunInput(), search } : { ...fixtureRunInput(), search };
    const content = base.suite;
    const axes = attained
      ? content.axes
      : content.axes.map((axis) => ('min' in axis.attainment && axis.attainment.min === 1 ? { ...axis, attainment: { min: 99 } } : axis));
    const suite = suiteWithAxes(axes);
    const result = runSuiteMeasurement({ ...base, suite });
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    return result.value;
  }

  /** A fully content-valid measurement scoped to a FOREIGN tenant (for the L12 gate). */
  function foreignTenantMeasurement(): MeasurementRecord {
    const FOREIGN = 'tenant-somebody-else' as never;
    const foreignContent = deepFreeze({ ...fixturePlatformSuite(), tenant: FOREIGN });
    const foreignSuite = deepFreeze({ suite_id: suiteId(foreignContent), ...foreignContent }) as SuiteDefinition;
    // Re-mint the retained record's identity + chain over the foreign binding
    // (a real foreign record would be built that way; the tampered original
    // would fail its own identity check first).
    const foreignRecord = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    foreignRecord.tenant = FOREIGN;
    const foreignBinding = {
      experiment: foreignRecord.experiment as never,
      evaluator: foreignRecord.evaluator as never,
      tenant: FOREIGN,
      project: foreignRecord.project as never,
    };
    foreignRecord.search_id = searchRecordIdMirror(foreignBinding);
    foreignRecord.chain_head = computeChainHeadMirror(foreignBinding, foreignRecord.entries as never);
    const result = runSuiteMeasurement({
      suite: foreignSuite,
      subject: fixtureSubject(),
      evidence: fixtureSliceReport(),
      material: fixtureReplaySource(),
      phase: 'in-search',
      search: { record: foreignRecord, trial: 'trial-fixture-search-0001' },
      plan: fixtureSplitPlan(),
      measured_at: fixtureRunInput().measured_at,
    });
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    return result.value;
  }

  it('releases when the cited evidence includes an ATTAINED holdout measurement', () => {
    const holdout = measurementOf('holdout', true);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: holdout, trial: 'trial-fixture-holdout-0001' }],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.value.decision).toBe('commissioned');
    expect(verdict.value.refusal).toBeNull();
    expect(verdict.value.grounding[0]?.classification).toBe('holdout');
  });

  it('withholds in-search-only attained evidence (selected_without_holdout — the best-of-N trap)', () => {
    const inSearch = measurementOf('in-search', true);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: inSearch, trial: 'trial-fixture-search-0001' }],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.value.decision).toBe('withheld');
    expect(verdict.value.refusal).toBe('selected_without_holdout');
  });

  it('withholds empty evidence (evidence_missing)', () => {
    const verdict = evaluateAdoptionGate({ policy: { requiresHoldout: true }, search: fixtureSearchRecord(), evidence: [] });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.value.refusal).toBe('evidence_missing');
  });

  it('withholds present-but-never-attained evidence (evidence_insufficient)', () => {
    const holdout = measurementOf('holdout', false);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: holdout, trial: 'trial-fixture-holdout-0001' }],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.value.refusal).toBe('evidence_insufficient');
  });

  it('releases ANY attained evidence when the policy drops the holdout requirement (the switch is the policy\'s)', () => {
    const inSearch = measurementOf('in-search', true);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: false },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: inSearch, trial: 'trial-fixture-search-0001' }],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.value.decision).toBe('commissioned');
  });

  it('fails closed on a trial the retained record never logged (hidden_trials)', () => {
    const holdout = measurementOf('holdout', true);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: holdout, trial: 'trial-hidden-from-the-record' }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(firstError(verdict)).toBe('hidden_trials');
      expect(verdict.errors[0]?.message).toContain('never logged');
    }
  });

  it('fails closed on evidence that does not bind the retained record (hidden_trials — the record must be named)', () => {
    const measurement = thaw(measurementOf('in-search', true)) as unknown as Record<string, unknown>;
    measurement.search = null; // strip the search binding, then re-mint the id over the tampered content
    const { measurement_id: _drop, ...content } = measurement as never as MeasurementRecord;
    void _drop;
    const reminted = { ...measurement, measurement_id: measurementId(content as Omit<MeasurementRecord, 'measurement_id'>) } as unknown as MeasurementRecord;
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: false },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: reminted, trial: 'trial-fixture-search-0001' }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(firstError(verdict)).toBe('hidden_trials');
  });

  it('refuses cross-tenant evidence (tenant_mismatch — L12)', () => {
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: false },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: foreignTenantMeasurement(), trial: 'trial-fixture-search-0001' }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(firstError(verdict)).toBe('tenant_mismatch');
  });

  it('refuses evidence citing a trial the measurement did not run under (citation agreement)', () => {
    const inSearch = measurementOf('in-search', true);
    const verdict = evaluateAdoptionGate({
      policy: { requiresHoldout: false },
      search: fixtureSearchRecord(),
      evidence: [{ measurement: inSearch, trial: 'trial-fixture-holdout-0001' }], // the measurement ran under the search trial
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.errors[0]?.message).toContain('must agree');
  });
});

// ---------------------------------------------------------------------------
// The discharge seam (T045's benchmark requirements)
// ---------------------------------------------------------------------------

describe('T049 machinery — the T045 discharge seam', () => {
  it('discharges a benchmark requirement with the winning measurement id in the evidence trail', () => {
    const result = runOf({});
    if (!result.ok) throw new Error('unreachable');
    const discharge = dischargeBenchmarkRequirements({
      contract: [
        { kind: 'benchmark', requirementRef: 'req-bench-1', benchmarkId: 'reference-slice-platform-v1' },
        { kind: 'measurement', requirementRef: 'req-latency-1', metric: 'p95-latency-ms', max: 500 },
      ],
      measurements: [result.value],
    });
    expect(discharge.ok).toBe(true);
    if (!discharge.ok) throw new Error(discharge.errors.map((error) => error.message).join('; '));
    expect(discharge.value).toHaveLength(1); // ONLY the benchmark member is this lane's to discharge
    expect(discharge.value[0]?.requirementRef).toBe('req-bench-1');
    expect(discharge.value[0]?.passed).toBe(true);
    expect(discharge.value[0]?.detail).toContain(result.value.measurement_id);
  });

  it('fails the requirement honestly when the suite was measured but never attained', () => {
    const content = fixturePlatformSuite();
    const strictAxes = content.axes.map((axis): SuiteAxis => ('min' in axis.attainment ? { ...axis, attainment: { min: 99 } } : axis));
    const result = runOf({ suite: suiteWithAxes(strictAxes) });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.attained).toBe(false);
    const discharge = dischargeBenchmarkRequirements({
      contract: [{ kind: 'benchmark', requirementRef: 'req-bench-1', benchmarkId: 'reference-slice-platform-v1' }],
      measurements: [result.value],
    });
    expect(discharge.ok).toBe(true);
    if (!discharge.ok) throw new Error('unreachable');
    expect(discharge.value[0]?.passed).toBe(false);
    expect(discharge.value[0]?.detail).toContain('none attained');
  });

  it('fails closed when a benchmark requirement names a suite the measurements never measured (requirement_unmatched)', () => {
    const result = runOf({});
    if (!result.ok) throw new Error('unreachable');
    const discharge = dischargeBenchmarkRequirements({
      contract: [{ kind: 'benchmark', requirementRef: 'req-bench-1', benchmarkId: 'suite-never-measured' }],
      measurements: [result.value],
    });
    expect(discharge.ok).toBe(false);
    if (!discharge.ok) {
      expect(firstError(discharge)).toBe('requirement_unmatched');
      expect(discharge.errors[0]?.message).toContain('never invents an outcome');
    }
  });

  it('refuses a malformed contract (invalid_contract)', () => {
    const discharge = dischargeBenchmarkRequirements({
      contract: [
        { kind: 'benchmark', requirementRef: 'dup', benchmarkId: 'x' },
        { kind: 'benchmark', requirementRef: 'dup', benchmarkId: 'y' },
      ],
      measurements: [],
    });
    expect(discharge.ok).toBe(false);
    if (!discharge.ok) expect(firstError(discharge)).toBe('invalid_contract');
  });

  it('refuses a malformed measurement (invalid_measurement via the content-address gate)', () => {
    const discharge = dischargeBenchmarkRequirements({
      contract: [{ kind: 'benchmark', requirementRef: 'req-bench-1', benchmarkId: 'reference-slice-platform-v1' }],
      measurements: [{ forged: true }],
    });
    expect(discharge.ok).toBe(false);
    if (!discharge.ok) expect(firstError(discharge)).toBe('invalid_measurement');
  });
});

// @tradrl/body-trading-director — the deterministic fixture set.
//
// Owning Work Order: T024. Every fixture is DETERMINISTIC (no clocks, no
// randomness — literal instants and literal ids), and every fixture is
// re-validated by the real guards in the tests. The golden outputs are
// built through the real factories (composeDirectorDecision) so their
// derived ids are honest.
//
// The four research report fixtures are field-for-field mirror records
// modeled on the four research lanes' own golden fixtures (T021/T022/
// T023) — same method citations, same summary derivations, same
// evidence discipline — re-scoped to this lane's tenant/project/seed.
// Their derived ids (`sr-`, `ed-`, `rr-`, `rc-`, `rx-`, `fa-`, `cad-`,
// `frr-`, `cmr-`, `cmrr-`) are minted by THIS package's identical
// canonical-JSON/stable-digest algorithms (byte-parity proven by the
// interop trip wires), so the REAL research validators accept them
// verbatim — the guard-parity trip wire in interop.test.ts.
//
// The golden scenarios (hand-derived expected outputs asserted in the
// tests): the quorum-met path (all four lanes aligned bullish), each
// single-lane-absence path (a typed absence record — never silence), the
// conflict path (majority stands, the conflict is recorded with
// per-body positions — never a silent average), the quorum-unmet
// escalation, and the irreconcilable-conflict escalation (records,
// never exceptions).
//
// (Type note: fixture literals are authored as plain records and cast to
// the branded contract types once — the brands are compile-time only.)

import { type TimestampMs, type JsonValue, canonicalJson, deepFreeze, stableDigest } from './primitives';
import { type GoalVersionRef, type ConstraintSetVersionRef, type TenantId, type ProjectId } from './ids';
import {
  type MethodRegistry,
  DIRECTOR_METHOD_REGISTRY,
  DIRECTOR_SYNTHESIS_METHOD,
  DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD,
} from './methods';
import {
  type SentimentReportMirror,
  type RegimeReportMirror,
  type FundamentalReportMirror,
  type CrossMarketReportMirror,
  type ResearchIntake,
} from './intake';
import { type DirectorCompositionInput, type DirectorOutcome, composeDirectorDecision } from './synthesis';
import {
  TRADING_DIRECTOR_BODY,
  type TradingDirectorBodySpec,
} from './body';
import { type TopicName, type ToolRef, type EvaluationCriteriaRef } from './ids';

// ---------------------------------------------------------------------------
// The fixture world (literal instants — no ambient clock anywhere)
// ---------------------------------------------------------------------------

/** The fixture epoch anchor (2024-06-03T16:00:00Z — matches the research suites). */
export const FIXTURE_AT0: TimestampMs = 1_717_423_200_000 as TimestampMs;

/** The research reports' as-of instant: one minute after the anchor (sentiment/regime/fundamental). */
export const FIXTURE_REPORT_AS_OF: TimestampMs = (1_717_423_200_000 + 60_000) as TimestampMs;

/** The cross-market report's as-of instant: four declared windows later (T023's discipline). */
export const FIXTURE_CM_REPORT_AS_OF: TimestampMs = (1_717_423_200_000 + 240_000) as TimestampMs;

/** The director's decision instant: one minute after the latest report (L4-satisfying). */
export const FIXTURE_DECISION_AS_OF: TimestampMs = (1_717_423_200_000 + 300_000) as TimestampMs;

/** The fixture tenant (L12 — shared by the four reports and the decision). */
export const FIXTURE_TENANT: TenantId = 'tenant-director' as TenantId;

/** The fixture project (L12 — shared by the four reports and the decision). */
export const FIXTURE_PROJECT: ProjectId = 'project-portfolio' as ProjectId;

/** The fixture run seed (lineage material — L9). */
export const FIXTURE_SEED = 'seed/director/fixture-1';

/** The fixture director body-version reference. */
export const DIRECTOR_FIXTURE_BODY_VERSION = 'trading-director@1.0.0';

/** The fixture goal ref (the mirror of trading-strategy's versioned pointer). */
export const FIXTURE_GOAL: GoalVersionRef = deepFreeze({ goalId: 'goal/portfolio-direction', version: 1 });

/** The fixture constraint-set refs (mirrors of trading-strategy's versioned pointers). */
export const FIXTURE_CONSTRAINT_SETS: readonly ConstraintSetVersionRef[] = deepFreeze([
  { id: 'constraints/max-drawdown', version: 1 },
  { id: 'constraints/gross-exposure', version: 1 },
]);

/** The fixture publishing instance (an agent-os AgentInstanceId shape). */
export const FIXTURE_SENDER = 'agent-instance-director-0001';

/** The fixture decision publication topic (an organization topic — never kernel.*). */
export const FIXTURE_DECISION_TOPIC = 'directors.decisions';

/** The fixture escalation publication topic (an organization topic — never kernel.*). */
export const FIXTURE_ESCALATION_TOPIC = 'directors.escalations';

/** Casts a literal epoch-millisecond number to `TimestampMs` (fixture discipline). */
const ms = (value: number): TimestampMs => value as TimestampMs;

/**
 * Derives a research-lane id with THIS package's (byte-identical)
 * canonical-JSON + stable-digest algorithm: `<prefix>-<digest>`. The
 * research lanes' own factories derive over the draft WITHOUT the id
 * field; parity is proven by the interop trip wires.
 */
const deriveId = (prefix: string, draft: unknown): string =>
  `${prefix}-${stableDigest(canonicalJson(draft as unknown as JsonValue))}`;

// ---------------------------------------------------------------------------
// The provenance blocks (mirrors of the research lanes' fixture blocks)
// ---------------------------------------------------------------------------

const NEWS_PROVENANCE = deepFreeze({
  origin: 'historical',
  adapter: { id: 'news-adapter', version: '1.0.0' },
  derived_from: [],
  transform: null,
});

const MARKET_PROVENANCE = deepFreeze({
  origin: 'historical',
  adapter: { id: 'market-adapter', version: '1.0.0' },
  derived_from: [],
  transform: null,
});

const INDEX_PROVENANCE = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-equities', version: '1.0.0' },
  derived_from: [],
  transform: null,
});

const ALTDATA_PROVENANCE = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-altdata', version: '1.0.0' },
  derived_from: [],
  transform: null,
});

const VENUE_PROVENANCE = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-venue', version: '1.0.0' },
  derived_from: [],
  transform: null,
});

// ---------------------------------------------------------------------------
// LANE 1: the sentiment research report fixture (T021 golden clone)
// ---------------------------------------------------------------------------

/** Five sentiment-score citations for TEST-AAA (mean 0.30, dispersion 0.06). */
const SENTIMENT_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-sent-001', availableTime: FIXTURE_AT0, provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-sent-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-sent-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-sent-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-sent-005', availableTime: ms(1_717_423_200_000 + 4_000), provenance: NEWS_PROVENANCE },
]);

/** Four earnings-tagged news citations for TEST-AAA (one clustering window). */
const NEWS_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-news-001', availableTime: FIXTURE_AT0, provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-news-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-news-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: NEWS_PROVENANCE },
  { observationId: 'obs-dir-news-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: NEWS_PROVENANCE },
]);

function buildSentimentReading(): { readonly readingId: string } & Record<string, unknown> {
  const draft = {
    scope: { instrument: 'TEST-AAA', venue: 'SENTIMENT-VENDOR' },
    polarity: {
      methodId: 'method/sentiment/aggregation',
      methodVersion: '1.0.0',
      direction: 'positive',
      score: '0.3000',
    },
    intensity: {
      methodId: 'method/sentiment/aggregation',
      methodVersion: '1.0.0',
      level: 'moderate',
      score: '0.3000',
    },
    confidence: {
      methodId: 'method/sentiment/confidence',
      methodVersion: '1.0.0',
      level: 'high',
      evidenceCount: 5,
      dispersion: '0.0600',
    },
    evidence: SENTIMENT_CITATIONS,
    asOf: FIXTURE_REPORT_AS_OF,
    bodyVersion: 'sentiment-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, readingId: deriveId('sr', draft) });
}

function buildSentimentDigest(): { readonly digestId: string } & Record<string, unknown> {
  const draft = {
    kind: 'earnings-announcement',
    instruments: ['TEST-AAA'],
    venues: ['NEWSWIRE'],
    window: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
    observationCount: 4,
    evidence: NEWS_CITATIONS,
    asOf: FIXTURE_REPORT_AS_OF,
    methodId: 'method/sentiment/event-detection',
    methodVersion: '1.0.0',
    bodyVersion: 'sentiment-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, digestId: deriveId('ed', draft) });
}

/** The golden sentiment reading (deterministic id, deeply frozen). */
export const FIXTURE_SENTIMENT_READING = buildSentimentReading();

/** The golden sentiment event digest (deterministic id, deeply frozen). */
export const FIXTURE_SENTIMENT_DIGEST = buildSentimentDigest();

/** The golden sentiment coverage accounting: nine offered, nine admitted. */
export const FIXTURE_SENTIMENT_COVERAGE = deepFreeze({
  observationsOffered: 9,
  observationsAdmitted: 9,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden sentiment data gaps (one instrument without sentiment coverage). */
export const FIXTURE_SENTIMENT_DATA_GAPS = deepFreeze([
  { kind: 'instrument-without-sentiment', instrument: 'TEST-BBB' },
]);

function buildSentimentReport(): SentimentReportMirror {
  const readings = [FIXTURE_SENTIMENT_READING];
  const digests = [FIXTURE_SENTIMENT_DIGEST];
  const draft = {
    asOf: FIXTURE_REPORT_AS_OF,
    bodyVersion: 'sentiment-researcher@1.0.0',
    methodId: 'method/sentiment/report-composition',
    methodVersion: '1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    readings,
    digests,
    summary: {
      readingCount: 1,
      digestCount: 1,
      instrumentCount: 1,
      dominantPolarity: 'positive',
      meanPolarityScore: '0.3000',
      coverage: FIXTURE_SENTIMENT_COVERAGE,
      dataGaps: FIXTURE_SENTIMENT_DATA_GAPS,
    },
  };
  return deepFreeze({ ...draft, reportId: deriveId('rr', draft) }) as unknown as SentimentReportMirror;
}

/** The golden sentiment research report (dominant polarity: positive). */
export const FIXTURE_SENTIMENT_REPORT: SentimentReportMirror = buildSentimentReport();

// ---------------------------------------------------------------------------
// LANE 2: the regime research report fixtures (T022 golden clones)
// ---------------------------------------------------------------------------

/** Citations for window W0 (the ranging evidence set). */
const REGIME_W0_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-mkt-001', availableTime: FIXTURE_AT0, provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: MARKET_PROVENANCE },
]);

/** Citations for window W1 (the trending evidence set). */
const REGIME_W1_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-mkt-005', availableTime: ms(1_717_423_200_000 + 10_000), provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-006', availableTime: ms(1_717_423_200_000 + 11_000), provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-007', availableTime: ms(1_717_423_200_000 + 12_000), provenance: MARKET_PROVENANCE },
  { observationId: 'obs-dir-mkt-008', availableTime: ms(1_717_423_200_000 + 13_000), provenance: MARKET_PROVENANCE },
]);

function buildRegimeClassification(input: {
  readonly label: string;
  readonly netMoveRatio: string;
  readonly meanAbsChangeRatio: string;
  readonly window: { readonly from: TimestampMs; readonly to: TimestampMs };
  readonly evidence: readonly unknown[];
  readonly dispersion: string;
}): { readonly classificationId: string } & Record<string, unknown> {
  const draft = {
    scope: { instrument: 'TEST-AAA', venue: 'SIM-EXCH' },
    label: input.label,
    netMoveRatio: input.netMoveRatio,
    meanAbsChangeRatio: input.meanAbsChangeRatio,
    window: input.window,
    observationCount: 4,
    evidence: input.evidence,
    confidence: {
      methodId: 'method/regime/confidence',
      methodVersion: '1.0.0',
      level: 'moderate',
      evidenceCount: 4,
      dispersion: input.dispersion,
    },
    asOf: FIXTURE_REPORT_AS_OF,
    methodId: 'method/regime/classification',
    methodVersion: '1.0.0',
    bodyVersion: 'regime-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, classificationId: deriveId('rc', draft) });
}

function buildRegimeChange(input: {
  readonly toLabel: string;
}): { readonly changeId: string } & Record<string, unknown> {
  const draft = {
    scope: { instrument: 'TEST-AAA', venue: 'SIM-EXCH' },
    fromLabel: 'ranging',
    toLabel: input.toLabel,
    fromWindow: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
    toWindow: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 13_000) },
    detectionInstant: ms(1_717_423_200_000 + 13_000),
    evidence: deepFreeze([...REGIME_W0_CITATIONS, ...REGIME_W1_CITATIONS]),
    asOf: FIXTURE_REPORT_AS_OF,
    methodId: 'method/regime/change-detection',
    methodVersion: '1.0.0',
    bodyVersion: 'regime-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, changeId: deriveId('rx', draft) });
}

/** The golden ranging classification (window W0). */
export const FIXTURE_REGIME_W0 = buildRegimeClassification({
  label: 'ranging',
  netMoveRatio: '0.0060',
  meanAbsChangeRatio: '0.0047',
  window: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
  evidence: REGIME_W0_CITATIONS,
  dispersion: '0.0060',
});

/** The golden trending-up classification (window W1). */
export const FIXTURE_REGIME_W1 = buildRegimeClassification({
  label: 'trending-up',
  netMoveRatio: '0.0417',
  meanAbsChangeRatio: '0.0139',
  window: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 13_000) },
  evidence: REGIME_W1_CITATIONS,
  dispersion: '0.0417',
});

/** The golden trending-down classification (window W1 — the bearish variant). */
export const FIXTURE_REGIME_W1_DOWN = buildRegimeClassification({
  label: 'trending-down',
  netMoveRatio: '-0.0417',
  meanAbsChangeRatio: '0.0139',
  window: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 13_000) },
  evidence: REGIME_W1_CITATIONS,
  dispersion: '0.0417',
});

/** The golden regime change (ranging -> trending-up). */
export const FIXTURE_REGIME_CHANGE = buildRegimeChange({ toLabel: 'trending-up' });

/** The golden bearish regime change (ranging -> trending-down). */
export const FIXTURE_REGIME_CHANGE_DOWN = buildRegimeChange({ toLabel: 'trending-down' });

/** The golden regime coverage accounting: eleven offered, ten admitted, one deferred. */
export const FIXTURE_REGIME_COVERAGE = deepFreeze({
  observationsOffered: 11,
  observationsAdmitted: 10,
  observationsDeferred: 1,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden regime data gaps (one instrument observed but never classified). */
export const FIXTURE_REGIME_DATA_GAPS = deepFreeze([
  { kind: 'instrument-without-classification', instrument: 'TEST-BBB' },
]);

function buildRegimeReport(input: {
  readonly w1: { readonly classificationId: string } & Record<string, unknown>;
  readonly change: { readonly changeId: string } & Record<string, unknown>;
  readonly dominantRegime: string;
  readonly meanNetMoveRatio: string;
}): RegimeReportMirror {
  const draft = {
    asOf: FIXTURE_REPORT_AS_OF,
    bodyVersion: 'regime-researcher@1.0.0',
    methodId: 'method/regime/report-composition',
    methodVersion: '1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    classifications: [FIXTURE_REGIME_W0, input.w1],
    changes: [input.change],
    summary: {
      classificationCount: 2,
      changeCount: 1,
      instrumentCount: 1,
      windowCount: 2,
      dominantRegime: input.dominantRegime,
      meanNetMoveRatio: input.meanNetMoveRatio,
      coverage: FIXTURE_REGIME_COVERAGE,
      dataGaps: FIXTURE_REGIME_DATA_GAPS,
    },
  };
  return deepFreeze({ ...draft, reportId: deriveId('rr', draft) }) as unknown as RegimeReportMirror;
}

/** The golden regime research report (dominant regime: trending-up). */
export const FIXTURE_REGIME_REPORT: RegimeReportMirror = buildRegimeReport({
  w1: FIXTURE_REGIME_W1,
  change: FIXTURE_REGIME_CHANGE,
  dominantRegime: 'trending-up',
  meanNetMoveRatio: '0.0238',
});

/** The golden bearish regime research report (dominant regime: trending-down). */
export const FIXTURE_BEARISH_REGIME_REPORT: RegimeReportMirror = buildRegimeReport({
  w1: FIXTURE_REGIME_W1_DOWN,
  change: FIXTURE_REGIME_CHANGE_DOWN,
  dominantRegime: 'trending-down',
  meanNetMoveRatio: '-0.0178',
});

// ---------------------------------------------------------------------------
// LANE 3: the fundamental research report fixtures (T023 golden clones)
// ---------------------------------------------------------------------------

/** Citations for the five index-level observations (the valuation evidence set). */
const FUNDAMENTAL_VALUATION_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-fund-001', availableTime: FIXTURE_AT0, provenance: INDEX_PROVENANCE },
  { observationId: 'obs-dir-fund-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: INDEX_PROVENANCE },
  { observationId: 'obs-dir-fund-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: INDEX_PROVENANCE },
  { observationId: 'obs-dir-fund-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: INDEX_PROVENANCE },
  { observationId: 'obs-dir-fund-005', availableTime: ms(1_717_423_200_000 + 4_000), provenance: INDEX_PROVENANCE },
]);

/** Citations for the two macro releases (the surprise evidence set). */
const FUNDAMENTAL_MACRO_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-macro-001', availableTime: FIXTURE_AT0, provenance: ALTDATA_PROVENANCE },
  { observationId: 'obs-dir-macro-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: ALTDATA_PROVENANCE },
]);

/** Citations for the four health observations (the trend evidence set). */
const FUNDAMENTAL_HEALTH_CITATIONS = deepFreeze([
  { observationId: 'obs-dir-health-001', availableTime: FIXTURE_AT0, provenance: ALTDATA_PROVENANCE },
  { observationId: 'obs-dir-health-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: ALTDATA_PROVENANCE },
  { observationId: 'obs-dir-health-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: ALTDATA_PROVENANCE },
  { observationId: 'obs-dir-health-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: ALTDATA_PROVENANCE },
]);

type StanceSign = 'positive' | 'negative';

function buildFundamentalAssessment(input: {
  readonly assessmentKind: 'valuation-level' | 'macro-surprise' | 'health-indicator';
  readonly methodId: string;
  readonly scope: { readonly instrument: string; readonly series: string };
  readonly stanceSign: StanceSign;
  readonly score: string;
  readonly confidenceLevel: 'high' | 'moderate';
  readonly evidenceCount: number;
  readonly dispersion: string;
  readonly evidence: readonly unknown[];
}): { readonly assessmentId: string } & Record<string, unknown> {
  const draft = {
    scope: input.scope,
    assessmentKind: input.assessmentKind,
    stance: {
      methodId: input.methodId,
      methodVersion: '1.0.0',
      direction: input.stanceSign,
      score: input.score,
    },
    confidence: {
      methodId: 'method/fundamental/confidence',
      methodVersion: '1.0.0',
      level: input.confidenceLevel,
      evidenceCount: input.evidenceCount,
      dispersion: input.dispersion,
    },
    evidence: input.evidence,
    asOf: FIXTURE_REPORT_AS_OF,
    bodyVersion: 'fundamental-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, assessmentId: deriveId('fa', draft) });
}

function buildCorporateActionDigest(input: {
  readonly action: 'split' | 'cash_dividend';
  readonly instruments: readonly string[];
  readonly at: TimestampMs;
  readonly observationId: string;
  readonly implication: 'neutral' | 'positive';
}): { readonly digestId: string } & Record<string, unknown> {
  const draft = {
    action: input.action,
    instruments: input.instruments,
    venues: ['LICENSED-INDEX-A'],
    window: { from: input.at, to: input.at },
    observationCount: 1,
    implication: input.implication,
    evidence: deepFreeze([
      { observationId: input.observationId, availableTime: input.at, provenance: INDEX_PROVENANCE },
    ]),
    asOf: FIXTURE_REPORT_AS_OF,
    methodId: 'method/fundamental/corporate-action',
    methodVersion: '1.0.0',
    bodyVersion: 'fundamental-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, digestId: deriveId('cad', draft) });
}

function fundamentalAssessments(sign: StanceSign): ({ readonly assessmentId: string } & Record<string, unknown>)[] {
  const polarity = sign === 'positive' ? 1 : -1;
  return [
    buildFundamentalAssessment({
      assessmentKind: 'valuation-level',
      methodId: 'method/fundamental/valuation',
      scope: { instrument: 'TEST-LARGECAP', series: 'INDEX_LEVEL' },
      stanceSign: sign,
      score: `${polarity > 0 ? '' : '-'}0.0242`,
      confidenceLevel: 'high',
      evidenceCount: 5,
      dispersion: '0.0291',
      evidence: FUNDAMENTAL_VALUATION_CITATIONS,
    }),
    buildFundamentalAssessment({
      assessmentKind: 'macro-surprise',
      methodId: 'method/fundamental/macro-surprise',
      scope: { instrument: 'TEST-ECON-CPI', series: 'TEST-ECON-CPI' },
      stanceSign: sign,
      score: `${polarity > 0 ? '' : '-'}0.0390`,
      confidenceLevel: 'moderate',
      evidenceCount: 2,
      dispersion: '0.0294',
      evidence: FUNDAMENTAL_MACRO_CITATIONS,
    }),
    buildFundamentalAssessment({
      assessmentKind: 'health-indicator',
      methodId: 'method/fundamental/health',
      scope: { instrument: 'TEST-SAT-OIL', series: 'ACTIVE_RIG_COUNT' },
      stanceSign: sign,
      score: `${polarity > 0 ? '' : '-'}0.0800`,
      confidenceLevel: 'moderate',
      evidenceCount: 4,
      dispersion: '0.0741',
      evidence: FUNDAMENTAL_HEALTH_CITATIONS,
    }),
  ];
}

/** The golden corporate-action digests (split + cash dividend). */
export const FIXTURE_ACTION_DIGESTS = deepFreeze([
  buildCorporateActionDigest({
    action: 'split',
    instruments: ['TEST-AAA'],
    at: ms(1_717_423_200_000 + 10_000),
    observationId: 'obs-dir-action-001',
    implication: 'neutral',
  }),
  buildCorporateActionDigest({
    action: 'cash_dividend',
    instruments: ['TEST-BBB'],
    at: ms(1_717_423_200_000 + 11_000),
    observationId: 'obs-dir-action-002',
    implication: 'positive',
  }),
]);

/** The golden fundamental coverage accounting: fourteen offered, fourteen admitted. */
export const FIXTURE_FUNDAMENTAL_COVERAGE = deepFreeze({
  observationsOffered: 14,
  observationsAdmitted: 14,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden fundamental data gaps (one out-of-method fundamental series). */
export const FIXTURE_FUNDAMENTAL_DATA_GAPS = deepFreeze([
  { kind: 'unassessed-series', instrument: 'TEST-MIDCAP', series: 'MISC_METRIC' },
]);

function buildFundamentalReport(sign: StanceSign): FundamentalReportMirror {
  const draft = {
    asOf: FIXTURE_REPORT_AS_OF,
    bodyVersion: 'fundamental-researcher@1.0.0',
    methodId: 'method/fundamental/report-composition',
    methodVersion: '1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    assessments: fundamentalAssessments(sign),
    actionDigests: FIXTURE_ACTION_DIGESTS,
    summary: {
      assessmentCount: 3,
      actionDigestCount: 2,
      instrumentCount: 5,
      dominantStance: sign,
      meanStanceScore: sign === 'positive' ? '0.0477' : '-0.0477',
      coverage: FIXTURE_FUNDAMENTAL_COVERAGE,
      dataGaps: FIXTURE_FUNDAMENTAL_DATA_GAPS,
    },
  };
  return deepFreeze({ ...draft, reportId: deriveId('frr', draft) }) as unknown as FundamentalReportMirror;
}

/** The golden fundamental research report (dominant stance: positive). */
export const FIXTURE_FUNDAMENTAL_REPORT: FundamentalReportMirror = buildFundamentalReport('positive');

/** The golden bearish fundamental research report (dominant stance: negative — the conflict fixture). */
export const FIXTURE_NEGATIVE_FUNDAMENTAL_REPORT: FundamentalReportMirror = buildFundamentalReport('negative');

// ---------------------------------------------------------------------------
// LANE 4: the cross-market research report fixture (T023 golden clone)
// ---------------------------------------------------------------------------

const CM_WINDOW_MS = 60_000;
const w = (index: number): TimestampMs => ms(1_717_423_200_000 + index * CM_WINDOW_MS);

/** The three golden market legs (the pair formation input). */
const CM_LEGS = deepFreeze({
  chain: { venue: 'CHAINX', instrument: 'TEST-CHAIN-A', assetClass: 'crypto', series: 'trade' },
  largecap: { venue: 'LICENSED-INDEX-A', instrument: 'TEST-LARGECAP', assetClass: 'index', series: 'INDEX_LEVEL' },
  aaa: { venue: 'TESTEX', instrument: 'TEST-AAA', assetClass: 'equity', series: 'trade' },
});

/** The observation ids of each leg (four per leg, one per declared window). */
const CM_LEG_OBSERVATIONS: Record<'chain' | 'largecap' | 'aaa', { readonly id: string; readonly at: TimestampMs; readonly provenance: unknown }[]> = {
  chain: [0, 1, 2, 3].map((index) => ({ id: `obs-dir-cm-ca-00${index + 1}`, at: w(index), provenance: VENUE_PROVENANCE })),
  largecap: [0, 1, 2, 3].map((index) => ({ id: `obs-dir-cm-lx-00${index + 1}`, at: w(index), provenance: INDEX_PROVENANCE })),
  aaa: [0, 1, 2, 3].map((index) => ({ id: `obs-dir-cm-aa-00${index + 1}`, at: w(index), provenance: VENUE_PROVENANCE })),
};

/**
 * Citations for one pair's evidence, in canonical (availableTime,
 * observationId) order, each tagged with its leg.
 */
function pairCitations(
  leftKey: 'chain' | 'largecap' | 'aaa',
  rightKey: 'chain' | 'largecap' | 'aaa',
): { readonly leg: 'left' | 'right'; readonly observationId: string; readonly availableTime: TimestampMs; readonly provenance: unknown }[] {
  const citations: { leg: 'left' | 'right'; observationId: string; availableTime: TimestampMs; provenance: unknown }[] = [];
  for (const observation of CM_LEG_OBSERVATIONS[leftKey]) {
    citations.push({ leg: 'left', observationId: observation.id, availableTime: observation.at, provenance: observation.provenance });
  }
  for (const observation of CM_LEG_OBSERVATIONS[rightKey]) {
    citations.push({ leg: 'right', observationId: observation.id, availableTime: observation.at, provenance: observation.provenance });
  }
  citations.sort((a, b) => {
    if (a.availableTime !== b.availableTime) return a.availableTime < b.availableTime ? -1 : 1;
    return a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
  });
  return deepFreeze(citations);
}

const PAIR_1_EVIDENCE = pairCitations('chain', 'largecap');
const PAIR_2_EVIDENCE = pairCitations('chain', 'aaa');
const PAIR_3_EVIDENCE = pairCitations('largecap', 'aaa');

function buildCrossMarketRelationship(input: {
  readonly pair: { readonly left: unknown; readonly right: unknown };
  readonly relationKind: 'co-movement' | 'lead-lag' | 'spread-divergence';
  readonly methodId: string;
  readonly direction: string;
  readonly score: string;
  readonly evidence: readonly unknown[];
}): { readonly relationshipId: string } & Record<string, unknown> {
  const draft = {
    pair: input.pair,
    relationKind: input.relationKind,
    measure: {
      methodId: input.methodId,
      methodVersion: '1.0.0',
      direction: input.direction,
      score: input.score,
    },
    window: deepFreeze({ from: w(0), to: w(3) }),
    confidence: {
      methodId: 'method/crossmarket/confidence',
      methodVersion: '1.0.0',
      level: 'high',
      evidenceCount: 8,
      legImbalance: 0,
    },
    evidence: input.evidence,
    asOf: FIXTURE_CM_REPORT_AS_OF,
    bodyVersion: 'cross-market-researcher@1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
  };
  return deepFreeze({ ...draft, relationshipId: deriveId('cmr', draft) });
}

/** THE golden relationships (five, in canonical (leftKey, rightKey, relationKind) order). */
export const FIXTURE_CROSS_MARKET_RELATIONSHIPS = deepFreeze([
  buildCrossMarketRelationship({ pair: { left: CM_LEGS.chain, right: CM_LEGS.largecap }, relationKind: 'spread-divergence', methodId: 'method/crossmarket/spread-divergence', direction: 'narrowing', score: '-0.0300', evidence: PAIR_1_EVIDENCE }),
  buildCrossMarketRelationship({ pair: { left: CM_LEGS.chain, right: CM_LEGS.aaa }, relationKind: 'spread-divergence', methodId: 'method/crossmarket/spread-divergence', direction: 'narrowing', score: '-0.0600', evidence: PAIR_2_EVIDENCE }),
  buildCrossMarketRelationship({ pair: { left: CM_LEGS.largecap, right: CM_LEGS.aaa }, relationKind: 'co-movement', methodId: 'method/crossmarket/co-movement', direction: 'positive', score: '1.0000', evidence: PAIR_3_EVIDENCE }),
  buildCrossMarketRelationship({ pair: { left: CM_LEGS.largecap, right: CM_LEGS.aaa }, relationKind: 'lead-lag', methodId: 'method/crossmarket/lead-lag', direction: 'no-lead', score: '0.0000', evidence: PAIR_3_EVIDENCE }),
  buildCrossMarketRelationship({ pair: { left: CM_LEGS.largecap, right: CM_LEGS.aaa }, relationKind: 'spread-divergence', methodId: 'method/crossmarket/spread-divergence', direction: 'narrowing', score: '-0.0300', evidence: PAIR_3_EVIDENCE }),
]);

/** The golden cross-market coverage accounting: twelve offered, twelve admitted. */
export const FIXTURE_CROSS_MARKET_COVERAGE = deepFreeze({
  observationsOffered: 12,
  observationsAdmitted: 12,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden cross-market data gaps (the flat leg's pairs, both relation gaps each). */
export const FIXTURE_CROSS_MARKET_DATA_GAPS = deepFreeze([
  { kind: 'insufficient-compared-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-LARGECAP' },
  { kind: 'insufficient-compared-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-AAA' },
  { kind: 'insufficient-decisive-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-LARGECAP' },
  { kind: 'insufficient-decisive-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-AAA' },
]);

function buildCrossMarketReport(): CrossMarketReportMirror {
  const draft = {
    asOf: FIXTURE_CM_REPORT_AS_OF,
    bodyVersion: 'cross-market-researcher@1.0.0',
    methodId: 'method/crossmarket/report-composition',
    methodVersion: '1.0.0',
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    relationships: FIXTURE_CROSS_MARKET_RELATIONSHIPS,
    summary: {
      relationshipCount: 5,
      pairCount: 3,
      instrumentCount: 3,
      dominantRelationKind: 'spread-divergence',
      meanMeasureScore: '0.1760',
      coverage: FIXTURE_CROSS_MARKET_COVERAGE,
      dataGaps: FIXTURE_CROSS_MARKET_DATA_GAPS,
    },
  };
  return deepFreeze({ ...draft, reportId: deriveId('cmrr', draft) }) as unknown as CrossMarketReportMirror;
}

/** The golden cross-market research report (dominant relation kind: spread-divergence). */
export const FIXTURE_CROSS_MARKET_REPORT: CrossMarketReportMirror = buildCrossMarketReport();

// ---------------------------------------------------------------------------
// The composition scenarios (deterministic; canonical method unless noted)
// ---------------------------------------------------------------------------

/** The full four-lane intake (all lanes present and aligned bullish). */
export const FIXTURE_FULL_INTAKE: ResearchIntake = deepFreeze({
  sentiment: FIXTURE_SENTIMENT_REPORT,
  regime: FIXTURE_REGIME_REPORT,
  fundamental: FIXTURE_FUNDAMENTAL_REPORT,
  crossMarket: FIXTURE_CROSS_MARKET_REPORT,
});

/** Builds a composition input over the fixture world (canonical method by default). */
export function fixtureCompositionInput(
  intake: ResearchIntake,
  methodId: string = DIRECTOR_SYNTHESIS_METHOD.methodId,
): DirectorCompositionInput {
  return {
    asOf: FIXTURE_DECISION_AS_OF,
    goal: FIXTURE_GOAL,
    constraintSets: FIXTURE_CONSTRAINT_SETS,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    methodId,
    registry: DIRECTOR_METHOD_REGISTRY,
    bodyVersion: DIRECTOR_FIXTURE_BODY_VERSION as never,
    intake,
  };
}

/** THE QUORUM-MET SCENARIO: all four lanes present, aligned bullish. */
export const FIXTURE_QUORUM_MET_INPUT: DirectorCompositionInput = fixtureCompositionInput(FIXTURE_FULL_INTAKE);

/** The sentiment-absence scenario (three lanes present; typed absence record). */
export const FIXTURE_NO_SENTIMENT_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: null, regime: FIXTURE_REGIME_REPORT, fundamental: FIXTURE_FUNDAMENTAL_REPORT, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
);

/** The regime-absence scenario (three lanes present; typed absence record). */
export const FIXTURE_NO_REGIME_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: null, fundamental: FIXTURE_FUNDAMENTAL_REPORT, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
);

/** The fundamental-absence scenario (three lanes present; typed absence record). */
export const FIXTURE_NO_FUNDAMENTAL_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: FIXTURE_REGIME_REPORT, fundamental: null, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
);

/** The cross-market-absence scenario (three lanes present; typed absence record). */
export const FIXTURE_NO_CROSS_MARKET_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: FIXTURE_REGIME_REPORT, fundamental: FIXTURE_FUNDAMENTAL_REPORT, crossMarket: null }),
);

/** THE CONFLICT SCENARIO: fundamental bearish against sentiment/regime bullish. */
export const FIXTURE_CONFLICT_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: FIXTURE_REGIME_REPORT, fundamental: FIXTURE_NEGATIVE_FUNDAMENTAL_REPORT, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
);

/** THE QUORUM-UNMET SCENARIO: only two lanes present (declared quorum 3). */
export const FIXTURE_QUORUM_UNMET_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: null, fundamental: FIXTURE_FUNDAMENTAL_REPORT, crossMarket: null }),
);

/** THE IRRECONCILABLE-CONFLICT SCENARIO: bullish vs bearish tie on TEST-AAA (no strict majority). */
export const FIXTURE_IRRECONCILABLE_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: FIXTURE_BEARISH_REGIME_REPORT, fundamental: null, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
);

/** THE CONSERVATIVE QUORUM-UNMET SCENARIO: three lanes present under the quorum-4 conservative method. */
export const FIXTURE_CONSERVATIVE_QUORUM_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: null, regime: FIXTURE_REGIME_REPORT, fundamental: FIXTURE_FUNDAMENTAL_REPORT, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
  DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD.methodId,
);

/** THE CONSERVATIVE CONFLICT SCENARIO: any conflict escalates under the conservative method. */
export const FIXTURE_CONSERVATIVE_CONFLICT_INPUT: DirectorCompositionInput = fixtureCompositionInput(
  deepFreeze({ sentiment: FIXTURE_SENTIMENT_REPORT, regime: FIXTURE_REGIME_REPORT, fundamental: FIXTURE_NEGATIVE_FUNDAMENTAL_REPORT, crossMarket: FIXTURE_CROSS_MARKET_REPORT }),
  DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD.methodId,
);

function buildOutcome(input: DirectorCompositionInput): DirectorOutcome {
  const construction = composeDirectorDecision(input);
  if (!construction.ok) {
    throw new TypeError(
      `golden outcome must compose: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
}

/** THE GOLDEN QUORUM-MET DECISION (deterministic id, deeply frozen). */
export const FIXTURE_GOLDEN_DECISION: DirectorOutcome = buildOutcome(FIXTURE_QUORUM_MET_INPUT);

/** The golden sentiment-absence decision. */
export const FIXTURE_NO_SENTIMENT_DECISION: DirectorOutcome = buildOutcome(FIXTURE_NO_SENTIMENT_INPUT);

/** The golden regime-absence decision. */
export const FIXTURE_NO_REGIME_DECISION: DirectorOutcome = buildOutcome(FIXTURE_NO_REGIME_INPUT);

/** The golden fundamental-absence decision. */
export const FIXTURE_NO_FUNDAMENTAL_DECISION: DirectorOutcome = buildOutcome(FIXTURE_NO_FUNDAMENTAL_INPUT);

/** The golden cross-market-absence decision. */
export const FIXTURE_NO_CROSS_MARKET_DECISION: DirectorOutcome = buildOutcome(FIXTURE_NO_CROSS_MARKET_INPUT);

/** THE GOLDEN CONFLICT DECISION (conflict recorded, majority stands). */
export const FIXTURE_CONFLICT_DECISION: DirectorOutcome = buildOutcome(FIXTURE_CONFLICT_INPUT);

/** THE GOLDEN QUORUM-UNMET ESCALATION (a record, never an exception). */
export const FIXTURE_QUORUM_UNMET_ESCALATION: DirectorOutcome = buildOutcome(FIXTURE_QUORUM_UNMET_INPUT);

/** THE GOLDEN IRRECONCILABLE-CONFLICT ESCALATION (a record, never an exception). */
export const FIXTURE_IRRECONCILABLE_ESCALATION: DirectorOutcome = buildOutcome(FIXTURE_IRRECONCILABLE_INPUT);

/** The golden conservative quorum-unmet escalation (quorum 4, three lanes). */
export const FIXTURE_CONSERVATIVE_QUORUM_ESCALATION: DirectorOutcome = buildOutcome(FIXTURE_CONSERVATIVE_QUORUM_INPUT);

/** The golden conservative conflict escalation (any conflict escalates). */
export const FIXTURE_CONSERVATIVE_CONFLICT_ESCALATION: DirectorOutcome = buildOutcome(FIXTURE_CONSERVATIVE_CONFLICT_INPUT);

/** The registry the golden outputs cite (re-exported for tests). */
export const FIXTURE_REGISTRY: MethodRegistry = DIRECTOR_METHOD_REGISTRY;

// ---------------------------------------------------------------------------
// Violation fixtures (the negative paths — each MUST fail validation)
// ---------------------------------------------------------------------------

/** A research intake whose sentiment report is from THE FUTURE (the L4 law). */
export function futureResearchIntake(): ResearchIntake {
  return deepFreeze({
    ...FIXTURE_FULL_INTAKE,
    sentiment: deepFreeze({
      ...FIXTURE_SENTIMENT_REPORT,
      asOf: ms(1_717_423_200_000 + 300_001),
    }) as unknown as SentimentReportMirror,
  });
}

/** A research intake whose sentiment report is computed EXACTLY at the decision instant (the L4 inclusive boundary — LEGAL). */
export function boundaryResearchIntake(): ResearchIntake {
  return deepFreeze({
    ...FIXTURE_FULL_INTAKE,
    sentiment: deepFreeze({
      ...FIXTURE_SENTIMENT_REPORT,
      asOf: FIXTURE_DECISION_AS_OF,
    }) as unknown as SentimentReportMirror,
  });
}

/** A research intake whose sentiment report carries a FOREIGN tenant (the L12 law). */
export function foreignTenantIntake(): ResearchIntake {
  return deepFreeze({
    ...FIXTURE_FULL_INTAKE,
    sentiment: deepFreeze({
      ...FIXTURE_SENTIMENT_REPORT,
      tenantId: 'tenant-foreign' as TenantId,
    }) as unknown as SentimentReportMirror,
  });
}

/** A body spec edited to GRANT execution authority (the L8 trip-wire). */
export function executionGrantedBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    bodyVersion: {
      ...TRADING_DIRECTOR_BODY.bodyVersion,
      composition: {
        ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary,
          allowedActions: [...TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary.allowedActions, 'EXECUTE'],
        },
      },
    },
  };
}

/** A body spec whose execution authority is NOT 'none' (the L8 trip-wire). */
export function externalGatewayBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    bodyVersion: {
      ...TRADING_DIRECTOR_BODY.bodyVersion,
      composition: {
        ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only',
        },
      },
    },
  };
}

/** A body spec that does NOT explicitly prohibit EXECUTE (the L8 trip-wire). */
export function executeNotProhibitedBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    bodyVersion: {
      ...TRADING_DIRECTOR_BODY.bodyVersion,
      composition: {
        ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary,
          prohibitedActions: TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions.filter(
            (action) => action !== 'EXECUTE',
          ),
        },
      },
    },
  };
}

/** A body spec whose procedure cites a CONSEQUENTIAL tool (the L8/L16 trip-wire). */
export function consequentialToolBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    bodyVersion: {
      ...TRADING_DIRECTOR_BODY.bodyVersion,
      composition: {
        ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
        knowledgeToolPolicy: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition.knowledgeToolPolicy,
          allowedTools: [
            ...TRADING_DIRECTOR_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools,
            'tools/order-entry' as ToolRef,
          ],
        },
        procedures: TRADING_DIRECTOR_BODY.bodyVersion.composition.procedures.map((procedure) => ({
          ...procedure,
          steps: procedure.steps.map((step) =>
            step.id === 'publish'
              ? { ...step, toolRefs: [...step.toolRefs, 'tools/order-entry' as ToolRef] }
              : step,
          ),
        })),
      },
    },
  };
}

/** A body spec with a NON-DECISION capability category (the L8/L16 declaration). */
export function nonDecisionCapabilityBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    bodyVersion: {
      ...TRADING_DIRECTOR_BODY.bodyVersion,
      composition: {
        ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
        capabilities: TRADING_DIRECTOR_BODY.bodyVersion.composition.capabilities.map((capability) =>
          capability.id === 'decision-synthesis' ? { ...capability, category: 'execution' } : capability,
        ),
      },
    },
  };
}

/** A body spec whose authority-scope record was edited off the law (the L8 trip-wire). */
export function editedAuthorityScopeBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    director: {
      ...TRADING_DIRECTOR_BODY.director,
      authorityScope: {
        scope: 'research-consumption-decision-publication',
        execution: 'external-gateway-only',
        orderPlacement: 'prohibited',
        orderLevelControl: 'prohibited',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as TradingDirectorBodySpec;
}

/** A body spec whose authority-scope record grants ORDER-LEVEL control (the L16 trip-wire). */
export function orderLevelControlBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    director: {
      ...TRADING_DIRECTOR_BODY.director,
      authorityScope: {
        scope: 'research-consumption-decision-publication',
        execution: 'prohibited',
        orderPlacement: 'prohibited',
        orderLevelControl: 'permitted',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as TradingDirectorBodySpec;
}

/** A body spec declaring an ORDER-LEVEL clock (the L16 trip-wire). */
export function orderLevelClockBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    director: {
      ...TRADING_DIRECTOR_BODY.director,
      clock: 'order-level' as never,
    },
  } as unknown as TradingDirectorBodySpec;
}

/** A body spec citing a MODEL IDENTITY as evaluation evidence (the L16a trip-wire). */
export function modelIdentityEvidenceBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    director: {
      ...TRADING_DIRECTOR_BODY.director,
      evaluationCriteriaRefs: ['acme-models/reasoner-2@2026.03' as EvaluationCriteriaRef],
    },
  };
}

/** A body spec publishing to a RESERVED kernel topic. */
export function reservedTopicBodySpec(): TradingDirectorBodySpec {
  return {
    ...TRADING_DIRECTOR_BODY,
    director: {
      ...TRADING_DIRECTOR_BODY.director,
      decisionTopic: 'kernel.approve' as TopicName,
    },
  };
}

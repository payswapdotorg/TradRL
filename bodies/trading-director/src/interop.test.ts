// @tradrl/body-trading-director — THE INTEROP TRIP WIRES.
//
// Law D-003/D-004: this package's sources import NOTHING outside their
// own lane. This test file imports the REAL packages on this branch
// (test-only, via relative source paths — the repo's established
// pattern) and proves every structural mirror has not drifted:
//
//   1. THE FOUR RESEARCH BODIES (T021/T022/T023): every REAL golden
//      fixture report passes this package's field-for-field mirror
//      guards VERBATIM; conversely, this package's mirror fixture
//      reports pass the REAL research validators under the REAL method
//      registries (derived ids included — the digest algorithms are
//      byte-identical, so the real tamper trip-wires accept them).
//   2. agent-body (T003): a REAL createBodyVersion built from this
//      spec's composition is accepted; the vocabularies match
//      kind-for-kind and in order; the real guard accepts a JSON
//      round-trip of this spec's mirror record.
//   3. skills (T017): canonical JSON + stable digests are byte-identical
//      algorithms (the program-wide law).
//   4. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; the publication envelope JSON-round-trips through
//      the REAL createMessageEnvelope.
//   5. trading-strategy (T018): the goal/constraint-set versioned
//      pointer mirrors are mutually accepted by the REAL guards — the
//      director's decisions bind the SAME refs the strategy lane binds.

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type AgentInstanceId,
  type TopicName,
  type TenantId,
  type GoalVersionRef,
  type ConstraintSetVersionRef,
  type DirectorOutcome,
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  FIDELITY_MODES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  PLANNING_STYLES_MIRROR,
  MODALITIES_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  KERNEL_TOPICS_MIRROR,
  buildDirectorDecisionPublication,
  buildDirectorEscalationPublication,
  canonicalJson,
  isCrossMarketReportMirror,
  isFundamentalReportMirror,
  isGoalVersionRef,
  isConstraintSetVersionRef,
  isMessageEnvelopeMirror,
  isRegimeReportMirror,
  isSentimentReportMirror,
  stableDigest,
  validateDirectorPublication,
  TRADING_DIRECTOR_BODY,
  composeDirectorDecision,
  DIRECTOR_METHOD_REGISTRY,
} from './index';
import {
  FIXTURE_SENTIMENT_REPORT,
  FIXTURE_REGIME_REPORT,
  FIXTURE_FUNDAMENTAL_REPORT,
  FIXTURE_CROSS_MARKET_REPORT,
  FIXTURE_REGISTRY,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  FIXTURE_SENDER,
  FIXTURE_DECISION_TOPIC,
  FIXTURE_ESCALATION_TOPIC,
  FIXTURE_QUORUM_MET_INPUT,
  FIXTURE_QUORUM_UNMET_INPUT,
  FIXTURE_GOLDEN_DECISION,
  FIXTURE_QUORUM_UNMET_ESCALATION,
} from './fixtures';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  type BodyVersionDraft,
  AGENT_ACTION_NAMES,
  EVALUATION_LAYERS,
  EXECUTION_AUTHORITY_MODES,
  FIDELITY_MODES,
  PROCEDURE_TRIGGERS,
  PLANNING_STYLES,
  MODALITIES,
  REQUIREMENT_LEVELS,
  SUBSTITUTION_TEST_RESULTS,
  createBodyVersion,
  isBodyVersion,
  isBodyComposition,
} from '../../../packages/agent-body/src/index';
import {
  canonicalJson as skillsCanonicalJson,
  stableDigest as skillsStableDigest,
} from '../../../packages/skills/src/index';
import {
  KERNEL_TOPICS,
  createMessageEnvelope,
  isMessageEnvelope,
} from '../../../packages/agent-os/src/index';
import {
  isGoalVersionRef as strategyIsGoalVersionRef,
  isConstraintSetVersionRef as strategyIsConstraintSetVersionRef,
} from '../../../packages/trading-strategy/src/index';

// --- The REAL research bodies (T021/T022/T023) -------------------------------
import {
  FIXTURE_REPORT as REAL_SENTIMENT_REPORT,
  SENTIMENT_METHOD_REGISTRY,
  validateResearchReport as validateRealSentimentReport,
} from '../../../bodies/sentiment-researcher/src/index';
import {
  FIXTURE_REPORT as REAL_REGIME_REPORT,
  REGIME_METHOD_REGISTRY,
  validateRegimeResearchReport as validateRealRegimeReport,
} from '../../../bodies/regime-researcher/src/index';
import {
  FIXTURE_REPORT as REAL_FUNDAMENTAL_REPORT,
  FUNDAMENTAL_METHOD_REGISTRY,
  validateFundamentalResearchReport as validateRealFundamentalReport,
} from '../../../bodies/fundamental-researcher/src/index';
import {
  FIXTURE_REPORT as REAL_CROSS_MARKET_REPORT,
  CROSS_MARKET_METHOD_REGISTRY,
  validateCrossMarketResearchReport as validateRealCrossMarketReport,
} from '../../../bodies/cross-market-researcher/src/index';

// ---------------------------------------------------------------------------
// 1. THE FOUR RESEARCH-BODY REPORT MIRRORS (the drift trip wires)
// ---------------------------------------------------------------------------

describe('interop: the sentiment research report mirror (T021)', () => {
  it('the REAL golden sentiment report passes this lane\'s mirror guard verbatim', () => {
    expect(isSentimentReportMirror(REAL_SENTIMENT_REPORT)).toBe(true);
    // JSON round-trips too (the mirror is portable).
    expect(isSentimentReportMirror(JSON.parse(JSON.stringify(REAL_SENTIMENT_REPORT)))).toBe(true);
  });

  it('this lane\'s mirror fixture report passes the REAL sentiment validator (derived ids included)', () => {
    const errors = validateRealSentimentReport(FIXTURE_SENTIMENT_REPORT, SENTIMENT_METHOD_REGISTRY);
    expect(errors).toEqual([]);
  });

  it('negative parity: a corrupted report fails BOTH the real validator and the mirror guard', () => {
    const broken = { ...(REAL_SENTIMENT_REPORT as unknown as Record<string, unknown>), reportId: 'not-a-rr-id' };
    expect(validateRealSentimentReport(broken, SENTIMENT_METHOD_REGISTRY).length).toBeGreaterThan(0);
    expect(isSentimentReportMirror(broken)).toBe(false);
  });
});

describe('interop: the regime research report mirror (T022)', () => {
  it('the REAL golden regime report passes this lane\'s mirror guard verbatim', () => {
    expect(isRegimeReportMirror(REAL_REGIME_REPORT)).toBe(true);
    expect(isRegimeReportMirror(JSON.parse(JSON.stringify(REAL_REGIME_REPORT)))).toBe(true);
  });

  it('this lane\'s mirror fixture report passes the REAL regime validator (derived ids included)', () => {
    const errors = validateRealRegimeReport(FIXTURE_REGIME_REPORT, REGIME_METHOD_REGISTRY);
    expect(errors).toEqual([]);
  });

  it('negative parity: a corrupted report fails BOTH the real validator and the mirror guard', () => {
    const broken = { ...(REAL_REGIME_REPORT as unknown as Record<string, unknown>), reportId: 'frr-nonsense' };
    expect(validateRealRegimeReport(broken, REGIME_METHOD_REGISTRY).length).toBeGreaterThan(0);
    expect(isRegimeReportMirror(broken)).toBe(false);
  });
});

describe('interop: the fundamental research report mirror (T023)', () => {
  it('the REAL golden fundamental report passes this lane\'s mirror guard verbatim', () => {
    expect(isFundamentalReportMirror(REAL_FUNDAMENTAL_REPORT)).toBe(true);
    expect(isFundamentalReportMirror(JSON.parse(JSON.stringify(REAL_FUNDAMENTAL_REPORT)))).toBe(true);
  });

  it('this lane\'s mirror fixture report passes the REAL fundamental validator (derived ids included)', () => {
    const errors = validateRealFundamentalReport(FIXTURE_FUNDAMENTAL_REPORT, FUNDAMENTAL_METHOD_REGISTRY);
    expect(errors).toEqual([]);
  });

  it('negative parity: a corrupted report fails BOTH the real validator and the mirror guard', () => {
    const broken = { ...(REAL_FUNDAMENTAL_REPORT as unknown as Record<string, unknown>), summary: 'not-a-summary' };
    expect(validateRealFundamentalReport(broken, FUNDAMENTAL_METHOD_REGISTRY).length).toBeGreaterThan(0);
    expect(isFundamentalReportMirror(broken)).toBe(false);
  });
});

describe('interop: the cross-market research report mirror (T023)', () => {
  it('the REAL golden cross-market report passes this lane\'s mirror guard verbatim', () => {
    expect(isCrossMarketReportMirror(REAL_CROSS_MARKET_REPORT)).toBe(true);
    expect(isCrossMarketReportMirror(JSON.parse(JSON.stringify(REAL_CROSS_MARKET_REPORT)))).toBe(true);
  });

  it('this lane\'s mirror fixture report passes the REAL cross-market validator (derived ids included)', () => {
    const errors = validateRealCrossMarketReport(FIXTURE_CROSS_MARKET_REPORT, CROSS_MARKET_METHOD_REGISTRY);
    expect(errors).toEqual([]);
  });

  it('negative parity: a corrupted report fails BOTH the real validator and the mirror guard', () => {
    const broken = { ...(REAL_CROSS_MARKET_REPORT as unknown as Record<string, unknown>), reportId: 'rr-nonsense' };
    expect(validateRealCrossMarketReport(broken, CROSS_MARKET_METHOD_REGISTRY).length).toBeGreaterThan(0);
    expect(isCrossMarketReportMirror(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. agent-body (T003) — the BodyVersion mirror
// ---------------------------------------------------------------------------

describe('interop: agent-body (the BodyVersion mirror)', () => {
  it('a REAL createBodyVersion built from this spec\'s composition is valid', () => {
    const mirror = TRADING_DIRECTOR_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('trading-director@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(TRADING_DIRECTOR_BODY.bodyVersion));
    expect(isBodyVersion(round)).toBe(true);
    expect(isBodyComposition((round as { composition: unknown }).composition)).toBe(true);
  });

  it('every mirrored vocabulary matches the real one kind-for-kind AND in order', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...AGENT_ACTION_NAMES]);
    expect([...EVALUATION_LAYERS_MIRROR]).toEqual([...EVALUATION_LAYERS]);
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual([...EXECUTION_AUTHORITY_MODES]);
    expect([...FIDELITY_MODES_MIRROR]).toEqual([...FIDELITY_MODES]);
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual([...PROCEDURE_TRIGGERS]);
    expect([...PLANNING_STYLES_MIRROR]).toEqual([...PLANNING_STYLES]);
    expect([...MODALITIES_MIRROR]).toEqual([...MODALITIES]);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual([...REQUIREMENT_LEVELS]);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual([...SUBSTITUTION_TEST_RESULTS]);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('the real execution-authority law agrees with this lane\'s L8 validation', () => {
    // Building a body version with EXECUTE allowed but executionAuthority 'none'
    // is rejected by the REAL factory — the same law this lane enforces.
    const draft = JSON.parse(JSON.stringify(TRADING_DIRECTOR_BODY.bodyVersion)) as BodyVersionDraft;
    const doctored = draft as unknown as {
      composition: { authorityBoundary: { allowedActions: string[]; executionAuthority: string } };
    };
    doctored.composition.authorityBoundary.allowedActions = [...doctored.composition.authorityBoundary.allowedActions, 'EXECUTE'];
    expect(() => createBodyVersion(doctored as unknown as BodyVersionDraft)).toThrow(/external-gateway-only/);
  });
});

// ---------------------------------------------------------------------------
// 3. skills (T017) — canonical bytes + digest parity
// ---------------------------------------------------------------------------

describe('interop: skills (canonical JSON + digests)', () => {
  it('canonicalJson and stableDigest are byte-identical algorithms', () => {
    for (const sample of [
      { b: 1, a: 'x', c: [3, 2, { z: null, y: true }] },
      FIXTURE_GOLDEN_DECISION as never,
      { nested: { deep: { deeper: ['q', 'p'] } } },
      [],
      'plain',
      42,
      null,
    ]) {
      const mine = canonicalJson(sample as never);
      const theirs = skillsCanonicalJson(sample as never);
      expect(mine).toBe(theirs);
      expect(stableDigest(mine)).toBe(skillsStableDigest(theirs));
    }
  });
});

// ---------------------------------------------------------------------------
// 4. agent-os (T006) — the envelope mirror + topic reservation
// ---------------------------------------------------------------------------

describe('interop: agent-os (the envelope mirror)', () => {
  it('the kernel topic reservation matches kind-for-kind', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([...KERNEL_TOPICS]);
  });

  it('this lane\'s decision publication envelope JSON-round-trips through the REAL factory', () => {
    const outcome: DirectorOutcome = FIXTURE_GOLDEN_DECISION;
    if (outcome.kind !== 'decision') throw new Error('the golden quorum-met outcome is a decision');
    const built = buildDirectorDecisionPublication({
      opId: 'op-interop-0001',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: outcome.decision,
      sequence: 1,
      publishedAt: outcome.decision.asOf,
    });
    if (!built.ok) throw new Error('publication must build');
    // the full publication validates under this lane's discipline
    expect(validateDirectorPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    // the envelope alone round-trips through the REAL agent-os factory
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(built.value.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(built.value.envelope.id);
    expect(real.payload).toBe(built.value.envelope.payload);
    expect(real.sequence).toBe(1);
    // the real envelope satisfies this lane's mirror guard
    expect(isMessageEnvelopeMirror(JSON.parse(JSON.stringify(real)))).toBe(true);
    // the payload is the opaque decision reference, bound to the decision id
    expect(real.payload).toBe(`decision:${outcome.decision.decisionId}`);
  });

  it('this lane\'s escalation publication envelope JSON-round-trips through the REAL factory', () => {
    const outcome: DirectorOutcome = FIXTURE_QUORUM_UNMET_ESCALATION;
    if (outcome.kind !== 'escalation') throw new Error('the golden quorum-unmet outcome is an escalation');
    const built = buildDirectorEscalationPublication({
      opId: 'op-interop-0002',
      topic: FIXTURE_ESCALATION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      escalation: outcome.escalation,
      sequence: 2,
      publishedAt: outcome.escalation.asOf,
    });
    if (!built.ok) throw new Error('escalation publication must build');
    expect(validateDirectorPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(built.value.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.payload).toBe(`escalation:${outcome.escalation.escalationId}`);
  });
});

// ---------------------------------------------------------------------------
// 5. trading-strategy (T018) — the goal/constraint-set versioned pointers
// ---------------------------------------------------------------------------

describe('interop: trading-strategy (the goal and constraint-set pointers)', () => {
  it('the goal version refs are mutually accepted (this lane mirrors the strategy lane\'s shape)', () => {
    const mine: GoalVersionRef = { goalId: 'goal/portfolio-direction', version: 1 };
    expect(strategyIsGoalVersionRef(mine)).toBe(true);
    const theirs = { goalId: 'goal/sentiment-awareness', version: 3 };
    expect(isGoalVersionRef(theirs)).toBe(true);
  });

  it('the constraint-set version refs are mutually accepted', () => {
    const mine: ConstraintSetVersionRef = { id: 'constraints/max-drawdown', version: 2 };
    expect(strategyIsConstraintSetVersionRef(mine)).toBe(true);
    const theirs = { id: 'constraints/venue-permissions', version: 7 };
    expect(isConstraintSetVersionRef(theirs)).toBe(true);
  });

  it('invalid corpora are rejected by BOTH guard sets (parity on the negative path)', () => {
    const invalidGoals = [
      { goalId: '', version: 1 },
      { goalId: 'g', version: 0 },
      { goalId: 'g', version: 1.5 },
      { goalId: 'g' },
      { version: 1 },
      null,
      42,
    ];
    for (const invalid of invalidGoals) {
      expect(isGoalVersionRef(invalid)).toBe(false);
      expect(strategyIsGoalVersionRef(invalid)).toBe(false);
    }
    const invalidConstraintSets = [
      { id: '', version: 1 },
      { id: 'c', version: 0 },
      { id: 'c' },
      { id: 'c', version: -1 },
      null,
    ];
    for (const invalid of invalidConstraintSets) {
      expect(isConstraintSetVersionRef(invalid)).toBe(false);
      expect(strategyIsConstraintSetVersionRef(invalid)).toBe(false);
    }
  });

  it('the golden decision\'s goal and constraint-set refs bind the strategy lane\'s shapes', () => {
    const outcome: DirectorOutcome = FIXTURE_GOLDEN_DECISION;
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    expect(strategyIsGoalVersionRef(outcome.decision.goal)).toBe(true);
    for (const constraintSet of outcome.decision.constraintSets) {
      expect(strategyIsConstraintSetVersionRef(constraintSet)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The full-chain trip wire: the composition over REAL-lane-compatible
// mirrors produces decisions the strategy lane can bind
// ---------------------------------------------------------------------------

describe('interop: the full chain stays honest', () => {
  it('the golden decision is byte-identical when composed twice (determinism across runs)', () => {
    const first = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    const second = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('must compose');
    expect(canonicalJson(first.value as never)).toBe(canonicalJson(second.value as never));
    expect(canonicalJson(first.value as never)).toBe(canonicalJson(FIXTURE_GOLDEN_DECISION as never));
  });

  it('the quorum-unmet outcome is an ESCALATION record (never an exception)', () => {
    expect(() => composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT)).not.toThrow();
    const outcome = composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('must compose');
    expect(outcome.value.kind).toBe('escalation');
    if (outcome.value.kind === 'escalation') {
      expect(outcome.value.escalation.reason).toBe('quorum-unmet');
    }
  });

  it('the method registry digest is stable and the composition cites it', () => {
    expect(DIRECTOR_METHOD_REGISTRY.digest).toMatch(/^[0-9a-f]{16}$/);
    const outcome: DirectorOutcome = FIXTURE_GOLDEN_DECISION;
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    expect(outcome.decision.methodId).toBe('method/director/synthesis');
    expect(outcome.decision.methodVersion).toBe('1.0.0');
  });
});

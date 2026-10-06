// tests/end-to-end-trading/interop.test.ts — THE DRIFT TRIP-WIRES (suite 2/5).
//
// Work Order T048, law D-003/D-004: the example composes REAL merged
// packages' shapes via STRUCTURAL MIRRORS and never imports them. THIS
// suite imports the REAL packages (test-only, relative source paths — the
// established interop pattern) and makes mirror drift LOUD:
//   - digest parity (byte-identical canonicalJson/stableDigest/fnv1a32Hex),
//   - vocabulary parity (kind-for-kind, in order),
//   - mutual guard acceptance (the real guards accept the mirror records),
//   - BEHAVIORAL parity: the REAL director composer and the REAL exchange
//     engine produce byte-identical/equal outcomes over the same inputs.

import { describe, expect, it } from 'vitest';
import {
  runEndToEndScenario,
  DIRECTOR_METHOD_REGISTRY,
  REFERENCE_SCENARIO,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  fnv1a32Hex,
  AGENT_ACTION_NAMES_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  FIDELITY_MODES_MIRROR,
  KERNEL_TOPICS_MIRROR,
  ORDER_STATES,
  ORDER_LIFECYCLE_EVENTS,
  ORDER_LIFECYCLE_TRANSITIONS,
  PRE_TRADE_CHECK_KINDS_MIRROR,
  LANE_COVERAGE_STATUSES,
  SYNTHESIS_DIRECTIONS,
  NO_CHANGE_REASONS,
  ESCALATION_REASONS as DIRECTOR_ESCALATION_REASONS,
  expectedChainHead,
  expectedLifecycleId,
  type OrderLifecycleRecordMirror,
} from '../../examples/end-to-end-trading/src/index';

import * as realSkills from '../../packages/skills/src/index';
import * as realAgentBody from '../../packages/agent-body/src/index';
import * as realAgentOs from '../../packages/agent-os/src/index';
import * as realDirector from '../../bodies/trading-director/src/index';
import * as realSentiment from '../../bodies/sentiment-researcher/src/index';
import * as realRegime from '../../bodies/regime-researcher/src/index';
import * as realFundamental from '../../bodies/fundamental-researcher/src/index';
import * as realCrossMarket from '../../bodies/cross-market-researcher/src/index';
import * as realStrategy from '../../packages/trading-strategy/src/index';
import * as realExecutionBody from '../../bodies/execution/src/index';
import * as realAuthority from '../../packages/execution-authority/src/index';
import * as realExchange from '../../packages/exchange-sim/src/index';

const runResult = runEndToEndScenario();
if (!runResult.ok) throw new Error(`reference slice failed: ${JSON.stringify(runResult.errors)}`);
const run = runResult.value;

describe('T048 interop trip-wires: digest parity (the L9 law)', () => {
  it('canonicalJson and stableDigest are byte-identical to @tradrl/skills on shared samples', () => {
    const samples: unknown[] = [
      { b: 2, a: 1, c: [3, { z: 'x', y: null }, true] },
      REFERENCE_SCENARIO.goal,
      { nested: { deep: { list: ['beta', 'alpha', 42, false, null] } }, n: -0.5 },
      'plain string',
      12345,
    ];
    for (const sample of samples) {
      const mine = canonicalJson(sample as never);
      const real = realSkills.canonicalJson(sample as never);
      expect(mine).toBe(real);
      expect(stableDigest(mine)).toBe(realSkills.stableDigest(real));
      expect(stableDigestJson(sample as never)).toBe(realSkills.stableDigestJson(sample as never));
    }
  });

  it('fnv1a32Hex (the chain-head fold) is byte-identical to the real execution-lane primitives', () => {
    for (const sample of ['ol-genesis', 'x' + 'y'.repeat(1000), JSON.stringify(REFERENCE_SCENARIO.budget)]) {
      expect(fnv1a32Hex(sample)).toBe(realExecutionBody.fnv1a32Hex(sample));
    }
  });
});

describe('T048 interop trip-wires: vocabulary parity (kind-for-kind, in order)', () => {
  it('the fourteen kernel action names match @tradrl/agent-body AND @tradrl/agent-os', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...realAgentBody.AGENT_ACTION_NAMES]);
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...realAgentOs.KERNEL_ACTION_NAMES]);
  });

  it('the execution authority modes match (NO model-autonomous anywhere — L8/L20)', () => {
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual([...realAgentBody.EXECUTION_AUTHORITY_MODES]);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('the evaluation layers and fidelity modes match @tradrl/agent-body', () => {
    expect([...EVALUATION_LAYERS_MIRROR]).toEqual([...realAgentBody.EVALUATION_LAYERS]);
    expect([...FIDELITY_MODES_MIRROR]).toEqual([...realAgentBody.FIDELITY_MODES]);
  });

  it('the kernel topics match @tradrl/agent-os (reserved topics are refused for PUBLISH)', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([...realAgentOs.KERNEL_TOPICS]);
  });

  it('the order state machine matches @tradrl/body-execution table-for-table', () => {
    expect([...ORDER_STATES]).toEqual([...realExecutionBody.ORDER_STATES]);
    expect([...ORDER_LIFECYCLE_EVENTS]).toEqual([...realExecutionBody.ORDER_LIFECYCLE_EVENTS]);
    expect(ORDER_LIFECYCLE_TRANSITIONS).toEqual(realExecutionBody.ORDER_LIFECYCLE_TRANSITIONS);
  });

  it('the seven pre-trade check kinds match @tradrl/execution-authority (kill_switch first)', () => {
    expect([...PRE_TRADE_CHECK_KINDS_MIRROR]).toEqual([...realAuthority.PRE_TRADE_CHECK_KINDS]);
  });

  it('the director vocabularies match @tradrl/body-trading-director', () => {
    expect([...realDirector.RESEARCH_LANES]).toEqual(['sentiment', 'regime', 'fundamental', 'cross-market']);
    expect([...SYNTHESIS_DIRECTIONS]).toEqual([...realDirector.SYNTHESIS_DIRECTIONS]);
    expect([...LANE_COVERAGE_STATUSES]).toEqual([...realDirector.LANE_COVERAGE_STATUSES]);
    expect([...NO_CHANGE_REASONS]).toEqual([...realDirector.NO_CHANGE_REASONS]);
    expect([...DIRECTOR_ESCALATION_REASONS]).toEqual([...realDirector.ESCALATION_REASONS]);
  });

  it('the director method registry digest matches the real registry (the declared-method law)', () => {
    expect(DIRECTOR_METHOD_REGISTRY.digest).toBe(realDirector.DIRECTOR_METHOD_REGISTRY.digest);
    expect(DIRECTOR_METHOD_REGISTRY.methods.map((method) => method.methodId)).toEqual(
      realDirector.DIRECTOR_METHOD_REGISTRY.methods.map((method) => method.methodId),
    );
  });
});

describe('T048 interop trip-wires: mutual guard acceptance (the mirror records are REAL-shaped)', () => {
  it('the REAL research bodies accept all four mirror reports', () => {
    expect(realSentiment.isResearchReport(run.stages.research.sentiment)).toBe(true);
    expect(realRegime.isRegimeResearchReport(run.stages.research.regime)).toBe(true);
    expect(realFundamental.isFundamentalResearchReport(run.stages.research.fundamental)).toBe(true);
    expect(realCrossMarket.isCrossMarketResearchReport(run.stages.research.crossMarket)).toBe(true);
  });

  it('the REAL trading-director intake mirrors accept all four reports', () => {
    expect(realDirector.isSentimentReportMirror(run.stages.research.sentiment)).toBe(true);
    expect(realDirector.isRegimeReportMirror(run.stages.research.regime)).toBe(true);
    expect(realDirector.isFundamentalReportMirror(run.stages.research.fundamental)).toBe(true);
    expect(realDirector.isCrossMarketReportMirror(run.stages.research.crossMarket)).toBe(true);
  });

  it('the REAL director validator accepts the mirror decision against the REAL registry', () => {
    if (run.stages.director.outcome.kind !== 'decision') throw new Error('expected a decision');
    const decision = run.stages.director.outcome.decision;
    expect(realDirector.isDirectorDecision(decision)).toBe(true);
    const validated = realDirector.validateDirectorDecisionRecord(decision, realDirector.DIRECTOR_METHOD_REGISTRY);
    expect(validated.ok).toBe(true);
  });

  it('the REAL trading-strategy guards accept the mirror intents and the genesis state', () => {
    expect(run.stages.strategy.run.intents.every((intent) => realStrategy.isStrategyIntent(intent))).toBe(true);
    expect(realStrategy.isPortfolioState(run.stages.strategy.state)).toBe(true);
  });

  it('the REAL execution body accepts every mirror lifecycle record AND the whole log validates', () => {
    for (const log of run.stages.execution.logs) {
      for (const record of log.records) {
        expect(realExecutionBody.isOrderLifecycleRecord(record)).toBe(true);
      }
      const logCheck = realExecutionBody.validateOrderLifecycleLogRecord(log);
      expect(logCheck.ok).toBe(true);
    }
  });

  it('the chain-head fold and the lifecycle id derivation are byte-identical to the real formulas', () => {
    const log = run.stages.execution.logs[0];
    const genesis = log.records[0] as OrderLifecycleRecordMirror;
    // Fold the mirror genesis exactly as the real formula would.
    const content = {
      sequence: genesis.sequence,
      decisionRef: genesis.decisionRef,
      intentRef: genesis.intentRef,
      directorDecisionRef: genesis.directorDecisionRef,
      orderRef: genesis.orderRef,
      venue: genesis.venue,
      instrument: genesis.instrument,
      side: genesis.side,
      orderKind: genesis.orderKind,
      quantity: genesis.quantity,
      from: genesis.from,
      to: genesis.to,
      event: genesis.event,
      orderClock: genesis.orderClock,
      decisionAsOf: genesis.decisionAsOf,
      fills: genesis.fills.map((fill) => ({ fillRef: fill.fillRef, quantity: fill.quantity, orderClock: fill.orderClock })),
      cancelConfirmationRef: genesis.cancelConfirmationRef,
      escalationRef: genesis.escalationRef,
      methodId: genesis.methodId,
      methodVersion: genesis.methodVersion,
      tenant: genesis.tenant,
      project: genesis.project,
    };
    const realRecord = { ...content, chainHead: genesis.chainHead, lifecycleId: genesis.lifecycleId } as unknown as realExecutionBody.OrderLifecycleRecord;
    expect(realExecutionBody.expectedChainHead(realExecutionBody.LIFECYCLE_CHAIN_SEED, content as never)).toBe(genesis.chainHead);
    expect(realExecutionBody.expectedLifecycleId(realRecord)).toBe(genesis.lifecycleId);
    expect(expectedChainHead(realExecutionBody.LIFECYCLE_CHAIN_SEED, genesis)).toBe(genesis.chainHead);
    expect(expectedLifecycleId(genesis)).toBe(genesis.lifecycleId);
  });

  it('the REAL execution-authority guard accepts the mirror approve decision; the xd: mint matches', () => {
    const approve = run.stages.riskGateway.decisions.find((decision) => decision.kind === 'approve');
    if (approve === undefined || approve.kind !== 'approve') throw new Error('expected an approval');
    expect(realAuthority.isApproveDecisionRecord(approve)).toBe(true);
    expect(realAuthority.mintApproveDecisionId(approve)).toBe(approve.decisionId); // the forgery law parity
    expect(realAuthority.approveDecisionIdMatchesContent(approve)).toBe(true);
  });
});

describe('T048 interop trip-wires: BEHAVIORAL parity (the real engines over the same inputs)', () => {
  it('the REAL director composer produces the BYTE-IDENTICAL decision (same dd- id) over the same intake', () => {
    if (run.stages.director.outcome.kind !== 'decision') throw new Error('expected a decision');
    const mine = run.stages.director.outcome.decision;
    const real = realDirector.composeDirectorDecision({
      asOf: REFERENCE_SCENARIO.instants.decisionAsOf,
      goal: { goalId: REFERENCE_SCENARIO.goal.id, version: REFERENCE_SCENARIO.goal.version },
      constraintSets: [{ id: REFERENCE_SCENARIO.constraintSet.id, version: REFERENCE_SCENARIO.constraintSet.version }],
      tenantId: REFERENCE_SCENARIO.tenant,
      projectId: REFERENCE_SCENARIO.project,
      seed: REFERENCE_SCENARIO.seeds.director,
      methodId: 'method/director/synthesis',
      registry: realDirector.DIRECTOR_METHOD_REGISTRY,
      bodyVersion: 'trading-director@1.0.0',
      intake: run.stages.research,
    } as never);
    expect(real.ok).toBe(true);
    if (!real.ok || real.value.kind !== 'decision') return;
    expect(real.value.decision.decisionId).toBe(mine.decisionId); // byte-identical derived identity
    expect(canonicalJson(real.value.decision as never)).toBe(canonicalJson(mine as never));
  });

  it('the REAL exchange engine fills the mirror order identically (price, quantity, fees)', () => {
    const btcBinding = REFERENCE_SCENARIO.engineBindings.find((binding) => binding.instrumentId === 'BTC-USD');
    if (btcBinding === undefined) throw new Error('missing BTC binding');
    const created = realExchange.createEngine(REFERENCE_SCENARIO.exchangeConfig, {
      book_seed: btcBinding.bookSeed,
      start_at: REFERENCE_SCENARIO.instants.t0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const btcIntent = run.stages.strategy.run.intents.find((intent) => intent.order.instrumentId === 'BTC-USD');
    if (btcIntent === undefined) throw new Error('missing BTC intent');
    const submitted = realExchange.submitOrder(created.value, btcIntent.order, REFERENCE_SCENARIO.instants.orderClockBase + 110);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const realFill = submitted.value.fills[0];
    const myFill = run.stages.execution.engineFills.find((fill) => fill.instrument === 'BTC-USD');
    expect(realFill).toBeDefined();
    expect(myFill).toBeDefined();
    if (realFill === undefined || myFill === undefined) return;
    expect(realFill.price).toBe(myFill.price.replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m))); // exact value, rendering-insensitive
    expect(Number(realFill.quantity)).toBe(Number(myFill.quantity));
    expect(realFill.taker_fee).toBe(myFill.taker_fee); // fee law parity (half-up at fee_decimals)
    expect(realFill.aggressor_price).toBe(myFill.aggressor_price.replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m)));
    expect(realFill.maker_order_id.startsWith('xo-seed-ask-')).toBe(true);
    expect(myFill.maker_order_id.startsWith('xo-seed-ask-')).toBe(true);
  });

  it('a REAL createBodyVersion round-trips a mirror body composition (the body-forge mirror law)', () => {
    const directorBody = run.stages.bodies.bodies.find((body) => body.bodyId === 'trading-director');
    if (directorBody === undefined) throw new Error('missing director body');
    const draft = JSON.parse(JSON.stringify(directorBody)) as realAgentBody.BodyVersionDraft;
    const real = realAgentBody.createBodyVersion(draft);
    expect(real.id).toBe(directorBody.id);
    expect(realAgentBody.isBodyVersion(real)).toBe(true);
    expect(real.certified).toBe(false);
    // The L8 invariant enforced by the REAL factory: EXECUTE requires external-gateway-only.
    expect(() =>
      realAgentBody.createBodyVersion({
        ...draft,
        id: 'rogue@1.0.0',
        bodyId: 'rogue',
        composition: {
          ...draft.composition,
          authorityBoundary: {
            ...draft.composition.authorityBoundary,
            allowedActions: [...draft.composition.authorityBoundary.allowedActions, 'EXECUTE' as const],
            executionAuthority: 'none',
          },
        },
      } as never),
    ).toThrow();
  });
});

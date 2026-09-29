/**
 * Behavioral tests for the reference strategy service: the golden
 * determinism law (byte-identical results, twice), the documented
 * scenario shapes (drift-band rebalancing, cash caps, corporate
 * actions), the constraint gate's refusing path, the chain-verified
 * transition log, the append-only backtest record, and the resumable
 * run-state serialization (serialize -> parse -> resume).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  isStrategyIntent,
  isStrategyRun,
  validateStrategyRun,
  validateStrategySpec,
  verifyTransitionChain,
  type PortfolioState,
  type StrategyRun,
} from '../../../packages/trading-strategy/src/index';
import {
  driveStrategyScenario,
  GOLDEN_INTENT_COUNT,
  GOLDEN_REFUSAL_COUNT,
  GOLDEN_REFUSING_DIGEST,
  GOLDEN_SCENARIO_DIGEST,
  referenceAttainmentBindings,
  referenceRefusingScenario,
  referenceScenario,
  REFERENCE_CONSTRAINT_SET,
  REFERENCE_GOAL,
  REFERENCE_STRATEGY_SPEC,
  resumeStrategyRunState,
  runStateDigest,
  serializeStrategyRunState,
  type ScenarioResult,
} from './index';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function drive(): ScenarioResult {
  const result = driveStrategyScenario(referenceScenario());
  if (result.ok) return result.value;
  throw new Error(`scenario failed: ${JSON.stringify(result.errors)}`);
}

function driveRefusing(): ScenarioResult {
  const result = driveStrategyScenario(referenceRefusingScenario());
  if (result.ok) return result.value;
  throw new Error(`refusing scenario failed: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Golden determinism (acceptance 3)
// ---------------------------------------------------------------------------

describe('the reference scenario — golden determinism', () => {
  it('the same scenario yields a byte-identical result, twice (deep-equal runs, log, states, backtest)', () => {
    const first = drive();
    const second = drive();
    expect(canonicalJson(first as never)).toBe(canonicalJson(second as never));
    expect(first.runs).toStrictEqual(second.runs);
    expect(first.log).toStrictEqual(second.log);
    expect(first.finalState).toStrictEqual(second.finalState);
    expect(first.backtest).toStrictEqual(second.backtest);
    expect(digest(canonicalJson(first as never))).toBe(GOLDEN_SCENARIO_DIGEST);
  });

  it('the documented shape: 6 intents across 3 runs, 0 refusals, exact-decimal quantities', () => {
    const result = drive();
    const intents = result.runs.flatMap((run) => run.intents);
    expect(intents).toHaveLength(GOLDEN_INTENT_COUNT);
    expect(result.runs.every((run) => run.refusals.length === 0)).toBe(true);

    // Run 1 — the initial allocation (SOL cash-capped at 99.9: target
    // weight 1/3 at precision 8 is 9999.9999 of value).
    const run1 = result.runs[0] as StrategyRun;
    expect(run1.intents.map((intent) => `${intent.order.side} ${intent.order.instrumentId} ${intent.order.quantity} @ ${String(intent.order.price)}`)).toEqual([
      'buy BTC-USD 0.2 @ 50000',
      'buy ETH-USD 3.33 @ 3000',
      'buy SOL-USD 99.9 @ 100',
    ]);
    expect(run1.intents.every((intent) => intent.rationale.kind === 'initial_allocation')).toBe(true);

    // Run 2 — the drift rebalance: BTC over band -> SELL; SOL under band
    // -> cash-capped BUY; ETH's buy lot-floored to zero (skipped).
    const run2 = result.runs[1] as StrategyRun;
    expect(run2.intents.map((intent) => `${intent.order.side} ${intent.order.instrumentId} ${intent.order.quantity} @ ${String(intent.order.price)}`)).toEqual([
      'sell BTC-USD 0.059 @ 90000',
      'buy SOL-USD 0.1 @ 100',
    ]);
    expect(run2.intents.every((intent) => intent.rationale.kind === 'rebalance_drift')).toBe(true);
    const btcSell = run2.intents[0];
    expect(btcSell?.rationale.currentWeight).toBe('0.47368421');
    expect(btcSell?.rationale.drift).toBe('0.14035088');

    // Run 3 — the settling step: only BTC outside its band.
    const run3 = result.runs[2] as StrategyRun;
    expect(run3.intents.map((intent) => `${intent.order.side} ${intent.order.instrumentId} ${intent.order.quantity} @ ${String(intent.order.price)}`)).toEqual([
      'buy BTC-USD 0.07 @ 52000',
    ]);
  });

  it('the final book is exact-decimal: positions, cash, realized and unrealized', () => {
    const result = drive();
    const state: PortfolioState = result.finalState;
    expect(state.positions.map((position) => `${position.instrumentId}:${position.quantity}@${position.costBasis}`)).toEqual([
      'BTC-USD:0.211@10690', // 0.2 - 0.059 sell, basis 10000 - 2950 + 3640
      'ETH-USD:3.33@9990',
      'SOL-USD:200.2@10010', // 100 - 100 + 0.1 buy, then the 2:1 split
    ]);
    expect(state.cash).toBe('1675'); // 10 + 5 (dividend) + 5310 (sell) - 10 (SOL buy) - 3640 (BTC buy)
    expect(state.realizedPnl).toBe('2360'); // 0.059 * 90000 - 2950 cost share, exact
    expect(state.unrealizedPnl).toBe('10959');
  });

  it('every emitted run and intent passes the contract validators', () => {
    const result = drive();
    for (const run of result.runs) {
      expect(isStrategyRun(run)).toBe(true);
      expect(validateStrategyRun(run).ok).toBe(true);
      for (const intent of run.intents) expect(isStrategyIntent(intent)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The refusing path (constraint primacy in the service)
// ---------------------------------------------------------------------------

describe('the refusing scenario — the constraint gate refuses everything', () => {
  it('every candidate at every step is a refusal RECORD naming the violated predicate', () => {
    const result = driveRefusing();
    const refusals = result.runs.flatMap((run) => run.refusals);
    expect(refusals).toHaveLength(GOLDEN_REFUSAL_COUNT);
    expect(result.runs.every((run) => run.intents.length === 0)).toBe(true);
    for (const refusal of refusals) {
      expect(refusal.cause).toBe('constraint_refused');
      expect(refusal.violated.map((violated) => violated.constraintId)).toEqual(['universe-ceiling']);
      expect(refusal.violated[0]?.subject).toBe('state.universe');
      expect(refusal.violated[0]?.observed).toBe(3);
      expect(refusal.tenant).toBe('tenant-reference');
      expect(refusal.project).toBe('project-reference');
    }
    // Byte-identical twice, digest pinned.
    expect(digest(canonicalJson(driveRefusing() as never))).toBe(GOLDEN_REFUSING_DIGEST);
  });

  it('the refused strategy never trades: the portfolio stays at its genesis shape', () => {
    const result = driveRefusing();
    expect(result.finalState.positions).toHaveLength(0);
    expect(result.finalState.cash).toBe('30000');
    // No fills were declared and none could have occurred: the final
    // state's ECONOMIC content equals the genesis (only asOf advanced).
    expect(result.finalState.cash).toBe(result.genesis.cash);
    expect(result.finalState.realizedPnl).toBe('0');
    expect(result.finalState.unrealizedPnl).toBe('0');
    // Every backtest candidate is a RETAINED rejection with the structured reason.
    expect(result.backtest.candidates.every((candidate) => candidate.disposition === 'rejected')).toBe(true);
    expect(result.backtest.candidates.every((candidate) => candidate.reason.kind === 'constraint_refused')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The transition log + the backtest record
// ---------------------------------------------------------------------------

describe('the scenario audit trail', () => {
  it('the transition log chains every step and verifies (L9)', () => {
    const result = drive();
    expect(result.log.transitions).toHaveLength(3);
    expect(result.log.transitions.map((transition) => transition.sequence)).toEqual([1, 2, 3]);
    expect(result.log.currentState).toBe(result.finalState.stateId);
    expect(verifyTransitionChain(result.log).ok).toBe(true);
  });

  it('the backtest record retains every candidate with evidence-bound attainment (L11/L7)', () => {
    const result = drive();
    expect(result.backtest.candidates.map((candidate) => `${candidate.sequence}:${candidate.disposition}`)).toEqual([
      '1:retained',
      '2:retained',
      '3:retained',
    ]);
    // The bindings mirror the evaluation lane's shape and carry opaque evidence refs — never scores.
    for (const candidate of result.backtest.candidates) {
      expect(candidate.attainment.length).toBe(REFERENCE_GOAL.successCriteria.criteria.length);
      for (const binding of candidate.attainment) {
        expect(binding.evidenceRef.startsWith('eval-evidence:reference/')).toBe(true);
        expect(binding.gatingConstraintIds.length).toBeGreaterThan(0);
      }
    }
    // The gating-rule mirror: the concentration criterion is gated by
    // nothing in the reference set (its metric family differs), so the
    // harness binds the whole set (documented fallback).
    const bindings = referenceAttainmentBindings(REFERENCE_GOAL, REFERENCE_CONSTRAINT_SET);
    expect(bindings.map((binding) => binding.criterionId)).toEqual(['drawdown', 'concentration']);
  });
});

// ---------------------------------------------------------------------------
// The resumable run state (serialize -> parse -> resume)
// ---------------------------------------------------------------------------

describe('the run-state serialization', () => {
  function runStateOf(result: ScenarioResult) {
    return {
      spec: REFERENCE_STRATEGY_SPEC,
      goal: REFERENCE_GOAL,
      constraintSet: REFERENCE_CONSTRAINT_SET,
      seed: 'reference-seed-1' as never,
      genesis: result.genesis,
      runs: result.runs,
      log: result.log,
    };
  }

  it('serialize -> parse -> resume yields the deeply-equal state, chain-verified', () => {
    const result = drive();
    const state = runStateOf(result);
    const serialized = serializeStrategyRunState(state);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error('unreachable');
    const bytes = serialized.value;

    // Deterministic: same state, same bytes — twice.
    const again = serializeStrategyRunState(state);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value).toBe(bytes);
    expect(runStateDigest(bytes)).toBe(runStateDigest(bytes));

    const resumed = resumeStrategyRunState(bytes);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(JSON.stringify(resumed.errors));
    expect(canonicalJson(resumed.value as never)).toBe(canonicalJson(state as never));
    // The resumed state is chain-verified (the resume gate ran).
    expect(verifyTransitionChain(resumed.value.log).ok).toBe(true);
    // And the run-state digest is byte-stable across a resume round trip.
    const reserialized = serializeStrategyRunState(resumed.value);
    expect(reserialized.ok).toBe(true);
    if (reserialized.ok) expect(reserialized.value).toBe(bytes);
  });

  it('tampered bytes fail the resume gate with the typed chain_mismatch', () => {
    const result = drive();
    const state = runStateOf(result);
    const serialized = serializeStrategyRunState(state);
    if (!serialized.ok) throw new Error('unreachable');

    // Tamper: swap a fill price inside the recorded history, re-serialize
    // with the same envelope (the attack a partial replay would mount).
    const parsed: { schema: string; state: { log: { transitions: { fills: { price: string }[] }[] } } } = JSON.parse(serialized.value);
    parsed.state.log.transitions[0]!.fills[0]!.price = '1';
    const tamperedBytes = canonicalJson(parsed as never);
    const resumed = resumeStrategyRunState(tamperedBytes);
    expect(resumed.ok).toBe(false);
    if (!resumed.ok) {
      expect(resumed.errors[0]?.code === 'chain_mismatch' || resumed.errors[0]?.code === 'invalid_serialization').toBe(true);
    }
  });

  it('unparseable bytes and a wrong schema marker fail with typed errors', () => {
    expect(resumeStrategyRunState('not json').ok).toBe(false);
    const wrongSchema = resumeStrategyRunState('{"schema":"tradrl/other@1","state":{}}');
    expect(wrongSchema.ok).toBe(false);
    if (!wrongSchema.ok) expect(wrongSchema.errors[0]?.code).toBe('invalid_serialization');
  });
});

// ---------------------------------------------------------------------------
// The L8 discipline (the reference records carry no authority)
// ---------------------------------------------------------------------------

describe('the reference declarations honor L8', () => {
  it('the reference spec/intents/refusals embed no execution authority', () => {
    const result = drive();
    const refusing = driveRefusing();
    // The authority scan over the WHOLE results is empty (the guards
    // already enforce it; this is the belt-and-braces service check).
    expect(JSON.stringify(result).includes('credential')).toBe(false);
    expect(JSON.stringify(result).includes('venuePermission')).toBe(false);
    expect(JSON.stringify(refusing).includes('apiKey')).toBe(false);
    // The reference spec validates (which includes the L8 scan).
    expect(validateStrategySpec(REFERENCE_STRATEGY_SPEC).ok).toBe(true);
  });
});

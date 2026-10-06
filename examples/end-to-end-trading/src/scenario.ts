// @tradrl/example-e2e-trading — THE SCENARIO.
//
// The single input of the whole slice (R44 reference environment): the
// user goal + constraints + budgets, the market universe, the recorded
// event history with its availability quartets, the venue physics, the
// control-plane declarations (policies, grants, routing) and the decision
// schedule. EVERYTHING the run produces is a pure function of this record:
// identical scenario bytes -> identical run bytes (the determinism test
// pins this). No ambient clock, no ambient randomness — the seed and the
// declared instants are the only entropy.

import { deepFreeze, isRecord, isNonEmptyString, isFiniteNumber, isTimestampMs, canonicalJson, fnv1a32Hex } from './primitives';
import { isUnsignedDecimal } from './decimals';
import { fail, ok, type ExampleResult } from './errors';
import type {
  GoalStatementMirror,
  ConstraintSetStatementMirror,
} from './mirrors/control';
import type { MarketEventMirror, ExchangePhysicsMirror, BookSnapshotSeedMirror } from './mirrors/market';
import type { CompileBudgetsMirror } from './mirrors/agent';

/** The papers the strategy lane gates with. */
export interface ScenarioPolicyDeclarations {
  readonly execution: {
    readonly principal: string;
    readonly grantScopeRef: string;
    readonly orderKinds: readonly string[];
    /** The POLICY's venue rate budget (T019 stage 4 rate_limits). */
    readonly rateBudget: { readonly windowMs: number; readonly maxOrders: number };
    /** The AUTHORITY GRANT's venue rate budget (T040 stage 9 rate_budget — often tighter). */
    readonly grantRateBudget: { readonly windowMs: number; readonly maxOrders: number };
    readonly credentialRef: string;
    readonly adapterRef: string;
    readonly channelRef: string;
  };
}

/** One strategic decision instant + its research window bounds. */
export interface DecisionSlotMirror {
  /** Offset from the scenario epoch (ms) — the injected strategic instant. */
  readonly atOffsetMs: number;
  /** The observation window span [atOffsetMs - lookbackMs, atOffsetMs). */
  readonly lookbackMs: number;
}

/** The scenario — the whole pipeline's single deterministic input. */
export interface TradingScenario {
  readonly schema: 'tradrl/example-e2e-trading-scenario@1';
  readonly scenarioId: string;
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
  /** The scenario epoch — every instant is epoch + declared offset. */
  readonly epochMs: number;
  readonly goal: GoalStatementMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly budgets: CompileBudgetsMirror;
  readonly universe: readonly {
    readonly venue: string;
    readonly instrument: string;
    readonly assetClass: string;
    readonly lotSize: string;
    readonly tickSize: string;
  }[];
  readonly marketEvents: readonly MarketEventMirror[];
  readonly bookSeeds: readonly { readonly venue: string; readonly instrument: string; readonly seed: BookSnapshotSeedMirror }[];
  readonly physics: { readonly venue: string; readonly instrument: string; readonly physics: ExchangePhysicsMirror }[];
  readonly policies: ScenarioPolicyDeclarations;
  readonly initialCash: string;
  readonly decisions: readonly DecisionSlotMirror[];
}

/** Structural validation (typed errors; collect-all over the load-bearing fields). */
export function validateTradingScenario(v: unknown): ExampleResult<TradingScenario> {
  if (!isRecord(v)) return fail('invalid_type', 'scenario must be an object', 'scenario');
  const s = v as unknown as TradingScenario;
  const problems: string[] = [];
  if (s.schema !== 'tradrl/example-e2e-trading-scenario@1') problems.push('schema: unexpected scenario schema');
  if (!isNonEmptyString(s.scenarioId)) problems.push('scenarioId: required');
  if (!isNonEmptyString(s.tenant)) problems.push('tenant: required (L12)');
  if (!isNonEmptyString(s.project)) problems.push('project: required (L12)');
  if (!isNonEmptyString(s.seed)) problems.push('seed: required (the determinism law)');
  if (!isTimestampMs(s.epochMs)) problems.push('epochMs: must be an injected epoch-millisecond instant');
  if (!isNonEmptyString(s.initialCash) || !isUnsignedDecimal(s.initialCash)) problems.push('initialCash: must be an unsigned decimal string');
  if (!Array.isArray(s.universe) || s.universe.length === 0) problems.push('universe: non-empty required');
  else {
    for (const entry of s.universe) {
      if (!isNonEmptyString(entry.venue) || !isNonEmptyString(entry.instrument)) problems.push('universe: venue/instrument required');
      if (!isUnsignedDecimal(entry.lotSize) || !isUnsignedDecimal(entry.tickSize)) problems.push(`universe[${entry.instrument}]: lotSize/tickSize must be decimal strings`);
    }
  }
  if (!Array.isArray(s.marketEvents) || s.marketEvents.length === 0) problems.push('marketEvents: non-empty required (the world needs a recorded history)');
  if (!Array.isArray(s.decisions) || s.decisions.length === 0) problems.push('decisions: at least one decision slot required');
  else {
    for (const slot of s.decisions) {
      if (!isFiniteNumber(slot.atOffsetMs) || !Number.isInteger(slot.atOffsetMs) || slot.atOffsetMs <= 0) problems.push('decisions: atOffsetMs must be a positive integer offset');
      if (!isFiniteNumber(slot.lookbackMs) || !Number.isInteger(slot.lookbackMs) || slot.lookbackMs <= 0) problems.push('decisions: lookbackMs must be a positive integer');
    }
  }
  if (problems.length > 0) return fail('scenario_invalid', problems.join('; '), 'scenario');
  return ok(deepFreeze(s));
}

/** Canonical serialization — the byte-stable form (determinism anchor). */
export function serializeScenario(scenario: TradingScenario): string {
  return canonicalJson(scenario as unknown as Parameters<typeof canonicalJson>[0]);
}

/** Canonical re-load (round-trip through the canonical form). */
export function parseScenario(bytes: string): ExampleResult<TradingScenario> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    return fail('invalid_json', `scenario bytes are not JSON: ${(error as Error).message}`, 'scenario');
  }
  return validateTradingScenario(parsed);
}

/** The scenario digest — the run's reproducibility checksum. */
export function scenarioDigest(scenario: TradingScenario): string {
  return fnv1a32Hex(serializeScenario(scenario));
}

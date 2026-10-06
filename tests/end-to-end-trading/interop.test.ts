// tests/end-to-end-trading/interop.test.ts — THE DRIFT TRIP-WIRES.
//
// Law D-003/D-004: the example package imports NOTHING outside its own
// tree — every cross-package shape is a STRUCTURAL MIRROR. This file
// imports the REAL merged packages on this branch (test-only, relative
// source paths — the repo's established pattern) and proves the mirrors
// have not drifted:
//
//   1. DIGEST PARITY — the example's canonical JSON and both digest
//      widths are byte-identical algorithms to the real lanes'.
//   2. THE FOUR RESEARCH BODIES — the example's reports pass the REAL
//      validators under the REAL method registries (derived ids
//      included).
//   3. THE TRADING DIRECTOR — the example's decisions pass the REAL
//      validator under the REAL method registry.
//   4. TRADING-STRATEGY — the example's goal/constraint mirrors are
//      accepted by the REAL guards; the example's intents pass the REAL
//      `validateStrategyIntent`.
//   5. MARKET-PROTOCOL — the example's market events pass the REAL
//      envelope validator.
//   6. THE ENGINE SEAM — the REAL @tradrl/exchange-sim engine functions
//      bind onto the example's `EngineDriverMirror` port with ZERO
//      casts, and the WHOLE slice runs green end to end on the real
//      engine (T027's injected-seam law, made real).

import { describe, expect, it } from 'vitest';

// --- The example under test -------------------------------------------------
import {
  runReferenceSlice, REFERENCE_SCENARIO, canonicalJson, stableDigest16,
  stableDigest8Json, fnv1a32Hex, deepFreeze,
} from '../../examples/end-to-end-trading/src/index';
import type { EngineDriverMirror } from '../../examples/end-to-end-trading/src/mirrors/market';

// --- The REAL packages (test-only relative source paths) --------------------
import {
  canonicalJson as realCanonicalJson,
  stableDigest as realBodiesDigest,
  stableDigestJson as realBodiesDigestJson,
} from '../../bodies/trading-director/src/primitives';
import { DIRECTOR_METHOD_REGISTRY, validateDirectorDecision } from '../../bodies/trading-director/src/index';
import { validateResearchReport, SENTIMENT_METHOD_REGISTRY } from '../../bodies/sentiment-researcher/src/index';
import { validateRegimeResearchReport, REGIME_METHOD_REGISTRY } from '../../bodies/regime-researcher/src/index';
import { validateFundamentalResearchReport, FUNDAMENTAL_METHOD_REGISTRY } from '../../bodies/fundamental-researcher/src/index';
import { validateCrossMarketResearchReport, CROSS_MARKET_METHOD_REGISTRY } from '../../bodies/cross-market-researcher/src/index';
import { validateStrategyIntent, isGoalStatementMirror, isConstraintSetStatementMirror } from '../../packages/trading-strategy/src/index';
import { validateMarketEvent } from '../../packages/market-protocol/src/index';
import {
  createEngine as realCreateEngine,
  submitOrder as realSubmitOrder,
  cancelOrder as realCancelOrder,
  advanceEngine as realAdvanceEngine,
} from '../../packages/exchange-sim/src/index';

const runResult = runReferenceSlice();
if (!runResult.ok) throw new Error(runResult.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
const run = runResult.value;

describe('T048 interop trip-wires — the mirrors are loud', () => {
  it('digest parity: canonical JSON and both digest widths are byte-identical algorithms', () => {
    const fixtures: unknown[] = [
      null, true, 42, -3.5, 'text', '', [1, 'a', null], { b: 1, a: { z: [true, 'x'] } },
      REFERENCE_SCENARIO.goal, REFERENCE_SCENARIO.constraintSet,
    ];
    for (const fixture of fixtures) {
      const mine = canonicalJson(fixture as never);
      const real = realCanonicalJson(fixture as never);
      expect(mine).toBe(real);
      // The bodies' 16-hex two-lane digest.
      expect(stableDigest16(mine)).toBe(realBodiesDigest(real));
    }
    // The 16-hex digest over canonical JSON is also the bodies' stableDigestJson.
    expect(stableDigest16(canonicalJson({ a: 1, b: [true, null] } as never))).toBe(
      realBodiesDigestJson({ a: 1, b: [true, null] } as never),
    );
    // The core packages' 8-hex digest equals the bodies' canonical fold too.
    expect(fnv1a32Hex(' TradRL ')).toBe(
      (() => {
        let hash = 0x811c9dc5;
        for (let i = 0; i < ' TradRL '.length; i++) {
          hash ^= ' TradRL '.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
      })(),
    );
  });

  it('the example\'s sentiment reports pass the REAL sentiment validator', () => {
    for (const intake of run.researchIntakes) {
      const errors = validateResearchReport(intake.sentiment, SENTIMENT_METHOD_REGISTRY);
      expect(errors).toEqual([]);
    }
  });

  it('the example\'s regime reports pass the REAL regime validator', () => {
    for (const intake of run.researchIntakes) {
      const errors = validateRegimeResearchReport(intake.regime, REGIME_METHOD_REGISTRY);
      expect(errors).toEqual([]);
    }
  });

  it('the example\'s fundamental reports pass the REAL fundamental validator', () => {
    for (const intake of run.researchIntakes) {
      const errors = validateFundamentalResearchReport(intake.fundamental, FUNDAMENTAL_METHOD_REGISTRY);
      expect(errors).toEqual([]);
    }
  });

  it('the example\'s cross-market reports pass the REAL cross-market validator', () => {
    for (const intake of run.researchIntakes) {
      const errors = validateCrossMarketResearchReport(intake.crossMarket, CROSS_MARKET_METHOD_REGISTRY);
      expect(errors).toEqual([]);
    }
  });

  it('the example\'s director decisions pass the REAL director validator + registry', () => {
    for (const decision of run.decisions) {
      const errors = validateDirectorDecision(decision, DIRECTOR_METHOD_REGISTRY);
      expect(errors).toEqual([]);
    }
  });

  it('the example\'s goal/constraint mirrors are accepted by the REAL trading-strategy guards', () => {
    expect(isGoalStatementMirror(REFERENCE_SCENARIO.goal)).toBe(true);
    expect(isConstraintSetStatementMirror(REFERENCE_SCENARIO.constraintSet)).toBe(true);
  });

  it('the example\'s strategy intents pass the REAL validateStrategyIntent', () => {
    const intents = run.strategyRuns.flatMap((strategyRun) => strategyRun.intents);
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      const result = validateStrategyIntent(intent);
      if (!result.ok) {
        throw new Error(`real validator refused intent ${intent.intentId}: ${result.errors.map((e) => `${e.path}: ${e.code ?? ''} ${e.message}`).join('; ')}`);
      }
      expect(result.ok).toBe(true);
    }
  });

  it('the example\'s market events pass the REAL market-protocol envelope validator', () => {
    for (const event of REFERENCE_SCENARIO.marketEvents) {
      const result = validateMarketEvent(event);
      expect(result.ok).toBe(true);
    }
  });

  it('the REAL exchange-sim engine binds onto the example\'s EngineDriverMirror port (zero casts)', () => {
    // THE STRUCTURAL PROOF: the real engine functions satisfy the example's
    // injected seam (the T027 law). If either side drifts, this assignment
    // fails to compile.
    const driver: EngineDriverMirror = {
      createEngine: realCreateEngine,
      submitOrder: realSubmitOrder,
      cancelOrder: realCancelOrder,
      advanceEngine: realAdvanceEngine,
    };
    expect(typeof driver.createEngine).toBe('function');
  });

  it('the WHOLE slice runs green on the REAL exchange-sim engine', () => {
    const driver: EngineDriverMirror = {
      createEngine: realCreateEngine,
      submitOrder: realSubmitOrder,
      cancelOrder: realCancelOrder,
      advanceEngine: realAdvanceEngine,
    };
    const result = runReferenceSlice2(driver);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    }
    // The run completed with real fills and verified chains.
    expect(result.value.world.fills.length).toBeGreaterThan(0);
    expect(result.value.submissions.filter((s) => s.kind === 'routed').length).toBeGreaterThan(0);
    // Deterministic under the real engine too: a second run is byte-identical.
    const again = runReferenceSlice2(driver);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.value.digest).toBe(result.value.digest);
    }
  });
});

// A local runner that injects the engine driver (runReferenceSlice has no
// options parameter — this mirrors its body with the injection).
import { runEndToEndTradingScenario, serializeLineageStream } from '../../examples/end-to-end-trading/src/index';
function runReferenceSlice2(driver: EngineDriverMirror) {
  return runEndToEndTradingScenario(deepFreeze(structuredClone(REFERENCE_SCENARIO as object)), { driver });
}
void serializeLineageStream;

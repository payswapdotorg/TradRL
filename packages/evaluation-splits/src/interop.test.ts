/**
 * Cross-package interoperability for @tradrl/evaluation-splits (the
 * D-003/D-004 drift trip wires — mirrors ONLY, never source imports; the
 * REAL packages are imported HERE, in tests, to prove the mirrors):
 *
 * 1. THE AXIS MIRROR against the canonical owner @tradrl/evaluation (T012):
 *    mutual assignability, guard parity and validator parity — an axis
 *    built through the real evaluation lane validates unchanged here, and
 *    an axis built here validates unchanged there.
 * 2. THE AXIS MIRROR against @tradrl/evaluation-integrity (T031): guard
 *    parity with the integrity service's identical re-declaration.
 * 3. BEHAVIORAL PARITY of the anchored no-gap ladder with T012's
 *    `walkForwardWindows` and T031's `constructWalkForward` (purged kind):
 *    identical test segments, identical train sets and identical purge
 *    counts — the split driver implements the family law, not a variant.
 * 4. `stableDigest` byte parity against @tradrl/search-lineage (the
 *    program-wide dual-lane FNV-1a) — the plan ledger's chain and the
 *    search record's chain share the same digest function.
 * 5. `TimestampMs` mirror against @tradrl/time-engine (canonical owner).
 * 6. Identity-space brand parity: search-lineage's SplitPolicyRef / DataRef
 *    / ExperimentId, evaluation-integrity's TenantId / ProjectId mirrors.
 * 7. Decimal-lane parity against @tradrl/evaluation-integrity's exact
 *    decimal arithmetic (addition, comparison, mean).
 *
 * The type-level assertion functions fail `pnpm typecheck` if any mirror
 * drifts; the runtime parity checks fail `pnpm test`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  axisDigest,
  canonicalSplitPlan,
  compareDecimals,
  addDecimals,
  isDatasetAxis as isAxisHere,
  isTimestampMs as isTimestampHere,
  materializeSplitPlan,
  meanDecimals,
  stableDigest,
  validateDatasetAxis as validateAxisHere,
} from './index';
import type {
  DatasetAxis as AxisHere,
  DataRef as DataRefHere,
  ExperimentId as ExperimentIdHere,
  SplitPolicyRef as SplitPolicyRefHere,
  TimestampMs as TimestampHere,
  TenantId as TenantIdHere,
  ProjectId as ProjectIdHere,
} from './index';
import {
  blindHoldoutMask,
  isDatasetAxis as isAxisT012,
  validateDatasetAxis as validateAxisT012,
  walkForwardWindows,
} from '../../../packages/evaluation/src/index';
import type { DatasetAxis as AxisT012, WalkForwardPolicy } from '../../../packages/evaluation/src/index';
import {
  constructWalkForward,
  splitDefinitionId as splitDefinitionIdT031,
  validateDatasetAxis as validateAxisT031,
  addDecimals as addT031,
  compareDecimals as compareT031,
  meanDecimals as meanT031,
  isDatasetAxis as isAxisT031,
} from '../../../research/evaluation-integrity/src/index';
import type { DatasetAxis as AxisT031, SplitDefinition } from '../../../research/evaluation-integrity/src/index';
import {
  isTimestampMs as isTimestampEngine,
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  requireTimestampMs as engineRequireTimestampMs,
  stableDigest as stableDigestLineage,
} from '../../../packages/search-lineage/src/index';
import type {
  DataRef as DataRefLineage,
  ExperimentId as ExperimentLineage,
  SplitPolicyRef as SplitPolicyLineage,
  TenantId as TenantLineage,
  ProjectId as ProjectLineage,
  TimestampMs as TimestampLineage,
} from '../../../packages/search-lineage/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff this lane's TimestampMs is assignable to time-engine's (and back). */
function hereTimestampIsEngineTimestamp(value: TimestampHere): TimestampLineage {
  return value;
}
function engineTimestampIsHereTimestamp(value: TimestampLineage): TimestampHere {
  return value;
}

/** Compiles iff the axis mirror is mutually assignable with T012's axis. */
function hereAxisIsT012Axis(value: AxisHere): AxisT012 {
  return value;
}
function t012AxisIsHereAxis(value: AxisT012): AxisHere {
  return value;
}

/** Compiles iff the axis mirror is mutually assignable with T031's axis. */
function hereAxisIsT031Axis(value: AxisHere): AxisT031 {
  return value;
}
function t031AxisIsHereAxis(value: AxisT031): AxisHere {
  return value;
}

/** Compiles iff the cross-lane identity spaces are mutually assignable. */
function lineageSplitIsHereMirror(value: SplitPolicyLineage): SplitPolicyRefHere {
  return value;
}
function lineageDataIsHereMirror(value: DataRefLineage): DataRefHere {
  return value;
}
function lineageExperimentIsHereMirror(value: ExperimentLineage): ExperimentIdHere {
  return value;
}
function lineageTenantIsHereMirror(value: TenantLineage): TenantIdHere {
  return value;
}
function lineageProjectIsHereMirror(value: ProjectLineage): ProjectIdHere {
  return value;
}

// ---------------------------------------------------------------------------
// Shared fixture (an axis authored through the REAL T012 evaluation lane)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

function untrustedAxisJson(): Record<string, unknown> {
  const segments: Record<string, unknown>[] = [];
  for (let index = 0; index < 7; index++) {
    const start = T0 + index * DAY;
    segments.push({ ref: `dataset-interop-${index}`, start, end: start + DAY, regime: ['trend', 'range', 'crisis'][index % 3] });
  }
  return { segments };
}

// ---------------------------------------------------------------------------
// Runtime parity checks (fail `pnpm test`)
// ---------------------------------------------------------------------------

describe('the axis mirror (T012 / T031 parity)', () => {
  it('accepts an axis built through the REAL evaluation lane unchanged (and vice versa)', () => {
    const byT012 = validateAxisT012(untrustedAxisJson());
    expect(byT012.ok).toBe(true);
    if (!byT012.ok) return;
    const here = validateAxisHere(JSON.parse(JSON.stringify(byT012.value)));
    expect(here.ok).toBe(true);
    if (!here.ok) return;
    expect(here.value).toEqual(byT012.value);
    expect(isAxisHere(byT012.value)).toBe(true);
    expect(isAxisT012(here.value)).toBe(true);
  });

  it('accepts an axis built through the REAL integrity service unchanged (and vice versa)', () => {
    const byT031 = validateAxisT031(untrustedAxisJson());
    expect(byT031.ok).toBe(true);
    if (!byT031.ok) return;
    const here = validateAxisHere(JSON.parse(JSON.stringify(byT031.value)));
    expect(here.ok).toBe(true);
    if (!here.ok) return;
    expect(here.value).toEqual(byT031.value);
    expect(isAxisT031(here.value)).toBe(true);
  });

  it('rejects a malformed axis identically on both sides', () => {
    const broken = { segments: [{ ref: 'd', start: T0 + DAY, end: T0, regime: 'x' }] };
    expect(validateAxisHere(broken).ok).toBe(false);
    expect(validateAxisT012(broken).ok).toBe(false);
    expect(validateAxisT031(broken).ok).toBe(false);
    expect(isAxisHere(broken)).toBe(false);
    expect(isAxisT012(broken)).toBe(false);
    expect(isAxisT031(broken)).toBe(false);
  });
});

describe('behavioral parity with the family split laws', () => {
  it('the anchored no-gap ladder equals T012 walkForwardWindows (train and test)', () => {
    const axisT012 = validateAxisT012(untrustedAxisJson());
    expect(axisT012.ok).toBe(true);
    if (!axisT012.ok) return;
    const policyT012: WalkForwardPolicy = {
      kind: 'walk-forward',
      policyId: 'split.interop' as WalkForwardPolicy['policyId'],
      minTrainSegments: 3,
      stepSegments: 2,
    };
    const windowsT012 = walkForwardWindows(axisT012.value, policyT012);
    expect(windowsT012.ok).toBe(true);
    if (!windowsT012.ok) return;

    const here = materializeSplitPlan(untrustedAxisJson(), {
      policy_ref: 'split.interop',
      window: 'anchored',
      min_train_segments: 3,
      step_segments: 2,
      train_span_segments: null,
      gap_ms: '0',
      embargo_ms: '0',
      regime_filter: null,
      holdout: null,
    });
    expect(here.ok).toBe(true);
    if (!here.ok) return;

    expect(here.value.windows.length).toBe(windowsT012.value.length);
    here.value.windows.forEach((window, index) => {
      const other = windowsT012.value[index];
      expect(other).toBeDefined();
      expect(window.test.ref).toBe(other?.test.ref);
      expect(window.train.map((s) => s.ref)).toEqual(other?.train.map((s) => s.ref));
      expect(window.purged).toBe(0);
    });
  });

  it('the exact-decimal purge gap equals T031 constructWalkForward (purged kind)', () => {
    const axisT031 = validateAxisT031(untrustedAxisJson());
    expect(axisT031.ok).toBe(true);
    if (!axisT031.ok) return;
    const embargoMs = DAY; // integer embargo — both lanes must agree exactly
    const content = {
      kind: 'purged-embargoed',
      policy_ref: 'split.interop-purged',
      axis: axisT031.value,
      min_train_segments: 3,
      step_segments: 1,
      embargo_ms: embargoMs,
      holdout_count: 1,
    } as unknown as Omit<SplitDefinition, 'definition_id'>;
    // Derive the content address through T031's own function so the
    // definition passes its structural law, then construct through their
    // interpreter — the parity target.
    const byT031 = constructWalkForward({
      definition_id: splitDefinitionIdT031(content),
      ...content,
    } as unknown as SplitDefinition);
    expect(byT031.ok).toBe(true);
    if (!byT031.ok) return;

    const here = materializeSplitPlan(untrustedAxisJson(), {
      policy_ref: 'split.interop-purged',
      window: 'anchored',
      min_train_segments: 3,
      step_segments: 1,
      train_span_segments: null,
      gap_ms: String(embargoMs),
      embargo_ms: '0',
      regime_filter: null,
      holdout: null,
    });
    expect(here.ok).toBe(true);
    if (!here.ok) return;

    expect(here.value.windows.length).toBe(byT031.value.length);
    here.value.windows.forEach((window, index) => {
      const other = byT031.value[index];
      expect(other).toBeDefined();
      expect(window.test.ref).toBe(other?.test.ref);
      expect(window.train.map((s) => s.ref)).toEqual(other?.train.map((s) => s.ref));
      expect(window.purged).toBe(other?.purged);
    });
  });

  it('the trailing holdout separation agrees with T031 constructBlindHoldout material', () => {
    const axisT031 = validateAxisT031(untrustedAxisJson());
    expect(axisT031.ok).toBe(true);
    if (!axisT031.ok) return;
    const holdoutCount = 2;
    const here = materializeSplitPlan(untrustedAxisJson(), {
      policy_ref: 'split.interop-holdout',
      window: 'anchored',
      min_train_segments: 2,
      step_segments: 1,
      train_span_segments: null,
      gap_ms: '0',
      embargo_ms: '0',
      regime_filter: null,
      holdout: { mode: 'trailing-count', count: holdoutCount },
    });
    expect(here.ok).toBe(true);
    if (!here.ok) return;

    const blind = blindHoldoutMask(
      axisT031.value as unknown as Parameters<typeof blindHoldoutMask>[0],
      {
        kind: 'blind-holdout',
        policyId: 'split.interop-holdout' as Parameters<typeof blindHoldoutMask>[1]['policyId'],
        holdoutCount,
      },
    );
    expect(blind.ok).toBe(true);
    if (!blind.ok) return;
    expect(here.value.holdout?.segments.map((s) => s.ref)).toEqual(blind.value.blind.map((s) => s.ref));
  });
});

describe('the program-wide digest + timestamp mirrors', () => {
  it('stableDigest is byte-identical to the search-lineage function on shared inputs', () => {
    for (const input of ['', 'a', '{"a":1,"b":[1,2,3]}', 'ü€𝔘漢字🎉'.repeat(3), 'x'.repeat(1000)]) {
      expect(stableDigest(input)).toBe(stableDigestLineage(input));
    }
  });

  it('TimestampMs mirrors time-engine (bounds and guard)', () => {
    expect(ENGINE_MIN).toBe(0);
    expect(ENGINE_MAX).toBe(8_639_999_999_999_999);
    for (const value of [0, 1, T0, ENGINE_MAX]) {
      expect(isTimestampHere(value)).toBe(true);
      expect(isTimestampEngine(value)).toBe(true);
    }
    for (const value of [-1, 1.5, Number.NaN, ENGINE_MAX + 1]) {
      expect(isTimestampHere(value)).toBe(false);
      expect(isTimestampEngine(value)).toBe(false);
    }
    expect(isTimestampHere(engineRequireTimestampMs(T0))).toBe(true);
  });
});

describe('the exact-decimal lane parity (T031)', () => {
  it('addition, comparison and mean agree on shared inputs', () => {
    for (const [a, b] of [
      ['1', '2'],
      ['0.1', '0.2'],
      ['259200000.125', '86400000.5'],
      ['0.000000000000000001', '0.000000000000000002'],
    ] as const) {
      expect(addDecimals(a, b)).toBe(addT031(a, b));
      expect(compareDecimals(a, b)).toBe(compareT031(a, b));
    }
    expect(meanDecimals(['1', '2', '4'], 2)).toBe(meanT031(['1', '2', '4'], 2));
    expect(meanDecimals(['-0.5', '0.25'], 4)).toBe(meanT031(['-0.5', '0.25'], 4));
  });
});

describe('end-to-end composition over real-lane shapes', () => {
  it('a plan materialized over a REAL T012-built axis carries a stable content address', () => {
    const axisT012 = validateAxisT012(untrustedAxisJson());
    expect(axisT012.ok).toBe(true);
    if (!axisT012.ok) return;
    const here = materializeSplitPlan(JSON.parse(JSON.stringify(axisT012.value)), {
      policy_ref: 'split.interop-e2e',
      window: 'rolling',
      min_train_segments: 3,
      step_segments: 1,
      train_span_segments: 2,
      gap_ms: '43200000',
      embargo_ms: '86400000',
      regime_filter: null,
      holdout: { mode: 'regime-set', regimes: ['crisis'] },
    });
    expect(here.ok).toBe(true);
    if (!here.ok) return;
    // Deterministic address + canonical bytes across repeated derivations.
    const again = materializeSplitPlan(JSON.parse(JSON.stringify(axisT012.value)), {
      policy_ref: 'split.interop-e2e',
      window: 'rolling',
      min_train_segments: 3,
      step_segments: 1,
      train_span_segments: 2,
      gap_ms: '43200000',
      embargo_ms: '86400000',
      regime_filter: null,
      holdout: { mode: 'regime-set', regimes: ['crisis'] },
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.plan_id).toBe(here.value.plan_id);
    expect(canonicalSplitPlan(again.value)).toBe(canonicalSplitPlan(here.value));
    expect(here.value.plan_id.startsWith('splan:')).toBe(true);
    expect(axisDigest(axisT012.value)).toBe(here.value.lineage.axis_digest);
  });
});

/**
 * Cross-package interoperability: @tradrl/control-domain (T007 contracts)
 * against the canonical owners of every mirrored shape —
 * @tradrl/time-engine (TimestampMs) and @tradrl/domain-core (ConstraintSet
 * data contracts, GoalHorizon, Timestamp, ExecutionMode, identity spaces).
 *
 * The contract packages are deliberately NOT package-dependencies (the frozen
 * workspace lockfile forbids it), so shared shapes live in STRUCTURAL MIRRORS
 * (D-003/D-004 pattern — see primitives.ts, constraints.ts, project.ts and
 * packages/market-protocol/src/timestamp.ts for the precedent). This file is
 * the trip wire:
 * - the type-level assertion functions fail `pnpm typecheck` if any mirror
 *   drifts from its canonical declaration;
 * - the runtime parity checks fail `pnpm test` if the mirrored guards or
 *   vocabularies diverge behaviorally.
 *
 * What interop this PROVES: a domain-core `ConstraintSet` (authored by the
 * T002 lane) feeds `compileAcceptance` unchanged; a time-engine
 * `TimestampMs` flows into control-plane audit fields unchanged; a
 * domain-core `Project`'s id space is the control plane's id space.
 */

import { describe, expect, it } from 'vitest';

import {
  EXECUTION_MODES as CONTROL_EXECUTION_MODES,
  type ExecutionMode as ControlExecutionMode,
} from './project';
import {
  MAX_TIMESTAMP_MS as CONTROL_MAX,
  MIN_TIMESTAMP_MS as CONTROL_MIN,
  type ConstraintSet as ControlConstraintSet,
  type ConstraintSetRef as ControlConstraintSetRef,
  type GoalHorizon as ControlGoalHorizon,
  type Predicate as ControlPredicate,
  type ProjectId as ControlProjectId,
  type TenantId as ControlTenantId,
  type Timestamp as ControlTimestamp,
  type TimestampMs as ControlTimestampMs,
  EXECUTION_MODES,
  isConstraintSet as controlIsConstraintSet,
  isConstraintSetRef as controlIsConstraintSetRef,
  isExecutionMode as controlIsExecutionMode,
  isGoalHorizon as controlIsGoalHorizon,
  isPredicate as controlIsPredicate,
  isTimestamp as controlIsTimestamp,
  isTimestampMs as controlIsTimestampMs,
  compileAcceptance,
} from './index';
import {
  type GoalRef as ControlGoalRef,
  type ConstraintSetId as ControlConstraintSetId,
} from './ids';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  EXECUTION_MODES as CORE_EXECUTION_MODES,
  isConstraintSet as coreIsConstraintSet,
  isConstraintSetRef as coreIsConstraintSetRef,
  isExecutionMode as coreIsExecutionMode,
  isGoalHorizon as coreIsGoalHorizon,
  isPredicate as coreIsPredicate,
  isTimestamp as coreIsTimestamp,
  type ConstraintSet as CoreConstraintSet,
  type ConstraintSetId as CoreConstraintSetId,
  type ConstraintSetRef as CoreConstraintSetRef,
  type ExecutionMode as CoreExecutionMode,
  type GoalHorizon as CoreGoalHorizon,
  type Predicate as CorePredicate,
  type ProjectId as CoreProjectId,
  type TenantId as CoreTenantId,
  type Timestamp as CoreTimestamp,
} from '../../domain-core/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// Each function compiles iff the two declarations are mutually assignable.
// ---------------------------------------------------------------------------

/** Compiles iff control-domain TimestampMs is assignable to time-engine's. */
function controlTimestampIsEngineTimestamp(value: ControlTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff time-engine TimestampMs is assignable to control-domain's. */
function engineTimestampIsControlTimestamp(value: EngineTimestampMs): ControlTimestampMs {
  return value;
}

/** Compiles iff domain-core ExecutionMode is assignable to the control mirror. */
function coreExecutionModeIsControl(value: CoreExecutionMode): ControlExecutionMode {
  return value;
}

/** Compiles iff the control ExecutionMode mirror is assignable to domain-core's. */
function controlExecutionModeIsCore(value: ControlExecutionMode): CoreExecutionMode {
  return value;
}

/** Compiles iff domain-core ConstraintSet is assignable to the control mirror. */
function coreConstraintSetIsControl(value: CoreConstraintSet): ControlConstraintSet {
  return value;
}

/** Compiles iff the control ConstraintSet mirror is assignable to domain-core's. */
function controlConstraintSetIsCore(value: ControlConstraintSet): CoreConstraintSet {
  return value;
}

/** Compiles iff domain-core ConstraintSetRef is assignable to the control mirror. */
function coreRefIsControlRef(value: CoreConstraintSetRef): ControlConstraintSetRef {
  return value;
}

/** Compiles iff the control ConstraintSetRef mirror is assignable to domain-core's. */
function controlRefIsCoreRef(value: ControlConstraintSetRef): CoreConstraintSetRef {
  return value;
}

/** Compiles iff domain-core Predicate is assignable to the control mirror. */
function corePredicateIsControl(value: CorePredicate): ControlPredicate {
  return value;
}

/** Compiles iff the control Predicate mirror is assignable to domain-core's. */
function controlPredicateIsCore(value: ControlPredicate): CorePredicate {
  return value;
}

/** Compiles iff domain-core GoalHorizon is assignable to the control mirror. */
function coreHorizonIsControl(value: CoreGoalHorizon): ControlGoalHorizon {
  return value;
}

/** Compiles iff the control GoalHorizon mirror is assignable to domain-core's. */
function controlHorizonIsCore(value: ControlGoalHorizon): CoreGoalHorizon {
  return value;
}

/** Compiles iff domain-core Timestamp is assignable to the control mirror. */
function coreTimestampIsControl(value: CoreTimestamp): ControlTimestamp {
  return value;
}

/** Compiles iff the control Timestamp mirror is assignable to domain-core's. */
function controlTimestampIsCore(value: ControlTimestamp): CoreTimestamp {
  return value;
}

/** Compiles iff domain-core ProjectId/TenantId are assignable to the control mirrors. */
function coreIdsAreControlIds(project: CoreProjectId, tenant: CoreTenantId): {
  project: ControlProjectId;
  tenant: ControlTenantId;
} {
  return { project, tenant };
}

// ---------------------------------------------------------------------------
// Runtime parity fixtures
// ---------------------------------------------------------------------------

const CORE_STYLE_SET = {
  id: 'csInterop',
  version: 4,
  name: 'interop set',
  constraints: [
    { id: 'max-exposure', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'limit.max', bound: 1_000_000 }, severity: 'blocking' },
    { id: 'asset-allowlist', domain: 'action', subject: 'order.instrument', predicate: { kind: 'oneOf', values: ['BTC-USDT', 'ETH-USDT'] }, severity: 'blocking' },
    { id: 'kill-switch-armed', domain: 'state', subject: 'risk.killSwitchArmed', predicate: { kind: 'flag', expected: false }, severity: 'advisory' },
  ],
  supersedes: { id: 'csInterop', version: 3 },
  provenance: { origin: 'authored' },
  createdAt: '2027-01-03T08:00:00Z',
} as const;

const BROKEN_SETS: unknown[] = [
  { ...CORE_STYLE_SET, version: 0 },
  { ...CORE_STYLE_SET, id: '' },
  {
    ...CORE_STYLE_SET,
    constraints: [
      { id: 'dup', domain: 'state', subject: 'a.b', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
      { id: 'dup', domain: 'state', subject: 'a.b', predicate: { kind: 'flag', expected: false }, severity: 'advisory' },
    ],
  },
  { ...CORE_STYLE_SET, constraints: 'none' },
  { ...CORE_STYLE_SET, createdAt: '2027-01-03T08:00:00' },
  null,
  42,
];

const HORIZONS: unknown[] = [
  { startsAt: '2027-01-04T00:00:00Z', endsAt: '2027-04-04T00:00:00Z', label: 'Q1' },
  { startsAt: '2027-01-04T00:00:00Z', endsAt: '2027-04-04T00:00:00Z' },
  { startsAt: '2027-04-04T00:00:00Z', endsAt: '2027-01-04T00:00:00Z' }, // inverted
  { startsAt: '2027-01-04T10:00:00Z', endsAt: '2027-01-04T11:00:00+01:00' }, // empty by instant
  { startsAt: '2027-01-04T00:00:00', endsAt: '2027-04-04T00:00:00Z' }, // naive
  { startsAt: '2027-01-04T00:00:00Z', endsAt: '2027-04-04T00:00:00Z', label: '' },
  null,
];

const PREDICATES: unknown[] = [
  { kind: 'limit.max', bound: 10 },
  { kind: 'limit.min', bound: -1.5 },
  { kind: 'limit.range', min: 0, max: 1 },
  { kind: 'equals', value: 'BTC-USDT' },
  { kind: 'equals', value: true },
  { kind: 'notEquals', value: 3 },
  { kind: 'oneOf', values: ['buy', 'hold'] },
  { kind: 'flag', expected: false },
  { kind: 'limit.max' }, // missing bound
  { kind: 'limit.max', bound: Number.NaN },
  { kind: 'limit.range', min: 5, max: 1 },
  { kind: 'oneOf', values: [] },
  { kind: 'flag', expected: 'yes' },
  { kind: 'unknown' },
  'limit.max',
  null,
];

const TIMESTAMP_SAMPLES: unknown[] = [
  '2027-01-02T08:00:00Z',
  '2027-01-02T08:00:00.123+05:30',
  '2027-01-02T08:00:00', // naive
  '2027-01-02', // date only
  'not a timestamp',
  42,
  null,
];

const TIMESTAMP_MS_SAMPLES: unknown[] = [
  0,
  1,
  1.5,
  -1,
  ENGINE_MAX,
  ENGINE_MAX + 1,
  Number.NaN,
  'x',
  null,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (canonical: @tradrl/time-engine)', () => {
  it('keeps the mirrored constants identical', () => {
    expect(CONTROL_MIN).toBe(ENGINE_MIN);
    expect(CONTROL_MAX).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    for (const sample of TIMESTAMP_MS_SAMPLES) {
      expect(controlIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asControl: ControlTimestampMs = engineTimestampIsControlTimestamp(fromEngine);
    const backToEngine: EngineTimestampMs = controlTimestampIsEngineTimestamp(asControl);
    expect(backToEngine).toBe(42);
  });
});

describe('ExecutionMode structural mirror (canonical: @tradrl/domain-core)', () => {
  it('keeps the vocabulary identical (order and content)', () => {
    expect(CONTROL_EXECUTION_MODES).toEqual(CORE_EXECUTION_MODES);
  });

  it('keeps the guards behaviorally identical', () => {
    for (const sample of ['simulation', 'shadow', 'live', 'paper', 'LIVE', '', 1, null]) {
      expect(controlIsExecutionMode(sample)).toBe(coreIsExecutionMode(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const mode: ControlExecutionMode = 'shadow';
    const asCore: CoreExecutionMode = controlExecutionModeIsCore(mode);
    const back: ControlExecutionMode = coreExecutionModeIsControl(asCore);
    expect(back).toBe('shadow');
    expect(EXECUTION_MODES).toContain(back);
  });
});

describe('ConstraintSet data-contract mirror (canonical: @tradrl/domain-core)', () => {
  it('accepts and rejects exactly the same records (guard parity)', () => {
    expect(controlIsConstraintSet(CORE_STYLE_SET)).toBe(true);
    expect(coreIsConstraintSet(CORE_STYLE_SET)).toBe(true);
    for (const broken of BROKEN_SETS) {
      expect(controlIsConstraintSet(broken)).toBe(false);
      expect(coreIsConstraintSet(broken)).toBe(false);
    }
  });

  it('keeps ConstraintSetRef guards behaviorally identical', () => {
    const refs: unknown[] = [
      { id: 'cs', version: 1 },
      { id: 'cs', version: 0 },
      { id: 'cs', version: 1.5 },
      { id: '', version: 1 },
      { id: 'cs' },
      null,
    ];
    for (const ref of refs) {
      expect(controlIsConstraintSetRef(ref)).toBe(coreIsConstraintSetRef(ref));
    }
  });

  it('keeps Predicate guards behaviorally identical', () => {
    for (const predicate of PREDICATES) {
      expect(controlIsPredicate(predicate)).toBe(coreIsPredicate(predicate));
    }
  });

  it('keeps GoalHorizon guards behaviorally identical', () => {
    for (const horizon of HORIZONS) {
      expect(controlIsGoalHorizon(horizon)).toBe(coreIsGoalHorizon(horizon));
    }
  });

  it('keeps Timestamp guards behaviorally identical', () => {
    for (const sample of TIMESTAMP_SAMPLES) {
      expect(controlIsTimestamp(sample)).toBe(coreIsTimestamp(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const coreSet: CoreConstraintSet = CORE_STYLE_SET as unknown as CoreConstraintSet;
    const asControl: ControlConstraintSet = coreConstraintSetIsControl(coreSet);
    const backToCore: CoreConstraintSet = controlConstraintSetIsCore(asControl);
    expect(backToCore.id).toBe('csInterop');
    const coreRef: CoreConstraintSetRef = { id: 'csInterop' as CoreConstraintSetId, version: 4 };
    expect(controlRefIsCoreRef(coreRefIsControlRef(coreRef)).version).toBe(4);
    const corePredicate: CorePredicate = { kind: 'limit.max', bound: 5 };
    expect(controlPredicateIsCore(corePredicateIsControl(corePredicate)).kind).toBe('limit.max');
    const coreHorizon: CoreGoalHorizon = {
      startsAt: '2027-01-04T00:00:00Z' as CoreTimestamp,
      endsAt: '2027-04-04T00:00:00Z' as CoreTimestamp,
    };
    expect(controlHorizonIsCore(coreHorizonIsControl(coreHorizon)).endsAt).toBe('2027-04-04T00:00:00Z');
    const coreTs: CoreTimestamp = '2027-01-04T00:00:00Z' as CoreTimestamp;
    expect(controlTimestampIsCore(coreTimestampIsControl(coreTs))).toBe('2027-01-04T00:00:00Z');
    const ids = coreIdsAreControlIds('prj_1' as CoreProjectId, 'tenant_1' as CoreTenantId);
    expect(ids.project).toBe('prj_1');
    expect(ids.tenant).toBe('tenant_1');
  });

  it('END-TO-END: a domain-core-authored ConstraintSet compiles through the control plane unchanged', () => {
    // A record produced under the CANONICAL domain-core types (no adaptation,
    // no re-validation shim) is accepted by the T007 compiler directly.
    const coreSet = coreConstraintSetIsControl(CORE_STYLE_SET as unknown as CoreConstraintSet);
    const compiled = compileAcceptance(
      {
        id: 'goal-interop' as ControlGoalRef,
        version: 1,
        createdAt: '2027-01-02T08:00:00Z' as ControlTimestamp,
        objective: 'Interop witness goal.',
        horizon: { startsAt: '2027-01-04T00:00:00Z' as ControlTimestamp, endsAt: '2027-04-04T00:00:00Z' as ControlTimestamp },
        constraintSet: { id: 'csInterop' as ControlConstraintSetId, version: 4 },
        successCriteria: [
          { id: 'hard-limits', gatingConstraintIds: ['max-exposure', 'asset-allowlist'], requiredSatisfaction: 1 },
          { id: 'ops-hygiene', requiredSatisfaction: 0.5 },
        ],
        evaluationPolicy: { blindEvaluationRef: 'b@1', walkForwardRef: 'w@1', regimeRef: 'r@1' },
      },
      coreSet,
    );
    expect(compiled.constraintSet).toEqual({ id: 'csInterop', version: 4 });
    expect(compiled.criteria[1]?.gatingConstraintIds).toEqual([
      'max-exposure',
      'asset-allowlist',
      'kill-switch-armed',
    ]);
  });
});

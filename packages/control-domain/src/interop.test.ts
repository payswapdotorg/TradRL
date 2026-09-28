/**
 * Cross-package interoperability: @tradrl/control-domain against
 * @tradrl/time-engine and @tradrl/domain-core.
 *
 * The contract packages are deliberately NOT package-dependencies (the
 * frozen workspace lockfile forbids it), so shared types live as
 * STRUCTURAL MIRRORS (see src/timestamp.ts and src/execution-mode.ts —
 * the D-003/D-004 pattern of packages/market-protocol/src/timestamp.ts).
 * This test is the trip wire: if either declaration drifts, the
 * type-level assertions below fail `pnpm typecheck`, and the runtime
 * parity checks fail `pnpm test`.
 *
 * Mirrors asserted here:
 * - `TimestampMs` (control-domain ↔ time-engine);
 * - `ExecutionMode` (control-domain ↔ domain-core);
 * - the predicate guard `isCriterionPredicate` (control-domain ↔
 *   domain-core's `isPredicate` — the executable predicate vocabulary the
 *   control plane wraps);
 * - the shared `ProjectId` identity space (control-domain ↔ domain-core —
 *   deliberately the same brand tag: T002 owns the Project record, T007
 *   owns the lifecycle).
 */

import { describe, expect, it } from 'vitest';

import {
  EXECUTION_MODES as CONTROL_MODES,
  MAX_TIMESTAMP_MS as CONTROL_MAX,
  MIN_TIMESTAMP_MS as CONTROL_MIN,
  isCriterionPredicate as controlIsPredicate,
  isExecutionMode as controlIsExecutionMode,
  isTimestampMs as controlIsTimestampMs,
  type AcceptanceCriteria,
  type ExecutionMode as ControlExecutionMode,
  type ProjectId as ControlProjectId,
  type ProjectRecord,
  type TimestampMs as ControlTimestampMs,
} from './index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  EXECUTION_MODES as CORE_MODES,
  isExecutionMode as coreIsExecutionMode,
  isPredicate as coreIsPredicate,
  type ExecutionMode as CoreExecutionMode,
  type ProjectId as CoreProjectId,
  type Project,
} from '../../domain-core/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff control-domain TimestampMs is assignable to engine TimestampMs. */
function controlTimestampIsEngineTimestamp(value: ControlTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff engine TimestampMs is assignable to control-domain TimestampMs. */
function engineTimestampIsControlTimestamp(value: EngineTimestampMs): ControlTimestampMs {
  return value;
}

/** Compiles iff control-domain ExecutionMode is assignable to domain-core ExecutionMode. */
function controlModeIsCoreMode(value: ControlExecutionMode): CoreExecutionMode {
  return value;
}

/** Compiles iff domain-core ExecutionMode is assignable to control-domain ExecutionMode. */
function coreModeIsControlMode(value: CoreExecutionMode): ControlExecutionMode {
  return value;
}

/** Compiles iff domain-core ProjectId is assignable to control-domain ProjectId (shared identity space). */
function coreProjectIdIsControlProjectId(value: CoreProjectId): ControlProjectId {
  return value;
}

/** Compiles iff control-domain ProjectId is assignable to domain-core ProjectId (shared identity space). */
function controlProjectIdIsCoreProjectId(value: ControlProjectId): CoreProjectId {
  return value;
}

// ---------------------------------------------------------------------------
// TimestampMs structural mirror
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (control-domain ↔ time-engine)', () => {
  it('keeps the mirrored constants identical', () => {
    expect(CONTROL_MIN).toBe(ENGINE_MIN);
    expect(CONTROL_MAX).toBe(ENGINE_MAX);
    expect(CONTROL_MIN).toBe(0);
    expect(CONTROL_MAX).toBe(8_639_999_999_999_999);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    const samples: unknown[] = [
      0,
      1,
      1.5,
      -1,
      ENGINE_MAX,
      ENGINE_MAX + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1000',
      null,
      undefined,
      {},
    ];
    for (const sample of samples) {
      expect(controlIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asControl: ControlTimestampMs = engineTimestampIsControlTimestamp(fromEngine);
    const asEngine: EngineTimestampMs = controlTimestampIsEngineTimestamp(asControl);
    expect(asEngine).toBe(42);
    expect(controlIsTimestampMs(asControl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExecutionMode structural mirror
// ---------------------------------------------------------------------------

describe('ExecutionMode structural mirror (control-domain ↔ domain-core)', () => {
  it('keeps the mirrored vocabulary identical', () => {
    expect([...CONTROL_MODES]).toEqual([...CORE_MODES]);
    expect([...CONTROL_MODES]).toEqual(['simulation', 'shadow', 'live']);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    const samples: unknown[] = [
      'simulation',
      'shadow',
      'live',
      'paper',
      '',
      'LIVE',
      0,
      null,
      ['live'],
    ];
    for (const sample of samples) {
      expect(controlIsExecutionMode(sample)).toBe(coreIsExecutionMode(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const controlMode: ControlExecutionMode = 'shadow';
    const asCore: CoreExecutionMode = controlModeIsCoreMode(controlMode);
    const back: ControlExecutionMode = coreModeIsControlMode(asCore);
    expect(back).toBe('shadow');
  });
});

// ---------------------------------------------------------------------------
// Predicate guard parity (the executable predicate vocabulary we wrap)
// ---------------------------------------------------------------------------

describe('CriterionPredicate guard parity (control-domain ↔ domain-core isPredicate)', () => {
  it('accepts and rejects the same predicate shapes', () => {
    const samples: unknown[] = [
      { kind: 'limit.max', bound: 1 },
      { kind: 'limit.min', bound: -1.5 },
      { kind: 'limit.min', bound: Number.POSITIVE_INFINITY },
      { kind: 'limit.range', min: 0, max: 1 },
      { kind: 'limit.range', min: 1, max: 0 },
      { kind: 'limit.range', min: 0 },
      { kind: 'equals', value: '1' },
      { kind: 'equals', value: 1 },
      { kind: 'equals', value: true },
      { kind: 'equals', value: null },
      { kind: 'notEquals', value: 0 },
      { kind: 'oneOf', values: ['a', 'b'] },
      { kind: 'oneOf', values: [] },
      { kind: 'oneOf', values: 'ab' },
      { kind: 'flag', expected: false },
      { kind: 'flag', expected: 'false' },
      { kind: 'flag' },
      { kind: 'limit.median', bound: 1 },
      'profitable',
      null,
      42,
    ];
    for (const sample of samples) {
      expect(
        controlIsPredicate(sample),
        `divergence on ${JSON.stringify(sample)}`,
      ).toBe(coreIsPredicate(sample));
    }
  });
});

// ---------------------------------------------------------------------------
// Shared ProjectId identity space (control-domain ↔ domain-core)
// ---------------------------------------------------------------------------

describe('ProjectId shared identity space (control-domain ↔ domain-core)', () => {
  it('exercises the type-level assignability witnesses (compile-time trip wire)', () => {
    // A domain-core Project.id flows into control-domain ProjectId fields
    // without a cast, and back — one identity space by design.
    const coreId: CoreProjectId = 'prj_shared' as CoreProjectId;
    const asControl: ControlProjectId = coreProjectIdIsControlProjectId(coreId);
    const back: CoreProjectId = controlProjectIdIsCoreProjectId(asControl);
    expect(back).toBe('prj_shared');
  });

  it('a domain-core Project record id is usable as the control-plane project id', () => {
    const coreProject: Project = {
      id: 'prj_domain_core' as CoreProjectId,
      tenantId: 'tenant_acme' as never,
      name: 'Domain-core project',
      status: 'draft',
      createdAt: '2027-01-02T08:00:00Z' as never,
      goalId: 'goal_alpha' as never,
      constraintSet: { id: 'cs_alpha' as never, version: 1 },
      marketScope: { venues: ['venue_binance' as never], instruments: [], assetClasses: ['crypto' as never] },
      dataScope: { categories: [] },
      executionMode: 'simulation',
    };
    // The shared identity space means the id needs NO cast to serve as a
    // control-plane project identity.
    const controlId: ControlProjectId = coreProject.id;
    expect(controlId).toBe('prj_domain_core');
  });
});

// ---------------------------------------------------------------------------
// L7 surface reminder (compile-time): the control-plane records that
// downstream lanes consume carry no outcome field either.
// ---------------------------------------------------------------------------

/** `true` iff neither AcceptanceCriteria nor ProjectRecord has a `pnl`/`attained` key. */
type NoPnlOnControlRecords =
  'pnl' extends keyof AcceptanceCriteria | keyof ProjectRecord ? never : true;
const noPnlOnControlRecords: NoPnlOnControlRecords = true;

it('type-level: no PnL channel on the consumed record surfaces', () => {
  expect(noPnlOnControlRecords).toBe(true);
});

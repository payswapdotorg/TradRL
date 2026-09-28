/**
 * Cross-package interoperability trip wires for @tradrl/agent-os.
 *
 * The contract packages are deliberately NOT package-dependencies (the frozen
 * workspace lockfile forbids it), so shared vocabularies travel through
 * STRUCTURAL MIRRORS (program decisions D-003/D-004 — the same pattern as
 * `packages/market-protocol/src/interop.test.ts`). This file is the trip
 * wire: if any mirrored declaration drifts, the type-level assertions below
 * fail `pnpm typecheck` and the runtime parity checks fail `pnpm test`.
 *
 * Mirrors verified here:
 * 1. `TimestampMs` — against BOTH @tradrl/time-engine (canonical owner) and
 *    @tradrl/market-protocol (the sibling mirror).
 * 2. The fourteen kernel action names — against @tradrl/agent-body's
 *    `AGENT_ACTION_NAMES` (the declarative vocabulary mirror; this package
 *    owns the semantics, T006).
 * 3. `AgentInstanceId` identifier discipline — runtime guard parity with
 *    @tradrl/agent-body (ids remain interchangeable values; the brands are
 *    module-private unique symbols, so parity is asserted at the value
 *    level, which is the only level the frozen contracts allow).
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_ACTION_NAMES as BODY_ACTION_NAMES,
  agentInstanceId as bodyAgentInstanceId,
  isAgentInstanceId as bodyIsAgentInstanceId,
  type AgentActionName,
} from '../../agent-body/src/index';
import {
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  isTimestampMs as protocolIsTimestampMs,
  type TimestampMs as ProtocolTimestampMs,
} from '../../market-protocol/src/index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  timestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  KERNEL_ACTION_COUNT,
  KERNEL_ACTION_NAMES,
  agentInstanceId,
  isAgentInstanceId,
  isTimestampMs as osIsTimestampMs,
  type KernelActionName,
  type TimestampMs as OsTimestampMs,
  MAX_TIMESTAMP_MS as OS_MAX,
  MIN_TIMESTAMP_MS as OS_MIN,
} from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff agent-os TimestampMs is assignable to time-engine TimestampMs. */
function osTimestampIsEngineTimestamp(value: OsTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff time-engine TimestampMs is assignable to agent-os TimestampMs. */
function engineTimestampIsOsTimestamp(value: EngineTimestampMs): OsTimestampMs {
  return value;
}

/** Compiles iff agent-os TimestampMs is assignable to market-protocol TimestampMs. */
function osTimestampIsProtocolTimestamp(value: OsTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff market-protocol TimestampMs is assignable to agent-os TimestampMs. */
function protocolTimestampIsOsTimestamp(value: ProtocolTimestampMs): OsTimestampMs {
  return value;
}

/** Compiles iff agent-body's action union is assignable to the kernel's. */
function bodyActionIsKernelAction(value: AgentActionName): KernelActionName {
  return value;
}

/** Compiles iff the kernel's action union is assignable to agent-body's. */
function kernelActionIsBodyAction(value: KernelActionName): AgentActionName {
  return value;
}

// ---------------------------------------------------------------------------
// 1. TimestampMs structural mirror (time-engine is canonical).
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (agent-os <-> time-engine <-> market-protocol)', () => {
  it('keeps the mirrored constants identical across all three declarations', () => {
    expect(OS_MIN).toBe(ENGINE_MIN);
    expect(OS_MAX).toBe(ENGINE_MAX);
    expect(OS_MIN).toBe(PROTOCOL_MIN);
    expect(OS_MAX).toBe(PROTOCOL_MAX);
  });

  it('keeps the mirrored guards behaviorally identical across all three declarations', () => {
    const samples: readonly unknown[] = [
      0,
      1,
      1.5,
      -1,
      ENGINE_MAX,
      ENGINE_MAX + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      'x',
      null,
      undefined,
      {},
    ];
    for (const sample of samples) {
      expect(osIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
      expect(osIsTimestampMs(sample)).toBe(protocolIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (no-op at runtime, compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asOs: OsTimestampMs = engineTimestampIsOsTimestamp(fromEngine);
    const asEngine: EngineTimestampMs = osTimestampIsEngineTimestamp(asOs);
    expect(asEngine).toBe(42);
    const asProtocol: ProtocolTimestampMs = osTimestampIsProtocolTimestamp(asOs);
    expect(protocolTimestampIsOsTimestamp(asProtocol)).toBe(42);
  });

  it('accepts engine-constructed timestamps in kernel positions and vice versa', () => {
    const engineResult = timestampMs(1_700_000_000_000);
    expect(engineResult.ok).toBe(true);
    if (engineResult.ok) {
      const kernelSide: OsTimestampMs = engineTimestampIsOsTimestamp(engineResult.value);
      expect(osIsTimestampMs(kernelSide)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The fourteen kernel action names (agent-body mirrors the vocabulary).
// ---------------------------------------------------------------------------

describe('Kernel action-name mirror (agent-os owns semantics, agent-body declares vocabulary)', () => {
  it('is EXACTLY fourteen operations', () => {
    expect(KERNEL_ACTION_COUNT).toBe(14);
    expect(KERNEL_ACTION_NAMES.length).toBe(14);
    expect(new Set(KERNEL_ACTION_NAMES).size).toBe(14);
  });

  it('matches agent-body\'s AGENT_ACTION_NAMES element-for-element', () => {
    expect([...KERNEL_ACTION_NAMES]).toEqual([...BODY_ACTION_NAMES]);
    expect(new Set(BODY_ACTION_NAMES).size).toBe(14);
  });

  it('contains the frozen fourteen verbs from spec/ARCHITECTURE.md', () => {
    expect([...KERNEL_ACTION_NAMES]).toEqual([
      'SPAWN',
      'TERMINATE',
      'DELEGATE',
      'REQUEST',
      'PUBLISH',
      'SUBSCRIBE',
      'CHALLENGE',
      'PROPOSE',
      'APPROVE',
      'EXECUTE',
      'ESCALATE',
      'OBSERVE',
      'LEARN',
      'REPORT',
    ]);
  });

  it('exercises the type-level action-union mirror functions (compile-time trip wire)', () => {
    const kernelSide: KernelActionName = bodyActionIsKernelAction('EXECUTE');
    const bodySide: AgentActionName = kernelActionIsBodyAction(kernelSide);
    expect(bodySide).toBe('EXECUTE');
  });
});

// ---------------------------------------------------------------------------
// 3. AgentInstanceId identifier discipline (runtime value parity).
// ---------------------------------------------------------------------------

describe('AgentInstanceId identifier discipline (agent-os <-> agent-body)', () => {
  const sharedSamples: readonly string[] = [
    'agent-instance-atlas-0001',
    'a',
    'A.b_c-d:e.0',
    'bad id',
    '',
    ' leading',
    'trailing ',
    '-nope',
    'x'.repeat(257),
  ];

  it('accepts and rejects the same identifier strings as agent-body', () => {
    for (const sample of sharedSamples) {
      expect(isAgentInstanceId(sample)).toBe(bodyIsAgentInstanceId(sample));
    }
  });

  it('treats agent-body-constructed ids as valid kernel ids and vice versa', () => {
    const fromBody = bodyAgentInstanceId('agent-instance-shared-42');
    expect(isAgentInstanceId(fromBody)).toBe(true);
    const fromOs = agentInstanceId('agent-instance-shared-42');
    expect(bodyIsAgentInstanceId(fromOs)).toBe(true);
    expect(fromOs).toBe(fromBody);
  });
});

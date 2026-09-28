/**
 * @tradrl/provider-sdk — adapter contract tests (the neutrality contract).
 *
 * Every concrete adapter (T037+) MUST pass these cases: they encode the
 * laws that make an adapter a well-behaved, provider-neutral user of the
 * SDK. The factory is framework-free (zero runtime deps): it produces
 * plain {@link ContractCase} records whose `run()` throws on failure;
 * adapters register them with their own test runner (describe/it, or any
 * harness). The SDK's own suite runs every case against a neutral
 * reference subject (dogfooding — the factories are never shipped
 * untested).
 *
 * The cases assert, in order:
 *   1. Lifecycle: open -> subscribe -> drain -> close succeeds.
 *   2. Double close is a typed ProtocolError.
 *   3. Use-after-close is a typed ProtocolError.
 *   4. Subscribe-before-open is a typed ProtocolError.
 *   5. An unmapped raw field is a MappingError (silent drops unrepresentable).
 *   6. Emission without a declared entitlement is an EntitlementError.
 *   7. Every emitted event carries a complete availability quartet with
 *      available_time >= event_time (L4).
 *   8. Every emitted event carries a provenance block satisfying the
 *      ingestion mirror (L9).
 *   9. Every emitted payload satisfies its canonical payload validator.
 *  10. The same script emits a BYTE-IDENTICAL stream twice (deep-equal and
 *      JSON-identical — determinism).
 *  11. The raw subscription request passes through the transport unmangled
 *      (the SDK never interprets or rewrites vendor request payloads).
 */

import { isAdapterError, type AdapterError, type AdapterErrorKind, type SdkResult } from '../errors';
import { createFakeTransport, type TransportScript } from './fake-transport';
import { validateIngestionProvenance } from '../provenance';
import { payloadRegistry } from '../payloads/registry';
import type { EmittedEvent } from '../emitter';
import type { SourceDescriptor } from '../descriptors';
import type { SubscriptionSpec, AdapterSession } from '../session';
import type { TransportPort } from '../transport';
import { isTimestampMs } from '../timestamp';

// ---------------------------------------------------------------------------
// Assertion helpers (framework-free, zero-dep).
// ---------------------------------------------------------------------------

/** Fail unless the condition holds (throws with the message). */
export function contractAssert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`contract violation: ${message}`);
  }
}

/** Fail unless both values are deep-equal AND JSON-identical (determinism-grade equality). */
export function contractExpectJsonEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`contract violation: ${message} — expected ${expectedJson}, got ${actualJson}`);
  }
}

/** Fail unless the result is a typed failure of the given family and code. */
export function contractExpectFailure(
  result: SdkResult<unknown>,
  kind: AdapterErrorKind,
  code: string,
): AdapterError {
  if (result.ok) {
    throw new Error(`contract violation: expected a typed ${kind} failure (${code}), got success`);
  }
  const error = result.error;
  if (!isAdapterError(error)) {
    throw new Error('contract violation: the failure is not a typed AdapterError');
  }
  if (error.kind !== kind || error.code !== code) {
    throw new Error(
      `contract violation: expected ${kind}/${code}, got ${error.kind}/${error.code} (${error.message})`,
    );
  }
  return error;
}

/** Fail unless the result succeeded. */
export function contractExpectSuccess<T>(result: SdkResult<T>, message: string): T {
  if (!result.ok) {
    throw new Error(`contract violation: ${message} — unexpected failure ${result.error.kind}/${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// The contract subject (what a concrete adapter provides).
// ---------------------------------------------------------------------------

/**
 * The provider-neutral subject every adapter supplies to the contract
 * factory. `descriptor`, `subscription` and the scripts are the adapter's
 * own declarations; `createSession` builds a FRESH session over a given
 * transport (must be side-effect free — the determinism case builds two).
 */
export interface AdapterContractSubject {
  /** The adapter's declared source descriptor. */
  readonly descriptor: SourceDescriptor;
  /** A valid subscription the adapter can serve. */
  readonly subscription: SubscriptionSpec;
  /** A script whose messages all map successfully (the happy path). */
  readonly validScript: TransportScript;
  /**
   * The same messages, each with ONE additional raw field the mapping
   * table does not account for (the anti-silent-drop negative path).
   */
  readonly unmappedFieldScript: TransportScript;
  /** Builds a session WITH the declared entitlement (the happy path). */
  createSession(transport: TransportPort): AdapterSession;
  /** Builds a session WITHOUT any declared entitlement (the refusal path). */
  createSessionWithoutEntitlement(transport: TransportPort): AdapterSession;
}

/** One named contract case; `run()` throws on violation. */
export interface ContractCase {
  readonly name: string;
  readonly run: () => void;
}

/** Drain a session into every emission result until drained or failure. */
function drainAll(session: AdapterSession): { events: EmittedEvent[]; terminal: SdkResult<EmittedEvent | null> } {
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) return { events, terminal: next };
    if (next.value === null) return { events, terminal: next };
    events.push(next.value);
  }
}

/** A fresh scripted transport for a script. */
function transportFor(script: TransportScript): TransportPort {
  const construction = createFakeTransport(script);
  if (!construction.ok) {
    throw new Error(`contract violation: the subject script is invalid: ${construction.errors.map((e) => e.message).join('; ')}`);
  }
  return construction.transport;
}

/**
 * The contract cases every adapter MUST pass. Framework-free: register the
 * returned cases with any test runner.
 */
export function adapterContractCases(subject: AdapterContractSubject): readonly ContractCase[] {
  const cases: ContractCase[] = [
    {
      name: 'lifecycle: open, subscribe, drain, close succeeds',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const drained = drainAll(session);
        contractExpectSuccess(drained.terminal, 'drain must succeed');
        contractAssert(drained.terminal.ok && drained.terminal.value === null, 'the valid script must drain to null');
        contractAssert(drained.events.length > 0, 'the valid script must emit at least one event');
        contractExpectSuccess(session.close(), 'close must succeed');
        contractAssert(session.state() === 'closed', 'the session must be closed');
      },
    },
    {
      name: 'lifecycle: double close is a typed ProtocolError',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.close(), 'first close must succeed');
        contractExpectFailure(session.close(), 'protocol', 'double_close');
      },
    },
    {
      name: 'lifecycle: use-after-close is a typed ProtocolError',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.close(), 'close must succeed');
        contractExpectFailure(session.nextEvent(), 'protocol', 'use_after_close');
        contractExpectFailure(session.subscribe(subject.subscription), 'protocol', 'use_after_close');
      },
    },
    {
      name: 'lifecycle: subscribe before open is a typed ProtocolError',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectFailure(session.subscribe(subject.subscription), 'protocol', 'invalid_transition');
      },
    },
    {
      name: 'mapping: an unmapped raw field is a MappingError (never silently dropped)',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.unmappedFieldScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const drained = drainAll(session);
        contractExpectFailure(drained.terminal, 'mapping', 'unmapped_raw_field');
      },
    },
    {
      name: 'entitlement: emission without a declared entitlement is an EntitlementError',
      run: (): void => {
        const session = subject.createSessionWithoutEntitlement(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const drained = drainAll(session);
        contractExpectFailure(drained.terminal, 'entitlement', 'entitlement_undeclared');
        contractAssert(drained.events.length === 0, 'no event may be emitted without a declared entitlement');
      },
    },
    {
      name: 'quartet: every emitted event carries a complete availability quartet (L4)',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const { events } = drainAll(session);
        contractAssert(events.length > 0, 'the valid script must emit events');
        for (const event of events) {
          contractAssert(isTimestampMs(event.event_time), 'event_time must be a valid timestamp');
          contractAssert(event.source_time === null || isTimestampMs(event.source_time), 'source_time must be a valid timestamp or null');
          contractAssert(isTimestampMs(event.available_time), 'available_time must be a valid timestamp');
          contractAssert(isTimestampMs(event.ingestion_time), 'ingestion_time must be a valid timestamp');
          contractAssert(
            event.available_time >= event.event_time,
            'available_time must not precede event_time (information may not be observable before it occurred)',
          );
        }
      },
    },
    {
      name: 'lineage: every emitted event carries a provenance block satisfying the ingestion mirror (L9)',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const { events } = drainAll(session);
        for (const event of events) {
          const errors = validateIngestionProvenance(event.provenance, event.event_id);
          contractAssert(
            errors.length === 0,
            `the provenance block must satisfy the ingestion mirror: ${errors.map((error) => error.message).join('; ')}`,
          );
          contractAssert(
            event.provenance.adapter !== null,
            'emitted records must reference the adapter that delivered them',
          );
          contractAssert(event.entitlement.entitlement_id.length > 0, 'every emitted record carries its entitlement ref');
        }
      },
    },
    {
      name: 'payloads: every emitted payload satisfies its canonical payload validator',
      run: (): void => {
        const session = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const { events } = drainAll(session);
        for (const event of events) {
          const errors = payloadRegistry[event.event_type].validate(event.payload);
          contractAssert(
            errors.length === 0,
            `the payload must satisfy the canonical ${event.event_type} contract: ${errors.map((error) => error.message).join('; ')}`,
          );
        }
      },
    },
    {
      name: 'determinism: the same script emits a byte-identical stream twice',
      run: (): void => {
        const firstSession = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(firstSession.open(), 'open must succeed (first run)');
        contractExpectSuccess(firstSession.subscribe(subject.subscription), 'subscribe must succeed (first run)');
        const first = drainAll(firstSession).events;

        const secondSession = subject.createSession(transportFor(subject.validScript));
        contractExpectSuccess(secondSession.open(), 'open must succeed (second run)');
        contractExpectSuccess(secondSession.subscribe(subject.subscription), 'subscribe must succeed (second run)');
        const second = drainAll(secondSession).events;

        contractAssert(first.length === second.length, 'both runs must emit the same number of events');
        contractExpectJsonEqual(first, second, 'the emission streams must be byte-identical across runs');
      },
    },
    {
      name: 'neutrality: the raw subscription request passes through unmangled',
      run: (): void => {
        const script = subject.validScript;
        const construction = createFakeTransport(script);
        if (!construction.ok) throw new Error('contract violation: invalid script');
        const transport = construction.transport;
        const session = subject.createSession(transport);
        contractExpectSuccess(session.open(), 'open must succeed');
        contractExpectSuccess(session.subscribe(subject.subscription), 'subscribe must succeed');
        const sent = transport.sent();
        contractAssert(sent.length === 1, 'the subscription must produce exactly one outbound request');
        contractExpectJsonEqual(
          { channel: sent[0].channel, payload: sent[0].payload },
          { channel: subject.subscription.channel, payload: subject.subscription.request },
          'the SDK must pass the raw subscription request through the transport unmangled',
        );
      },
    },
  ];
  return cases;
}

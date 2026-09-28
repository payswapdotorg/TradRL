/**
 * @tradrl/provider-sdk — the scripted fake transport: behavioral battery.
 *
 * Determinism of the transport itself: timeline delivery, once-only
 * scripted failures, once-only timeout modeling, send logging, close
 * semantics, script validation.
 */

import { describe, expect, it } from 'vitest';

import { createFakeTransport, emptyScript, type TimestampMs, type JsonObject } from './index';

const at = (value: number): TimestampMs => value as TimestampMs;

function payloadOf(fields: Record<string, unknown>): JsonObject {
  return fields as JsonObject;
}

describe('script validation', () => {
  it('accepts a valid script and freezes it', () => {
    const construction = createFakeTransport({
      inbound: [{ at: at(1), channel: 'c', payload: payloadOf({ a: 1 }) }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    });
    expect(construction.ok).toBe(true);
    if (construction.ok) expect(Object.isFrozen(construction.transport.script)).toBe(true);
  });

  it('rejects out-of-order timelines, duplicate failure indices and bad shapes', () => {
    expect(createFakeTransport({ inbound: [{ at: at(2), channel: 'c', payload: {} }, { at: at(1), channel: 'c', payload: {} }], recv_failures: [], send_failures: [], receive_timeout_ms: null }).ok).toBe(false);
    expect(createFakeTransport({ inbound: [], recv_failures: [{ before_index: 0, message: 'x' }, { before_index: 0, message: 'y' }], send_failures: [], receive_timeout_ms: null }).ok).toBe(false);
    expect(createFakeTransport({ inbound: [], recv_failures: [{ before_index: 5, message: 'x' }], send_failures: [], receive_timeout_ms: null }).ok).toBe(false);
    expect(createFakeTransport({ inbound: [{ at: at(1), channel: '', payload: {} }], recv_failures: [], send_failures: [], receive_timeout_ms: null }).ok).toBe(false);
    expect(createFakeTransport({ inbound: [{ at: at(1), channel: 'c', payload: { bad: NaN } }], recv_failures: [], send_failures: [], receive_timeout_ms: null }).ok).toBe(false);
    expect(createFakeTransport({ inbound: [], recv_failures: [], send_failures: [], receive_timeout_ms: -1 }).ok).toBe(false);
    expect(createFakeTransport('nope').ok).toBe(false);
  });
});

describe('timeline delivery', () => {
  it('delivers messages in order and drains to null', () => {
    const construction = createFakeTransport({
      inbound: [
        { at: at(100), channel: 'a', payload: payloadOf({ n: 1 }) },
        { at: at(200), channel: 'a', payload: payloadOf({ n: 2 }) },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    });
    if (!construction.ok) throw new Error('must construct');
    const transport = construction.transport;

    const first = transport.recv();
    expect(first.ok && first.message?.payload).toEqual({ n: 1 });
    const second = transport.recv();
    expect(second.ok && second.message?.payload).toEqual({ n: 2 });
    const drained = transport.recv();
    expect(drained.ok && drained.message === null).toBe(true);
    expect(drained.ok && drained.message === null).toBe(true); // still drained
    expect(transport.deliveredCount()).toBe(2);
  });

  it('same-time messages are legitimate (non-decreasing, not strictly increasing)', () => {
    const construction = createFakeTransport({
      inbound: [
        { at: at(100), channel: 'a', payload: payloadOf({ n: 1 }) },
        { at: at(100), channel: 'a', payload: payloadOf({ n: 2 }) },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    });
    expect(construction.ok).toBe(true);
  });
});

describe('scripted failures and timeouts', () => {
  it('a recv failure fires once per scripted index and the message stays queued', () => {
    const construction = createFakeTransport({
      inbound: [{ at: at(100), channel: 'a', payload: payloadOf({ n: 1 }) }],
      recv_failures: [{ before_index: 0, message: 'hiccup' }],
      send_failures: [],
      receive_timeout_ms: null,
    });
    if (!construction.ok) throw new Error('must construct');
    const transport = construction.transport;

    const failed = transport.recv();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe('transport');
      expect(failed.error.code).toBe('transport_recv_failed');
    }
    const retry = transport.recv();
    expect(retry.ok && retry.message !== null).toBe(true);
    const again = transport.recv(); // no second failure at the same index
    expect(again.ok && again.message === null).toBe(true);
  });

  it('the timeout fires once per gap and the message stays queued', () => {
    const construction = createFakeTransport({
      inbound: [
        { at: at(1_000), channel: 'a', payload: payloadOf({ n: 1 }) },
        { at: at(10_000), channel: 'a', payload: payloadOf({ n: 2 }) },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: 2_000,
    });
    if (!construction.ok) throw new Error('must construct');
    const transport = construction.transport;

    expect(transport.recv().ok).toBe(true); // no prior gap — no timeout
    const timedOut = transport.recv();
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) {
      expect(timedOut.error.kind).toBe('timeout');
      expect(timedOut.error.code).toBe('receive_timeout');
    }
    const delivered = transport.recv();
    expect(delivered.ok && delivered.message?.payload).toEqual({ n: 2 });
  });

  it('gaps within the budget never time out', () => {
    const construction = createFakeTransport({
      inbound: [
        { at: at(1_000), channel: 'a', payload: payloadOf({ n: 1 }) },
        { at: at(2_500), channel: 'a', payload: payloadOf({ n: 2 }) },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: 2_000,
    });
    if (!construction.ok) throw new Error('must construct');
    expect(construction.transport.recv().ok).toBe(true);
    expect(construction.transport.recv().ok).toBe(true);
  });
});

describe('send logging and close semantics', () => {
  it('records outbound requests verbatim; scripted send failures fire once', () => {
    const construction = createFakeTransport({
      inbound: [],
      recv_failures: [],
      send_failures: [{ on_send_index: 1, message: 'second send fails' }],
      receive_timeout_ms: null,
    });
    if (!construction.ok) throw new Error('must construct');
    const transport = construction.transport;

    const first = transport.send({ channel: 'c', payload: payloadOf({ x: 'raw-request' }) });
    expect(first.ok).toBe(true);
    const second = transport.send({ channel: 'c', payload: payloadOf({ y: 2 }) });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.kind).toBe('transport');
      expect(second.error.code).toBe('transport_send_failed');
    }
    const third = transport.send({ channel: 'c', payload: payloadOf({ z: 3 }) }); // failures fire once per ordinal
    expect(third.ok).toBe(true);
    expect(transport.sent()).toEqual([
      { channel: 'c', payload: payloadOf({ x: 'raw-request' }) },
      { channel: 'c', payload: payloadOf({ z: 3 }) },
    ]);
  });

  it('closed ports refuse send and recv typed', () => {
    const construction = createFakeTransport(emptyScript());
    if (!construction.ok) throw new Error('must construct');
    const transport = construction.transport;
    transport.close();
    expect(transport.isClosed()).toBe(true);
    const sent = transport.send({ channel: 'c', payload: payloadOf({}) });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error.code).toBe('transport_unavailable');
    const received = transport.recv();
    expect(received.ok).toBe(false);
    if (!received.ok) expect(received.error.code).toBe('transport_unavailable');
  });

  it('port close is idempotent (the session enforces the lifecycle, not the port)', () => {
    const construction = createFakeTransport(emptyScript());
    if (!construction.ok) throw new Error('must construct');
    expect(() => {
      construction.transport.close();
      construction.transport.close();
    }).not.toThrow();
  });
});

describe('transport determinism', () => {
  it('two transports built from the same script behave identically', () => {
    const script = {
      inbound: [
        { at: at(1), channel: 'a', payload: payloadOf({ n: 1 }) },
        { at: at(2), channel: 'a', payload: payloadOf({ n: 2 }) },
      ],
      recv_failures: [{ before_index: 1, message: 'x' }],
      send_failures: [],
      receive_timeout_ms: 5,
    };
    const run = (): string => {
      const construction = createFakeTransport(script);
      if (!construction.ok) throw new Error('must construct');
      const transport = construction.transport;
      transport.send({ channel: 'a', payload: payloadOf({ sub: true }) });
      const log: unknown[] = [
        transport.recv(),
        transport.recv(),
        transport.recv(),
        transport.recv(),
        transport.sent(),
      ];
      return JSON.stringify(log);
    };
    expect(run()).toBe(run());
  });
});

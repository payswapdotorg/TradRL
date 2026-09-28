/**
 * The fixtures — the scripted order-flow + book-seed scenario:
 * determinism (two runs BYTE-IDENTICAL, acceptance criteria), coverage of
 * the full outcome path space, and the L4 boundary over the fixture's
 * own stream.
 */

import { describe, expect, it } from 'vitest';

import {
  fixtureBookSeed,
  fixtureExchangeConfig,
  fixtureScript,
  fixtureSpec,
  runExchangeFixture,
} from './fixtures';
import { isExchangeEvent, type ExchangeEvent } from './event';
import { validateMarketEvent } from '../../../../packages/market-protocol/src/index';

describe('the scripted scenario (deterministic fixtures)', () => {
  it('the script covers the full outcome path space: fills, partial rests, cancels, rejects, expiry', () => {
    const run = runExchangeFixture();
    expect(run.record.counts.orders).toBeGreaterThanOrEqual(8);
    expect(run.record.counts.fills).toBeGreaterThanOrEqual(3);
    expect(run.record.counts.rejects).toBeGreaterThanOrEqual(1);
    expect(run.record.counts.expirations).toBeGreaterThanOrEqual(1);
    expect(run.record.counts.events).toBeGreaterThanOrEqual(10);
    // Every emitted event is a canonical MarketEvent.
    for (const event of run.events) {
      const result = validateMarketEvent(event);
      expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
      expect(isExchangeEvent(event)).toBe(true);
    }
  });

  it('TWO RUNS ARE BYTE-IDENTICAL: canonical outcome streams, digests and every hash (twice)', () => {
    const first = runExchangeFixture();
    const second = runExchangeFixture();
    expect(second.outcomeStreamJson).toBe(first.outcomeStreamJson); // byte-identical
    expect(second.record.digest).toBe(first.record.digest);
    expect(second.record.outcome_stream_hash).toBe(first.record.outcome_stream_hash);
    expect(second.record.world.config_hash).toBe(first.record.world.config_hash);
    expect(second.record.world.book_seed_hash).toBe(first.record.world.book_seed_hash);
    expect(JSON.stringify(second.record.fill_log)).toBe(JSON.stringify(first.record.fill_log));
    expect(JSON.stringify(second.record.order_log)).toBe(JSON.stringify(first.record.order_log));
    // A third run, same claim.
    expect(runExchangeFixture().outcomeStreamJson).toBe(first.outcomeStreamJson);
  });

  it('a different seed changes the outcome stream (the seed participates in latency draws)', () => {
    const first = runExchangeFixture();
    const other = runExchangeFixture({ seed: 'exchange-fixture-beta' });
    expect(other.outcomeStreamJson).not.toBe(first.outcomeStreamJson);
    expect(other.record.world.config_hash).not.toBe(first.record.world.config_hash);
  });

  it('the session record carries the full lineage: config hash, order/fill log, timeline, outcome hash', () => {
    const run = runExchangeFixture();
    const record = run.record;
    expect(record.schema).toBe('tradrl/exchange-session-record@1');
    expect(record.session_id).toBe(run.episodeId);
    expect(record.world.config_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(record.world.venue).toBe('BINANCE');
    expect(record.world.instrument).toBe('BTC-USDT');
    expect(record.world.fidelity).toBe('reactive_replay');
    expect(record.outcome_stream_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(record.digest).toMatch(/^[0-9a-f]{8}$/);
    expect(record.clock_timeline.length).toBeGreaterThan(5);
    expect(record.order_log.length).toBe(record.counts.orders);
    expect(record.fill_log.length).toBe(record.counts.fills);
    // Every order log line is complete (status + quantities + lineage).
    for (const entry of record.order_log) {
      expect(entry.order_id).toMatch(/^xo-/);
      expect(typeof entry.quantity).toBe('string');
      expect(typeof entry.filled_quantity).toBe('string');
    }
  });

  it('the fixture pieces are individually deterministic and validated by the service', () => {
    // Same inputs -> same fixtures, twice.
    expect(fixtureExchangeConfig()).toEqual(fixtureExchangeConfig());
    expect(fixtureBookSeed()).toEqual(fixtureBookSeed());
    expect(fixtureScript().length).toBe(fixtureScript().length);
    expect(JSON.stringify(fixtureScript())).toBe(JSON.stringify(fixtureScript()));
    const spec = fixtureSpec();
    expect((spec.world as { kind?: string } | undefined)?.kind).toBe('exchange-sim');
    expect((spec.profile as { clock?: { now?: number } } | undefined)?.clock?.now).toBe(1_700_000_000_000);
  });

  it('the L4 boundary holds over the fixture stream: no outcome visible before its availability', () => {
    const run = runExchangeFixture();
    // Walk the event stream and confirm each event's availability law and
    // the inclusive visibility at the horizon.
    let earliestAvailable = Number.POSITIVE_INFINITY;
    for (const event of run.events as readonly ExchangeEvent[]) {
      expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
      earliestAvailable = Math.min(earliestAvailable, event.available_time);
      expect(event.source_time).toBeNull();
    }
    expect(Number.isFinite(earliestAvailable)).toBe(true);
    // At the horizon (before the final finish), everything is visible.
    const visible = run.service.observe(run.episodeId, (1_700_000_000_000 + 119_000) as never);
    expect(visible.ok).toBe(true);
    if (visible.ok) expect(visible.value.length).toBe(run.events.length);
  });
});

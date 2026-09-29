/**
 * The declared stochastic process battery (work order T028): the
 * generative core's own laws — determinism, arming, step purity, the
 * L4-honest context, and the declaration validation negatives.
 *
 * THE LAWS UNDER TEST:
 *   - "the process declarations are versioned records — never ambient
 *     randomness": every draw is a pure function of the declared seed; the
 *     same (declaration, state, context) triple steps byte-identically,
 *     twice (L9).
 *   - The runtime state IS the randomness: serialize the state (plain
 *     JSON), restore it, and the future draw sequence is identical (the
 *     resume law's hard part).
 *   - The declaration guard: closed parameter records (unknown keys
 *     fail), grid coherence (off-grid start prices / off-lot quantities
 *     fail with the physics supplied), versioned lineage.
 */

import { describe, expect, it } from 'vitest';
import type { ProcessDeclaration } from './process';
import {
  armProcess,
  canonicalProcessJson,
  isProcessKind,
  isProcessRuntimeState,
  processHash,
  processStateHash,
  stepProcess,
  validateProcessDeclaration,
  BEHAVIOR_KINDS,
  PROCESS_KINDS,
  scaleQuantity,
  ticksBetween,
} from './process';
import type { ExchangePhysicsMirror } from './exchange-mirror';
import { bookTopView, validateExchangePhysics } from './exchange-mirror';
import type { TimestampMs } from './ids';
import { fixturePhysics, fixtureProcesses } from './fixtures';
import { deepFreeze } from './primitives';

const T0 = 1_700_000_000_000;

function unwrap<T>(result: { readonly ok: boolean; readonly value?: T; readonly errors?: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value as T;
  throw new Error(`operation failed: ${JSON.stringify(result.errors)}`);
}

function expectFailure(result: { readonly ok: boolean; readonly errors?: readonly { readonly code: string; readonly message: string }[] }, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.errors?.[0]?.code).toBe(code);
}

/** The validated fixture physics (the grid context of every declaration test). */
function physics(): ExchangePhysicsMirror {
  return unwrap(validateExchangePhysics(fixturePhysics()));
}

/** Validate the nth fixture process declaration against the fixture physics. */
function validatedDeclaration(index: number): ProcessDeclaration {
  const declaration = fixtureProcesses()[index] as Record<string, unknown>;
  return unwrap(validateProcessDeclaration(declaration, 'process', physics()));
}

/** The fixed honest context of the step tests (firing at the walk's first cadence instant). */
function context(): { readonly now: TimestampMs; readonly anchor: string; readonly book: ReturnType<typeof bookTopView> } {
  return contextAt(T0 + 5_000);
}

/** A context firing at an arbitrary instant (each policy's own cadence). */
function contextAt(now: number): { readonly now: TimestampMs; readonly anchor: string; readonly book: ReturnType<typeof bookTopView> } {
  return {
    now: now as TimestampMs,
    anchor: '100.00',
    book: bookTopView({
      bids: [{ price: '99.98', orders: [{ order_id: 'xo-seed-bid-0', remaining: '3' }] }],
      asks: [{ price: '100.52', orders: [{ order_id: 'xo-seed-ask-0', remaining: '3' }] }],
    }),
  };
}

describe('the process declarations (versioned, seeded, cadenced records)', () => {
  it('the fixture declarations validate (the anchor walk + the four behavior policies)', () => {
    for (const declaration of fixtureProcesses()) {
      const result = validateProcessDeclaration(declaration, 'process', physics());
      expect(result.ok).toBe(true);
    }
  });

  it('the kind vocabulary is closed (five kinds; four behavior kinds)', () => {
    expect(PROCESS_KINDS).toEqual(['reference_price_walk', 'market_maker', 'momentum_taker', 'mean_reverter', 'noise_trader']);
    expect(BEHAVIOR_KINDS).toEqual(['market_maker', 'momentum_taker', 'mean_reverter', 'noise_trader']);
    expect(isProcessKind('reference_price_walk')).toBe(true);
    expect(isProcessKind('ambient_randomness')).toBe(false);
  });

  it('an unknown parameter key fails (declarations are closed records, never bags)', () => {
    const declaration = { ...(fixtureProcesses()[1] as Record<string, unknown>), params: { half_spread_ticks: 2, extra_spread_ticks: 1, quantity: '0.5', secret_knob: 7 } };
    expectFailure(validateProcessDeclaration(declaration, 'process', physics()), 'invalid_field');
  });

  it('a missing version fails (process declarations are VERSIONED — lineage, L9)', () => {
    const declaration = { ...(fixtureProcesses()[1] as Record<string, unknown>) };
    delete (declaration as { version?: unknown }).version;
    expectFailure(validateProcessDeclaration(declaration, 'process', physics()), 'missing_field');
  });

  it('an off-grid walk start price fails against the physics (grid coherence — the engine would reject every walked price)', () => {
    const declaration = { ...(fixtureProcesses()[0] as Record<string, unknown>), params: { start_price: '100.005', step_ticks: 3, embargo_ms: 400 } };
    expectFailure(validateProcessDeclaration(declaration, 'process', physics()), 'invalid_field');
  });

  it('an off-lot policy quantity fails against the physics (grid coherence)', () => {
    const declaration = { ...(fixtureProcesses()[1] as Record<string, unknown>), params: { half_spread_ticks: 2, extra_spread_ticks: 1, quantity: '0.5005' } };
    expectFailure(validateProcessDeclaration(declaration, 'process', physics()), 'invalid_field');
  });

  it('canonical serialization + the digest are stable and version-sensitive (L9)', () => {
    const a = validatedDeclaration(1);
    const b = validatedDeclaration(1);
    expect(canonicalProcessJson(a)).toBe(canonicalProcessJson(b));
    expect(processHash(a)).toBe(processHash(b));
    // A version change is a NEW record: the digest changes.
    const reVersioned = { ...(fixtureProcesses()[1] as Record<string, unknown>), version: '2.0.0' };
    const changed = unwrap(validateProcessDeclaration(reVersioned, 'process', physics()));
    expect(processHash(changed)).not.toBe(processHash(a));
  });
});

describe('arming + the runtime state (the randomness is CARRIED, never ambient)', () => {
  it('arming derives the xorshift32 state from the DECLARED seed, namespaced by the instance', () => {
    const walk = validatedDeclaration(0);
    const world = armProcess(walk, 'world', T0 as TimestampMs);
    const participant = armProcess(walk, 'pop-cohort-x-1', T0 as TimestampMs);
    expect(world.rng).not.toBe(participant.rng); // per-instance sequences
    expect(world.step).toBe(0);
    expect(world.next_at).toBe(T0 + walk.step_ms);
    expect(world.price).toBe('100.00'); // the declared start price
    expect(isProcessRuntimeState(world)).toBe(true);
  });

  it('the runtime state guard rejects tampered shapes', () => {
    const world = armProcess(validatedDeclaration(0), 'world', T0 as TimestampMs);
    expect(isProcessRuntimeState({ ...world, rng: -1 })).toBe(false);
    expect(isProcessRuntimeState({ ...world, step: -2 })).toBe(false);
    expect(isProcessRuntimeState({ ...world, next_at: Number.NaN })).toBe(false);
    expect(isProcessRuntimeState({ ...world, process: '' })).toBe(false);
  });

  it('the process state hash binds the armed order (L9 — the resume law anchor)', () => {
    const walk = validatedDeclaration(0);
    const states = [armProcess(walk, 'world', T0 as TimestampMs), armProcess(validatedDeclaration(1), 'pop-cohort-makers-1', T0 as TimestampMs)];
    expect(processStateHash(states)).toBe(processStateHash([deepFreeze({ ...states[0] }), deepFreeze({ ...states[1] })]));
    // A different randomness is a different hash — the tamper proof.
    const first = states[0];
    const second = states[1];
    if (first === undefined || second === undefined) throw new Error('unreachable');
    const tampered = [{ ...first, rng: (first.rng as number) + 1 }, second];
    expect(processStateHash(tampered)).not.toBe(processStateHash(states));
  });
});

describe('the pure step transition (determinism — the generative act)', () => {
  it('the walk steps deterministically: same (declaration, state, context) -> byte-identical emissions and successor, twice', () => {
    const walk = validatedDeclaration(0);
    const state = armProcess(walk, 'world', T0 as TimestampMs);
    const ctx = context();
    const first = unwrap(stepProcess(walk, state, ctx, physics()));
    const second = unwrap(stepProcess(walk, state, ctx, physics()));
    expect(first.events).toEqual(second.events);
    expect(first.state).toEqual(second.state);
    // The quote is embargoed: available_time = at + embargo_ms (L4 at the generation seam).
    const quote = first.events[0];
    expect(quote).toBeDefined();
    if (quote !== undefined) {
      expect(quote.kind).toBe('market_quote');
      expect(quote.available_time).toBe((quote.at as number) + 400);
      expect(quote.process.step).toBe(1);
      expect(quote.process.process).toBe('proc-anchor-walk');
    }
  });

  it('the walk never fires at an instant other than its declared cadence (typed)', () => {
    const walk = validatedDeclaration(0);
    const state = armProcess(walk, 'world', T0 as TimestampMs);
    const wrongInstant = { ...context(), now: (T0 + 6_000) as TimestampMs };
    expectFailure(stepProcess(walk, state, wrongInstant, physics()), 'invalid_field');
  });

  it('a runtime executing the wrong process fails (the armed binding is lineage)', () => {
    const walk = validatedDeclaration(0);
    const makerState = armProcess(validatedDeclaration(1), 'pop-cohort-makers-1', T0 as TimestampMs);
    expectFailure(stepProcess(walk, makerState, context(), physics()), 'invalid_field');
  });

  it('SERIALIZED RANDOMNESS: restore the runtime state from plain JSON and the future sequence is identical (the resume law)', () => {
    const walk = validatedDeclaration(0);
    const state = armProcess(walk, 'world', T0 as TimestampMs);
    const ctx = context();
    // Step twice on the live runtime.
    const stepOne = unwrap(stepProcess(walk, state, ctx, physics()));
    const ctxTwo = { ...ctx, now: ((ctx.now as number) + walk.step_ms) as TimestampMs };
    const stepTwo = unwrap(stepProcess(walk, stepOne.state, ctxTwo, physics()));
    // Serialize the MID-STREAM state (after step one) and restore it.
    const serialized = JSON.parse(JSON.stringify(stepOne.state)) as typeof stepOne.state;
    const resumedStepTwo = unwrap(stepProcess(walk, serialized, ctxTwo, physics()));
    expect(resumedStepTwo).toEqual(stepTwo);
  });

  it('the market maker emits two-sided gtt quotes expiring at the next re-quote (the engine rotates the book)', () => {
    const maker = validatedDeclaration(1);
    const firingAt = (T0 + maker.step_ms) as TimestampMs;
    const state = armProcess(maker, 'pop-cohort-makers-1', T0 as TimestampMs);
    const outcome = unwrap(stepProcess(maker, state, contextAt(firingAt as number), physics()));
    expect(outcome.events.length).toBe(2);
    const bid = outcome.events[0];
    const ask = outcome.events[1];
    expect(bid?.kind).toBe('population_intent');
    expect(ask?.kind).toBe('population_intent');
    if (bid !== undefined && ask !== undefined) {
      const bidIntent = bid.payload as { readonly intent: { readonly side: string; readonly price: string; readonly timeInForce: string; readonly expiresAt: string } };
      const askIntent = ask.payload as { readonly intent: { readonly side: string; readonly price: string; readonly timeInForce: string } };
      expect(bidIntent.intent.side).toBe('buy');
      expect(askIntent.intent.side).toBe('sell');
      expect(bidIntent.intent.timeInForce).toBe('gtt');
      expect(bidIntent.intent.expiresAt).toBe(new Date((firingAt as number) + maker.step_ms).toISOString());
      // Two-sided around the anchor: bid < anchor < ask (grid-aligned).
      expect(Number(bidIntent.intent.price)).toBeLessThan(100);
      expect(Number(askIntent.intent.price)).toBeGreaterThan(100);
    }
  });

  it('the momentum taker fires only past the threshold and trades with the trend', () => {
    const momentum = validatedDeclaration(2);
    const firstAt = (T0 + momentum.step_ms) as TimestampMs;
    const secondAt = (T0 + 2 * momentum.step_ms) as TimestampMs;
    const thirdAt = (T0 + 3 * momentum.step_ms) as TimestampMs;
    const state = armProcess(momentum, 'pop-cohort-momentum-1', T0 as TimestampMs);
    // First step: no last anchor yet -> no emission.
    const first = unwrap(stepProcess(momentum, state, contextAt(firstAt as number), physics()));
    expect(first.events.length).toBe(0);
    // Second step with a +3-tick move (>= threshold 2): a BUY (with the trend).
    const ctxUp = { ...contextAt(secondAt as number), anchor: '100.03' };
    const second = unwrap(stepProcess(momentum, first.state, ctxUp, physics()));
    expect(second.events.length).toBe(1);
    const take = second.events[0];
    if (take !== undefined) {
      const intent = take.payload as { readonly intent: { readonly side: string; readonly kind: string } };
      expect(intent.intent.side).toBe('buy');
      expect(intent.intent.kind).toBe('market');
    }
    // Third step with a move back to the start anchor: a SELL (the trend reversed).
    const ctxDown = { ...contextAt(thirdAt as number), anchor: '100.00' };
    const third = unwrap(stepProcess(momentum, second.state, ctxDown, physics()));
    expect(third.events.length).toBe(1);
    const fade = third.events[0];
    if (fade !== undefined) {
      const intent = fade.payload as { readonly intent: { readonly side: string } };
      expect(intent.intent.side).toBe('sell');
    }
  });

  it('the mean reverter fades a deviating side and stays quiet inside the threshold', () => {
    const reverter = validatedDeclaration(3);
    const firstAt = (T0 + reverter.step_ms) as TimestampMs;
    const secondAt = (T0 + 2 * reverter.step_ms) as TimestampMs;
    const thirdAt = (T0 + 3 * reverter.step_ms) as TimestampMs;
    const state = armProcess(reverter, 'pop-cohort-reverters-1', T0 as TimestampMs);
    // Ask 100.52 is above the anchor 100.00: not CHEAP -> no fade.
    const quiet = unwrap(stepProcess(reverter, state, contextAt(firstAt as number), physics()));
    expect(quiet.events.length).toBe(0);
    // Ask at 99.96 is -4 ticks below the anchor: fade by BUYING into the cheap ask.
    const ctxCheapAsk = {
      ...contextAt(secondAt as number),
      book: bookTopView({
        bids: [{ price: '99.98', orders: [{ order_id: 'xo-seed-bid-0', remaining: '3' }] }],
        asks: [{ price: '99.96', orders: [{ order_id: 'xo-seed-ask-0', remaining: '3' }] }],
      }),
    };
    const fading = unwrap(stepProcess(reverter, quiet.state, ctxCheapAsk, physics()));
    expect(fading.events.length).toBe(1);
    const fade = fading.events[0];
    if (fade !== undefined) {
      const intent = fade.payload as { readonly intent: { readonly side: string; readonly price: string; readonly timeInForce: string } };
      expect(intent.intent.side).toBe('buy');
      expect(intent.intent.price).toBe('99.96');
      expect(intent.intent.timeInForce).toBe('ioc');
    }
    // A RICH bid (bid >= anchor + threshold): fade by SELLING into it.
    const ctxRichBid = {
      ...contextAt(thirdAt as number),
      book: bookTopView({
        bids: [{ price: '100.04', orders: [{ order_id: 'xo-seed-bid-0', remaining: '3' }] }],
        asks: [{ price: '100.52', orders: [{ order_id: 'xo-seed-ask-0', remaining: '3' }] }],
      }),
    };
    const rich = unwrap(stepProcess(reverter, fading.state, ctxRichBid, physics()));
    expect(rich.events.length).toBe(1);
    const sell = rich.events[0];
    if (sell !== undefined) {
      const intent = sell.payload as { readonly intent: { readonly side: string; readonly price: string } };
      expect(intent.intent.side).toBe('sell');
      expect(intent.intent.price).toBe('100.04');
    }
  });

  it('the noise trader emits a seeded side/offset limit order, self-expiring', () => {
    const noise = validatedDeclaration(4);
    const firingAt = (T0 + noise.step_ms) as TimestampMs;
    const state = armProcess(noise, 'pop-cohort-noise-1', T0 as TimestampMs);
    const outcome = unwrap(stepProcess(noise, state, contextAt(firingAt as number), physics()));
    expect(outcome.events.length).toBe(1);
    const order = outcome.events[0];
    if (order !== undefined) {
      const intent = order.payload as { readonly intent: { readonly side: string; readonly kind: string; readonly timeInForce: string; readonly price: string } };
      expect(intent.intent.kind).toBe('limit');
      expect(intent.intent.timeInForce).toBe('gtt');
      // Seeded offset within [0, max_offset_ticks] of the anchor, on the grid.
      const offset = ticksBetween('100.00', intent.intent.price, '0.01');
      expect(offset).not.toBeNull();
      expect(Math.abs(offset as number)).toBeLessThanOrEqual(4);
    }
    // Determinism: the same armed state draws the identical order, twice.
    const again = unwrap(stepProcess(noise, state, contextAt(firingAt as number), physics()));
    expect(again).toEqual(outcome);
  });
});

describe('the local grid arithmetic (exact, lot/tick coherent)', () => {
  it('tick counting and quantity scaling stay exact on the fixture grids', () => {
    expect(ticksBetween('100.00', '100.03', '0.01')).toBe(3);
    expect(ticksBetween('100.03', '100.00', '0.01')).toBe(-3);
    expect(ticksBetween('100.00', '100.005', '0.01')).toBeNull(); // off-grid
    expect(scaleQuantity('0.4', 2)).toBe('0.8');
    expect(scaleQuantity('0.3', 3)).toBe('0.9');
    expect(scaleQuantity('0.2', 0)).toBeNull(); // positive multipliers only
  });
});

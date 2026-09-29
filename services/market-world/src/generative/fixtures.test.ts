/**
 * The GOLDEN WORLD EVOLUTION battery (work order T028, acceptance
 * criteria 3, 8, 9): byte-identical determinism (twice), the interleaving
 * contrasts (the declared policy is part of the deterministic function),
 * and resumability (serialize -> parse -> resume continues identically —
 * INCLUDING the stochastic process states mid-stream; tamper =
 * chain_mismatch) — all over the REAL exchange-sim engine bound through
 * the injected driver port.
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../../packages/exchange-sim/src/index';
import type { EngineDriver, EngineStateMirror, SubmitOutcomeMirror, CancelOutcomeMirror, AdvanceOutcomeMirror, EngineOpResult } from './exchange-mirror';
import { runGenerativeFixture, resumeGenerativeFixture } from './fixtures';
import type { GenerativeFixtureRun } from './fixtures';
import { deserializeGenerativeRunState, requireGeneratedEvent, requireGenerativeFill, serializeGenerativeRunState } from './records';
import type { GenerativeRunRecord, GenerativeRunState } from './records';
import { processStateHash } from './process';

const T0 = 1_700_000_000_000;

/** The REAL engine binding (the mirror seam — see service.test.ts for the witnesses). */
function realEngineDriver(): EngineDriver {
  type RealEngineState = Parameters<typeof exchangeSim.submitOrder>[0];
  return {
    createEngine: (config, init) => exchangeSim.createEngine(config, init) as EngineOpResult<EngineStateMirror>,
    submitOrder: (state, intent, at) => exchangeSim.submitOrder(state as unknown as RealEngineState, intent, at) as EngineOpResult<SubmitOutcomeMirror>,
    cancelOrder: (state, reference, at) => exchangeSim.cancelOrder(state as unknown as RealEngineState, reference, at) as EngineOpResult<CancelOutcomeMirror>,
    advanceEngine: (state, to) => exchangeSim.advanceEngine(state as unknown as RealEngineState, to) as EngineOpResult<AdvanceOutcomeMirror>,
  };
}

function unwrap<T>(result: { readonly ok: boolean; readonly value?: T; readonly errors?: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value as T;
  throw new Error(`operation failed: ${JSON.stringify(result.errors)}`);
}

function expectFailure(result: { readonly ok: boolean; readonly errors?: readonly { readonly code: string; readonly message: string }[] }, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.errors?.[0]?.code).toBe(code);
}

// ---------------------------------------------------------------------------
// Criterion 3 — the golden determinism (byte-identical, twice)
// ---------------------------------------------------------------------------

const runA: GenerativeFixtureRun = await runGenerativeFixture(realEngineDriver());
const runB: GenerativeFixtureRun = await runGenerativeFixture(realEngineDriver());

describe('the golden world evolution (criterion 3 — deterministic, byte-identical, twice)', () => {
  it('the full scenario exercises the engine: fills exist from the candidate AND the generated population', () => {
    expect(runA.fills.length).toBeGreaterThanOrEqual(2);
    const participants = new Set(runA.fills.map((fill) => fill.taker_participant));
    expect(participants.has('agent-candidate-alpha')).toBe(true);
    expect([...participants].some((participant) => participant.startsWith('pop-cohort-'))).toBe(true);
  });

  it('every fill passes the total physics-lineage guard; every generated event passes the total lineage guard', () => {
    for (const fill of runA.fills) {
      expect(unwrap(requireGenerativeFill(fill))).toBe(fill);
    }
    for (const event of runA.generatedEvents) {
      expect(unwrap(requireGeneratedEvent(event))).toBe(event);
    }
  });

  it('same (population spec, processes, seed, action script, physics, clock) -> BYTE-IDENTICAL evolution: engine state, fills, generated events, observations (deep-equal, twice)', () => {
    expect(runA.evolutionJson).toBe(runB.evolutionJson);
    expect(runA.engineState).toEqual(runB.engineState);
    expect(runA.fills).toEqual(runB.fills);
    expect(runA.generatedEvents).toEqual(runB.generatedEvents);
    expect(runA.observations).toEqual(runB.observations);
  });

  it('the engine state hash and the PROCESS STATE hash are stable across runs (the byte-identity anchors)', () => {
    expect(unwrap(runA.service.engineStateHash(runA.episodeId))).toBe(unwrap(runB.service.engineStateHash(runB.episodeId)));
    expect(unwrap(runA.service.processStateHash(runA.episodeId))).toBe(unwrap(runB.service.processStateHash(runB.episodeId)));
  });

  it('the run records are deeply equal with identical digests (L9 — identical runs, identical records)', () => {
    const recordA = runA.record;
    const recordB = runB.record;
    if (recordA === null || recordB === null) throw new Error('unreachable');
    expect(recordA).toEqual(recordB);
    expect(recordA.digest).toBe(recordB.digest);
    expect(recordA.generation.chain_head).toBe(recordB.generation.chain_head);
    expect(recordA.generation.process_state_hash).toBe(recordB.generation.process_state_hash);
    expect(recordA.engine.engine_state_hash).toBe(recordB.engine.engine_state_hash);
  });

  it('the hashes inside the record equal the live service hashes (the record never lies)', () => {
    const record = runA.record;
    if (record === null) throw new Error('unreachable');
    expect(record.engine.engine_state_hash).toBe(unwrap(runA.service.engineStateHash(runA.episodeId)));
    expect(record.generation.process_state_hash).toBe(unwrap(runA.service.processStateHash(runA.episodeId)));
  });

  it('a DIFFERENT seed changes the evolution (the golden run is a function of its inputs, not a constant)', async () => {
    const other = await runGenerativeFixture(realEngineDriver(), { seed: 'generative-fixture-beta' });
    expect(other.evolutionJson).not.toBe(runA.evolutionJson);
    expect(other.record?.digest).not.toBe(runA.record?.digest);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — the declared interleaving policy is material
// ---------------------------------------------------------------------------

describe('the declared interleaving policy (criterion 8 — the order is part of the deterministic function)', () => {
  it('the observation stream orders differently under processes_first vs population_first (the policy is material)', async () => {
    const first = await runGenerativeFixture(realEngineDriver(), { interleaving: 'processes_first' });
    const populationFirst = await runGenerativeFixture(realEngineDriver(), { interleaving: 'population_first' });
    expect(first.observations).not.toEqual(populationFirst.observations);
    // The material difference: the boundary's quote rides BEFORE vs AFTER the
    // boundary's engine outcomes in the delivery stream.
    const kindsFirst = first.observations.map((observation) => observation.payload as { readonly kind?: string }).map((payload) => payload.kind ?? 'market_quote');
    const kindsPopulation = populationFirst.observations.map((observation) => observation.payload as { readonly kind?: string }).map((payload) => payload.kind ?? 'market_quote');
    expect(kindsFirst.join(',')).not.toBe(kindsPopulation.join(','));
  });

  it('the ENGINE evolution is policy-invariant here (the policies order the delivery, not the physics — the run ref differs with the config, the engine records do not)', async () => {
    const first = await runGenerativeFixture(realEngineDriver(), { interleaving: 'processes_first' });
    const populationFirst = await runGenerativeFixture(realEngineDriver(), { interleaving: 'population_first' });
    expect(unwrap(first.service.engineStateHash(first.episodeId))).toBe(unwrap(populationFirst.service.engineStateHash(populationFirst.episodeId)));
    // The ENGINE's own verbatim fill ledger (no run-ref wrapping) is identical.
    expect(first.engineState.fills).toEqual(populationFirst.engineState.fills);
    // The engine's order ledger too (the same intents, the same order).
    expect(first.engineState.orders.length).toBe(populationFirst.engineState.orders.length);
  });

  it('unrestricted ties break like processes_first (the declared tie-break — identical delivery, modulo the policy-dependent run ref)', async () => {
    const first = await runGenerativeFixture(realEngineDriver(), { interleaving: 'processes_first' });
    const unrestricted = await runGenerativeFixture(realEngineDriver(), { interleaving: 'unrestricted' });
    const summary = (observations: readonly { readonly observation_id: string; readonly available_time: number; readonly payload: unknown; readonly provenance: { readonly origin: string } }[]): string =>
      observations.map((observation) => `${observation.observation_id}@${observation.available_time}:${observation.provenance.origin}:${JSON.stringify(observation.payload)}`).join('|');
    expect(summary(unrestricted.observations)).toBe(summary(first.observations));
    expect(unrestricted.engineState.fills).toEqual(first.engineState.fills);
    expect(unrestricted.generatedEvents.length).toBe(first.generatedEvents.length);
  });

  it('each policy still produces a fully-physics-lined fill log (the policy orders, never drops, the physics)', async () => {
    for (const interleaving of ['processes_first', 'population_first', 'unrestricted'] as const) {
      const run = await runGenerativeFixture(realEngineDriver(), { interleaving });
      for (const fill of run.fills) {
        expect(unwrap(requireGenerativeFill(fill))).toBe(fill);
      }
    }
  });

  it('the same policy run twice is byte-identical (each policy is individually deterministic)', async () => {
    const first = await runGenerativeFixture(realEngineDriver(), { interleaving: 'population_first' });
    const second = await runGenerativeFixture(realEngineDriver(), { interleaving: 'population_first' });
    expect(first.evolutionJson).toBe(second.evolutionJson);
    expect(first.record?.digest).toBe(second.record?.digest);
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — resumability (serialize -> parse -> resume, mid-stream processes included)
// ---------------------------------------------------------------------------

describe('resumability (criterion 9 — serialize -> parse -> resume, the stochastic processes mid-stream)', () => {
  it('the stopped run exports a parseable run state mid-episode (process runtimes included)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const parsed = unwrap(deserializeGenerativeRunState(JSON.parse(JSON.stringify(serialized))));
    expect(parsed.process_state_hash).toBe(exported.process_state_hash);
    expect(parsed.generation_chain.length).toBe(exported.generation_chain.length);
    expect(parsed.engine_state_hash).toBe(exported.engine_state_hash);
  });

  it('resume continues identically: the resumed run finishes with the IDENTICAL run record (process states mid-stream)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const portable = JSON.parse(JSON.stringify(serialized)) as GenerativeRunState;
    const resumed = await resumeGenerativeFixture(realEngineDriver(), portable, { stopAfterDriverStep: 2 });
    const reference = runA.record;
    if (resumed.record === null || reference === null) throw new Error('unreachable');
    expect(resumed.record).toEqual(reference);
    expect(resumed.record.digest).toBe(reference.digest);
    expect(resumed.evolutionJson).toBe(runA.evolutionJson);
  });

  it('resume with a TAMPERED generated log fails chain_mismatch (the generation chain is verified)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
    const line = { ...((parsed.episode_line as Record<string, unknown>)) };
    const log = [...((line.generated_log as unknown[]))];
    const first = log[0] as Record<string, unknown>;
    log[0] = { ...first, payload: { ...((first.payload as Record<string, unknown>)), anchor_price: '999.99' } };
    line.generated_log = log;
    parsed.episode_line = line;
    const { resumeGenerativeWorldService } = await import('./service');
    expectFailure(resumeGenerativeWorldService(parsed, { engine: realEngineDriver() }), 'chain_mismatch');
  });

  it('resume with a TAMPERED process state fails chain_mismatch (the stochastic randomness is verified)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
    const line = { ...((parsed.episode_line as Record<string, unknown>)) };
    const states = [...((line.process_states as unknown[]))];
    const first = states[0] as Record<string, unknown>;
    states[0] = { ...first, rng: ((first.rng as number) + 1) % 0x1_0000_0000 };
    line.process_states = states;
    parsed.episode_line = line;
    // The recorded process state hash stays as exported — the restored
    // randomness no longer digests to it (tamper = chain_mismatch).
    const { resumeGenerativeWorldService } = await import('./service');
    expectFailure(resumeGenerativeWorldService(parsed, { engine: realEngineDriver() }), 'chain_mismatch');
  });

  it('resume with a TAMPERED engine state fails chain_mismatch (the engine hash is verified)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
    const line = { ...((parsed.episode_line as Record<string, unknown>)) };
    const engine = { ...((line.engine_state as Record<string, unknown>)), now: (T0 + 123) as number };
    line.engine_state = engine;
    parsed.episode_line = line;
    const { resumeGenerativeWorldService } = await import('./service');
    expectFailure(resumeGenerativeWorldService(parsed, { engine: realEngineDriver() }), 'chain_mismatch');
  });

  it('resume with a process runtime bound to the WRONG process fails chain_mismatch (the armed binding is lineage)', async () => {
    const stopped = await runGenerativeFixture(realEngineDriver(), { stopAfterDriverStep: 2 });
    const exported = stopped.exportedState;
    if (exported === null) throw new Error('unreachable');
    const serialized = unwrap(serializeGenerativeRunState(exported));
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
    const line = { ...((parsed.episode_line as Record<string, unknown>)) };
    const states = [...((line.process_states as unknown[]))];
    const walk = states[0] as Record<string, unknown>;
    states[0] = { ...walk, process: 'proc-maker-mmm' }; // the world runtime executing the maker
    line.process_states = states;
    parsed.episode_line = line;
    const { processStateHash } = await import('./process');
    parsed.process_state_hash = processStateHash(states as never);
    const { resumeGenerativeWorldService } = await import('./service');
    expectFailure(resumeGenerativeWorldService(parsed, { engine: realEngineDriver() }), 'chain_mismatch');
  });

  it('resume from a NON-JSON artifact shape fails invalid_state (the artifact gate)', () => {
    expectFailure(deserializeGenerativeRunState({ schema: 'tradrl/generative-run-state@2', phase: 'episode' }), 'invalid_state');
    expectFailure(deserializeGenerativeRunState(null), 'invalid_state');
  });
});

// ---------------------------------------------------------------------------
// The run record's own invariants over the golden run
// ---------------------------------------------------------------------------

describe('the golden run record invariants', () => {
  const record: GenerativeRunRecord = runA.record as GenerativeRunRecord;

  it('the record declares generative fidelity, binds the config hash + engine hash + process state hash + chain head (L9)', () => {
    expect(record.schema).toBe('tradrl/generative-run-record@1');
    expect(record.world.mode).toBe('generative');
    expect(record.world.config_hash).toBe(runA.service.config_hash);
    expect(record.world.engine_config_hash).toBe(runA.service.engine_config_hash);
    expect(record.generation.events).toBe(runA.generatedEvents.length);
    expect(record.population.candidate).toBe('agent-candidate-alpha');
    expect(record.population.driver_actions).toBe(2); // the two candidate orders
  });

  it('the population block accounts every generated action per cohort (the roster ledger)', () => {
    const makers = record.population.cohorts.find((cohort) => cohort.cohort_id === 'cohort-makers');
    if (makers === undefined) throw new Error('unreachable');
    expect(makers.participants).toBe(1);
    expect(makers.generated_actions).toBe(runA.generatedEvents.filter((event) => event.kind === 'population_intent' && event.actor === 'pop-cohort-makers-1').length);
  });
});

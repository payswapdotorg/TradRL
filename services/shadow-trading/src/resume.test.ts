/**
 * The resume suite: serialize -> parse -> resume is PROVEN (a resumed
 * run finishes with the IDENTICAL session as an uninterrupted run);
 * tampering is DETECTED (the typed `chain_mismatch` and its siblings).
 */

import { describe, expect, it } from 'vitest';
import { createReferenceSession, runReferenceScenario, unwrap, referenceIntentStream, decisionSourceOf, createScriptedWorld, createScriptedMachine, referenceRiskPolicy, referenceMarketEvents, referenceGenesisPortfolio, referenceVenueState, referenceWorldSpec, referenceKillSwitch, referenceExecutionPolicy, TENANT, PROJECT, SEED, PARTICIPANT, T0 } from './fixtures';
import { processShadowDecision, runShadowSession, type ShadowSession } from './session';
import { resumeShadowRunState, serializeShadowRunState, shadowSessionDigest, SHADOW_RUN_STATE_SCHEMA } from './run-state';
import { isDeeplyFrozen } from './primitives';

/** Drive the first N decisions of the golden stream, returning the session + the shared ports. */
function drivePrefix(count: number): { readonly session: ShadowSession; readonly world: ReturnType<typeof createScriptedWorld>; readonly machine: ReturnType<typeof createScriptedMachine> } {
  const world = createScriptedWorld();
  const machine = createScriptedMachine();
  let session = unwrap(createReferenceSession({ world, timeMachine: machine, intents: [] }));
  for (let index = 0; index < count; index++) {
    session = unwrap(processShadowDecision(session, referenceIntentStream()[index]!)).session;
  }
  return { session, world, machine };
}

describe('serialize -> parse -> resume (the proven path)', () => {
  it('a resumed run finishes with the IDENTICAL session as an uninterrupted run', async () => {
    // The uninterrupted reference.
    const uninterrupted = await runReferenceScenario();

    // Half the stream, then serialize -> parse -> resume with the
    // re-supplied deps (the SAME world + machine instances carry the
    // episode + cursor state — the caller restored them).
    const prefix = drivePrefix(3);
    const bytes = unwrap(serializeShadowRunState(prefix.session));
    const resumed = unwrap(
      resumeShadowRunState(bytes, {
        world: prefix.world,
        timeMachine: prefix.machine,
        decisionSource: decisionSourceOf(referenceIntentStream().slice(3)),
      }),
    );
    const finished = unwrap(await runShadowSession(resumed));

    // The resumed run provably consumed the same history and finished
    // identically: same session id, same outcome log, same book, same
    // whole-session digest.
    expect(finished.sessionId).toBe(uninterrupted.sessionId);
    expect(finished.outcomeLog.records.length).toBe(uninterrupted.outcomeLog.records.length);
    expect(finished.outcomeLog).toEqual(uninterrupted.outcomeLog);
    expect(finished.book).toEqual(uninterrupted.book);
    expect(finished.decisions).toEqual(uninterrupted.decisions);
    expect(finished.ticks).toEqual(uninterrupted.ticks);
    expect(shadowSessionDigest(finished)).toBe(shadowSessionDigest(uninterrupted));
    expect(unwrap(serializeShadowRunState(finished))).toBe(unwrap(serializeShadowRunState(uninterrupted)));
  });

  it('the serialization is canonical bytes (deterministic; JSON-round-trippable; frozen state)', async () => {
    const session = await runReferenceScenario();
    const bytes = unwrap(serializeShadowRunState(session));
    expect(bytes.startsWith(`{"schema":"${SHADOW_RUN_STATE_SCHEMA}","session":`)).toBe(true);
    const again = unwrap(serializeShadowRunState(session));
    expect(bytes).toBe(again);
    // The resumed session re-freezes the state deeply.
    const resumed = unwrap(resumeShadowRunState(bytes, { world: session.world, timeMachine: session.timeMachine, decisionSource: decisionSourceOf([]) }));
    expect(isDeeplyFrozen(resumed.outcomeLog)).toBe(true);
  });
});

describe('tamper detection (the typed chain_mismatch)', () => {
  /** Serialize a prefix run and hand back the parsed envelope for mutation. */
  function tamperedBytes(mutate: (envelope: Record<string, unknown>) => void): string {
    const { session } = drivePrefix(3);
    const bytes = unwrap(serializeShadowRunState(session));
    const envelope = JSON.parse(bytes) as Record<string, unknown>;
    mutate(envelope);
    return JSON.stringify(envelope);
  }

  it('invalid JSON is the typed invalid_json', () => {
    const result = resumeShadowRunState('{not json', { world: createScriptedWorld(), timeMachine: createScriptedMachine(), decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_json');
  });

  it('a wrong schema marker is the typed invalid_state', () => {
    const bytes = tamperedBytes((envelope) => {
      envelope.schema = 'tradrl/other@9';
    });
    const result = resumeShadowRunState(bytes, { world: createScriptedWorld(), timeMachine: createScriptedMachine(), decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_state');
  });

  it('an EDITED outcome record fails the outcome chain (chain_mismatch)', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const log = session.outcomeLog as { records: Record<string, unknown>[] };
      log.records[0]!.disposition = 'expired'; // a lie: it was 'filled'
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a REMOVED outcome record fails the outcome chain (chain_mismatch)', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const log = session.outcomeLog as { records: unknown[]; head: string };
      log.records.pop(); // a truncation
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a REORDERED outcome log fails the outcome chain (chain_mismatch)', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const log = session.outcomeLog as { records: Record<string, unknown>[] };
      const [first, second] = log.records as [Record<string, unknown>, Record<string, unknown>];
      log.records[0] = second;
      log.records[1] = first;
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('an EDITED tick record fails the audit chain (chain_mismatch)', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const ticks = session.ticks as Record<string, unknown>[];
      ticks[0]!.cursorPosition = 999; // a forged cursor offset
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a decisions/audit-trail disagreement fails the coherence gate (chain_mismatch)', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const decisions = session.decisions as unknown[];
      decisions.pop(); // a truncated decisions log
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a forged mode claim on the parsed state is the typed fidelity_claim_dishonest', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      session.mode = 'live'; // the forged claim
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('fidelity_claim_dishonest');
  });

  it('a constituent NO chain covers, tampered, fails the session guard (the resume gate\'s final structural layer)', () => {
    // The participant carries no chain: the four chains (kill switch, audit
    // trail, outcome log, tick audit) all pass — only the TOTAL session guard
    // catches the structurally invalid actor binding.
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      session.participant = 123; // not a string — a tampered actor binding
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_state');
    // The same totality over the paper account: a float-mediating book is inexpressible.
    const cashBytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      (session.book as Record<string, unknown>).cash = 123.45;
    });
    const cashResult = resumeShadowRunState(cashBytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(cashResult.ok).toBe(false);
    expect(!cashResult.ok && cashResult.errors[0]?.code).toBe('invalid_state');
  });

  it('a kill-switch log tamper is lifted as chain_mismatch', () => {
    const bytes = tamperedBytes((envelope) => {
      const session = envelope.session as Record<string, unknown>;
      const killSwitch = session.killSwitch as { records: Record<string, unknown>[] };
      killSwitch.records[0]!.state = 'thrown'; // the genesis cannot be thrown
    });
    const { world, machine } = drivePrefix(3);
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('an unknown episode in the re-supplied world is the typed world_error', () => {
    const { session } = drivePrefix(3);
    const bytes = unwrap(serializeShadowRunState(session));
    // A FRESH world: it does not know the episode.
    const result = resumeShadowRunState(bytes, { world: createScriptedWorld(), timeMachine: createScriptedMachine(), decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('world_error');
  });

  it('a machine without the session cursor is the typed machine_error', () => {
    const { session, world } = drivePrefix(3);
    const bytes = unwrap(serializeShadowRunState(session));
    // A FRESH machine: it carries no cursors.
    const result = resumeShadowRunState(bytes, { world, timeMachine: createScriptedMachine(), decisionSource: decisionSourceOf([]) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('machine_error');
  });

  it('a missing decision source is the typed invalid_source', () => {
    const { session, world, machine } = drivePrefix(3);
    const bytes = unwrap(serializeShadowRunState(session));
    const result = resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_source');
  });
});

// ---------------------------------------------------------------------------
// The resume round-trip over the full reference assembly (fresh deps)
// ---------------------------------------------------------------------------

describe('resume over the full reference assembly', () => {
  it('resumes a fresh construction byte-identically (zero decisions)', async () => {
    const world = createScriptedWorld();
    const machine = createScriptedMachine();
    const session = unwrap(createReferenceSession({ world, timeMachine: machine, intents: [] }));
    const bytes = unwrap(serializeShadowRunState(session));
    const resumed = unwrap(resumeShadowRunState(bytes, { world, timeMachine: machine, decisionSource: decisionSourceOf(referenceIntentStream()) }));
    expect(resumed.sessionId).toBe(session.sessionId);
    expect(shadowSessionDigest(resumed)).toBe(shadowSessionDigest(session));
    // And the resumed session can drive the whole golden stream.
    const finished = unwrap(await runShadowSession(resumed));
    expect(finished.outcomeLog.records.length).toBe(7);
  });

  it('the serialized state carries the whole evidence surface', async () => {
    const session = await runReferenceScenario();
    const bytes = unwrap(serializeShadowRunState(session));
    const envelope = JSON.parse(bytes) as { session: Record<string, unknown> };
    const state = envelope.session;
    expect(Array.isArray(state.decisions)).toBe(true);
    expect(Array.isArray(state.evaluations)).toBe(true);
    expect(Array.isArray(state.exposures)).toBe(true);
    expect(Array.isArray(state.refusals)).toBe(true);
    expect(Array.isArray(state.fills)).toBe(true);
    expect(Array.isArray(state.submissions)).toBe(true);
    expect(Array.isArray(state.ticks)).toBe(true);
    expect(Array.isArray(state.processedIntentIds)).toBe(true);
    expect(typeof state.book).toBe('object');
    expect(typeof state.outcomeLog).toBe('object');
    // The injected seams are NOT serialized.
    expect(state.world).toBeUndefined();
    expect(state.timeMachine).toBeUndefined();
    expect(state.decisionSource).toBeUndefined();
  });
});

// (The full reference re-assembly keeps the resume deps explicit.)
void referenceRiskPolicy;
void referenceMarketEvents;
void referenceGenesisPortfolio;
void referenceVenueState;
void referenceWorldSpec;
void referenceKillSwitch;
void referenceExecutionPolicy;
void TENANT;
void PROJECT;
void SEED;
void PARTICIPANT;
void T0;

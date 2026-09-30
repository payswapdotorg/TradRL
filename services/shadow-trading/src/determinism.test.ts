/**
 * The determinism suite: same (decision stream, world inputs,
 * policies, seed) -> byte-identical shadow session — the golden test,
 * RUN TWICE (deep-equal sessions, identical outcome digests, identical
 * serialization bytes, identical session ids).
 */

import { describe, expect, it } from 'vitest';
import { runReferenceScenario, createReferenceSession, unwrap, referenceIntentStream } from './fixtures';
import { processShadowDecision } from './session';
import { serializeShadowRunState, shadowSessionDigest } from './run-state';
import { shadowOutcomeDigest } from './outcomes';
import { GOLDEN_OUTCOME_DIGEST } from './golden';

describe('determinism — the golden run, twice', () => {
  it('two fresh runs produce byte-identical sessions (L9)', async () => {
    const first = await runReferenceScenario();
    const second = await runReferenceScenario();
    expect(first.sessionId).toBe(second.sessionId);
    expect(shadowOutcomeDigest(first.outcomeLog)).toBe(shadowOutcomeDigest(second.outcomeLog));
    expect(shadowSessionDigest(first)).toBe(shadowSessionDigest(second));
    expect(unwrap(serializeShadowRunState(first))).toBe(unwrap(serializeShadowRunState(second)));
    // The structural deep-equality over the whole evidence surface.
    expect(first.decisions).toEqual(second.decisions);
    expect(first.evaluations).toEqual(second.evaluations);
    expect(first.exposures).toEqual(first.exposures);
    expect(second.exposures).toEqual(second.exposures);
    expect(first.fills).toEqual(second.fills);
    expect(first.outcomeLog).toEqual(second.outcomeLog);
    expect(first.book).toEqual(second.book);
    expect(first.ticks).toEqual(second.ticks);
  });

  it('the golden literals hold on every re-run', async () => {
    const session = await runReferenceScenario();
    expect(shadowOutcomeDigest(session.outcomeLog)).toBe(GOLDEN_OUTCOME_DIGEST);
    expect(session.outcomeLog.records.length).toBe(7);
    expect(session.fills.length).toBe(6);
  });

  it('step-by-step replay is identical to the streamed run', async () => {
    const streamed = await runReferenceScenario();
    let manual = unwrap(createReferenceSession());
    for (const intent of referenceIntentStream()) {
      manual = unwrap(processShadowDecision(manual, intent)).session;
    }
    expect(manual.sessionId).toBe(streamed.sessionId);
    expect(shadowSessionDigest(manual)).toBe(shadowSessionDigest(streamed));
    expect(manual.outcomeLog).toEqual(streamed.outcomeLog);
    expect(manual.book).toEqual(streamed.book);
  });

  it('identical inputs construct identical session ids (content-addressed genesis)', () => {
    const first = unwrap(createReferenceSession());
    const second = unwrap(createReferenceSession());
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.warmUp.viewHash).toBe(second.warmUp.viewHash);
  });

  it('every record is deeply frozen (the evidence immutability discipline)', async () => {
    const session = await runReferenceScenario();
    expect(Object.isFrozen(session.outcomeLog.records[0])).toBe(true);
    expect(Object.isFrozen(session.fills[0])).toBe(true);
    expect(Object.isFrozen(session.fills[0]?.worldFill.physics)).toBe(true);
    expect(Object.isFrozen(session.book)).toBe(true);
    expect(Object.isFrozen(session.refusals[0])).toBe(true);
  });
});

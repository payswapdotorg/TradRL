/**
 * @tradrl/learning (service) — the curriculum trail tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden advancement: an evidenced advance cites the verdict +
 *     criteria and lands (acceptance #6's positive);
 *   - THE EVIDENCE GATE NEGATIVES: an advancement without a citation is a
 *     typed `evidence_missing` refusal; a non-attained verdict or an
 *     under-covering citation is `evidence_insufficient` (acceptance #6);
 *   - the refusal record is retained data (L11) — a trail with a refusal
 *     keeps it and the position is unchanged;
 *   - REGRESSION IS LEGAL AND RECORDED: a failed stage sends the
 *     curriculum back; the record stays forever (acceptance #6);
 *   - THE LADDER ORDER: skipping rungs is `ladder_violation`; regressing
 *     upward is `ladder_violation`; a record whose `from` is not the
 *     trail's position is `ladder_violation`; forking is impossible;
 *   - THE STAGE-9 TRAIL GATE: an advance into controlled_live without the
 *     permission record is `live_permission_missing`; with it, it lands;
 *   - L11 APPEND-ONLY: appending returns a NEW trail (the original
 *     untouched); a tampered/truncated trail fails `verifyTrailChain`
 *     with `trail_rewrite`; a time-traveling record is `trail_rewrite`;
 *   - serialization/resume: canonical bytes, byte-stable, chain-verified
 *     on resume;
 *   - L12: a foreign-lineage record is `tenant_scope_mismatch`.
 */

import { describe, expect, it } from 'vitest';

import {
  appendTransition,
  enterCurriculum,
  evidencedAdvance,
  openCurriculumTrail,
  recordedRefusal,
  recordedRegression,
  resumeCurriculumTrail,
  serializeCurriculumTrail,
  trailPosition,
  verifyTrailChain,
} from './trail';
import {
  GOLDEN_LIVE_PERMISSION,
  GOLDEN_T0,
  GOLDEN_T1,
  GOLDEN_T2,
  GOLDEN_T3,
  goldenAdvancementTrail,
  goldenCitation,
  goldenCurriculumVersion,
  goldenEntry,
  goldenRefusalTrail,
  goldenRegressionTrail,
  goldenStageCriteria,
  goldenTrailBytes,
  goldenTrailLineage,
} from './fixtures';

describe('the golden advancement trail', () => {
  it('enters at the bottom rung and advances one evidenced rung', () => {
    const trail = goldenAdvancementTrail();
    expect(trail.records.length).toBe(2);
    expect(trail.records[0]?.kind).toBe('entry');
    expect(trail.records[0]?.to).toBe('synthetic_regimes');
    expect(trail.records[1]?.kind).toBe('advance');
    expect(trail.records[1]?.from).toBe('synthetic_regimes');
    expect(trail.records[1]?.to).toBe('historical_replay');
    expect(trail.records[1]?.evidence?.verdict).toBe('verdict-golden-historical_replay');
    expect(trail.records[1]?.evidence?.attained).toBe(true);
    expect(trailPosition(trail)).toBe('historical_replay');
    // The chain verifies.
    expect(verifyTrailChain(trail)).toEqual({ ok: true, value: true });
  });

  it('is deterministic: the golden bytes are byte-stable across constructions', () => {
    expect(goldenTrailBytes()).toBe(goldenTrailBytes());
    const again = serializeCurriculumTrail(goldenAdvancementTrail());
    if (!again.ok) throw new Error(JSON.stringify(again.errors));
    expect(again.value).toBe(goldenTrailBytes());
  });
});

describe('the evidence gate (advancement is evidence-gated)', () => {
  it('refuses an advancement without a citation (the named negative)', () => {
    const result = evidencedAdvance(
      'synthetic_regimes',
      null, // NO evidence — the typed refusal
      goldenStageCriteria('historical_replay'),
      GOLDEN_T1,
      goldenTrailLineage(),
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('evidence_missing');
      expect(result.errors[0]?.message).toContain('evidence-gated');
    }
  });

  it('refuses a non-attained verdict (evidence_insufficient)', () => {
    const citation = { ...goldenCitation('historical_replay'), attained: false };
    const result = evidencedAdvance('synthetic_regimes', citation, goldenStageCriteria('historical_replay'), GOLDEN_T1, goldenTrailLineage(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('evidence_insufficient');
      expect(result.errors[0]?.message).toContain('did not attain');
    }
  });

  it('refuses a citation that does not cover the stage\'s advancement criteria', () => {
    const citation = {
      ...goldenCitation('historical_replay'),
      criteria_refs: ['criteria-other@1' as never], // covers the WRONG criteria
    };
    const result = evidencedAdvance('synthetic_regimes', citation, goldenStageCriteria('historical_replay'), GOLDEN_T1, goldenTrailLineage(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('evidence_insufficient');
      expect(result.errors[0]?.message).toContain('uncovered');
    }
  });

  it('refuses a malformed citation (the guard is total)', () => {
    const malformed = { verdict: '', criteria: 'x', criteria_refs: [], attained: true, evidence_ref: '' };
    const result = evidencedAdvance('synthetic_regimes', malformed, goldenStageCriteria('historical_replay'), GOLDEN_T1, goldenTrailLineage(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_field');
    }
  });

  it('retains the typed refusal as data (L11): the trail keeps it and the position holds', () => {
    const trail = goldenRefusalTrail();
    expect(trail.records.length).toBe(3);
    const refusal = trail.records[2];
    expect(refusal?.kind).toBe('refusal');
    expect(refusal?.reason).toBe('evidence_missing');
    expect(refusal?.to).toBeNull();
    // The refusal moves nothing: the position is still the advanced rung.
    expect(trailPosition(trail)).toBe('historical_replay');
    expect(verifyTrailChain(trail)).toEqual({ ok: true, value: true });
  });
});

describe('regression (legal and recorded — a failed stage sends the curriculum back)', () => {
  it('records the regression and never drops it', () => {
    const trail = goldenRegressionTrail();
    expect(trail.records.map((record) => record.kind)).toEqual(['entry', 'advance', 'regress', 'advance']);
    const regression = trail.records[2];
    expect(regression?.from).toBe('historical_replay');
    expect(regression?.to).toBe('synthetic_regimes');
    expect(regression?.reason).toBe('evidenced_regression');
    // The final advance re-climbed: the position is historical_replay again.
    expect(trailPosition(trail)).toBe('historical_replay');
    expect(verifyTrailChain(trail)).toEqual({ ok: true, value: true });
  });

  it('refuses an upward "regression" (the ladder only regresses down)', () => {
    const result = recordedRegression('synthetic_regimes', 'shadow_trading', GOLDEN_T2, goldenTrailLineage());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('ladder_violation');
      expect(result.errors[0]?.message).toContain('moves DOWN');
    }
  });

  it('accepts a regression carrying the failure verdict (retained with the record)', () => {
    const failedVerdict = { ...goldenCitation('historical_replay'), attained: false };
    const result = recordedRegression('historical_replay', 'synthetic_regimes', GOLDEN_T2, goldenTrailLineage(), failedVerdict);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.evidence?.attained).toBe(false);
  });
});

describe('the ladder order on the trail', () => {
  it('refuses a skip (an advance must move exactly one rung)', () => {
    // Building a two-rung jump directly is refused by the builder (there
    // is no way to NAME a two-rung advance); the trail-side law is proven
    // by a hand-built record: from synthetic_regimes "to" reactive_market.
    const jump = {
      kind: 'advance',
      from: 'synthetic_regimes',
      to: 'reactive_market', // TWO rungs up — a skip
      evidence: goldenCitation('reactive_market'),
      reason: 'evidenced_advance',
      recordedAt: GOLDEN_T1,
      lineage: goldenTrailLineage(),
      live_permission: null,
    };
    const trail = openCurriculumTrail(goldenEntry());
    if (!trail.ok) throw new Error(JSON.stringify(trail.errors));
    const appended = appendTransition(trail.value, jump);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors.map((error) => error.code)).toContain('ladder_violation');
    }
  });

  it('refuses a record that does not move from the trail\'s current rung (no forking)', () => {
    const trail = goldenAdvancementTrail(); // position: historical_replay
    const stray = evidencedAdvance(
      'microstructure_friction', // NOT the current rung
      goldenCitation('reactive_market'),
      goldenStageCriteria('reactive_market'),
      GOLDEN_T2,
      goldenTrailLineage(),
      null,
    );
    if (!stray.ok) throw new Error(JSON.stringify(stray.errors));
    const appended = appendTransition(trail, stray.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors.map((error) => error.code)).toContain('ladder_violation');
      expect(appended.errors[0]?.message).toContain('does not fork');
    }
  });

  it('refuses an advance from the top of the ladder (nothing to advance to)', () => {
    const result = evidencedAdvance('controlled_live', goldenCitation('controlled_live'), goldenStageCriteria('controlled_live'), GOLDEN_T1, goldenTrailLineage(), GOLDEN_LIVE_PERMISSION as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('ladder_violation');
    }
  });
});

describe('the stage-9 trail gate', () => {
  it('refuses an advance into controlled_live without the permission record', () => {
    const result = evidencedAdvance(
      'shadow_trading',
      goldenCitation('controlled_live'),
      goldenStageCriteria('controlled_live'),
      GOLDEN_T1,
      goldenTrailLineage(),
      null, // NO permission
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('live_permission_missing');
      expect(result.errors[0]?.message).toContain('permitted-only, never default');
    }
  });

  it('accepts the advance with the permission record (and the trail keeps it)', () => {
    const result = evidencedAdvance(
      'shadow_trading',
      goldenCitation('controlled_live'),
      goldenStageCriteria('controlled_live'),
      GOLDEN_T1,
      goldenTrailLineage(),
      GOLDEN_LIVE_PERMISSION as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.to).toBe('controlled_live');
      expect(result.value.live_permission).toBe(GOLDEN_LIVE_PERMISSION);
    }
  });
});

describe('L11 — the append-only trail', () => {
  it('appending returns a NEW trail; the original is untouched', () => {
    const before = goldenAdvancementTrail();
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown;
    const regression = recordedRegression('historical_replay', 'synthetic_regimes', GOLDEN_T2, goldenTrailLineage());
    if (!regression.ok) throw new Error(JSON.stringify(regression.errors));
    const after = appendTransition(before, regression.value);
    if (!after.ok) throw new Error(JSON.stringify(after.errors));
    expect(after.value.records.length).toBe(before.records.length + 1);
    expect(before.records.length).toBe(2); // the original is unchanged
    expect(before).toEqual(snapshot);
  });

  it('refuses a re-entry into an open trail (history never rewinds)', () => {
    const trail = goldenAdvancementTrail();
    const reentry = enterCurriculum(goldenTrailLineage(), GOLDEN_T3);
    if (!reentry.ok) throw new Error(JSON.stringify(reentry.errors));
    const appended = appendTransition(trail, reentry.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('trail_rewrite');
    }
  });

  it('refuses a record that time-travels before its predecessor', () => {
    const trail = goldenAdvancementTrail();
    const regression = recordedRegression('historical_replay', 'synthetic_regimes', GOLDEN_T0, goldenTrailLineage()); // T0 < the last record's T1
    if (!regression.ok) throw new Error(JSON.stringify(regression.errors));
    const appended = appendTransition(trail, regression.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('trail_rewrite');
    }
  });

  it('detects a TAMPERED record through the chain (trail_rewrite)', () => {
    const trail = goldenAdvancementTrail();
    // Rebuild the trail with the advance's reason forged (the chain breaks).
    const forgedRecord: typeof trail.records[number] = { ...(trail.records[1] as typeof trail.records[number]), reason: 'ladder_entry' };
    const forged = { ...trail, records: [trail.records[0], forgedRecord] }  as typeof trail;
    const verified = verifyTrailChain(forged);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('trail_rewrite');
      expect(verified.errors[0]?.message).toContain('tampered');
    }
  });

  it('refuses a chain/records length mismatch and detects a mid-chain edit (guard + fold)', () => {
    const trail = goldenRegressionTrail();
    // (a) A truncated record list with the FULL chain fails the guard
    // (chain length must equal record count — a truncated trail is not a
    // structurally valid trail).
    const truncated = { ...trail, records: trail.records.slice(0, 2) };
    const truncatedVerified = verifyTrailChain(truncated);
    expect(truncatedVerified.ok).toBe(false);
    if (!truncatedVerified.ok) {
      expect(truncatedVerified.errors[0]?.code).toBe('invalid_field');
    }
    // (b) A coherent-prefix truncation (records AND chain sliced) still
    // verifies internally — the chain is a fold, prefix removal is not
    // its crime to detect — but it is NOT the original trail, and the
    // resume gate re-verifies what IS there byte-exactly:
    const prefix = { ...trail, records: trail.records.slice(0, 2), record_chain: trail.record_chain.slice(0, 2) };
    expect(verifyTrailChain(prefix)).toEqual({ ok: true, value: true });
    expect(prefix.records.length).not.toBe(trail.records.length);
    // (c) A mid-chain EDIT (record content changed, chain kept) is the
    // fold's crime: trail_rewrite.
    const editedRecord: typeof trail.records[number] = { ...(trail.records[2] as typeof trail.records[number]), recordedAt: (GOLDEN_T2 + 1) as typeof GOLDEN_T2 };
    const edited = { ...trail, records: [trail.records[0], trail.records[1], editedRecord, trail.records[3]] } as typeof trail;
    const editedVerified = verifyTrailChain(edited);
    expect(editedVerified.ok).toBe(false);
    if (!editedVerified.ok) {
      expect(editedVerified.errors[0]?.code).toBe('trail_rewrite');
    }
  });

  it('refuses a foreign-lineage record (L12 — one trail, one scope)', () => {
    const trail = goldenAdvancementTrail();
    const foreignLineage = { ...goldenTrailLineage(), tenant: 'tenant-other' };
    const regression = recordedRegression('historical_replay', 'synthetic_regimes', GOLDEN_T2, foreignLineage);
    if (!regression.ok) throw new Error(JSON.stringify(regression.errors));
    const appended = appendTransition(trail, regression.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('tenant_scope_mismatch');
    }
  });
});

describe('serialization / resume (the byte-determinism artifact)', () => {
  it('round-trips: serialize -> resume -> the same trail, chain-verified', () => {
    const trail = goldenRegressionTrail();
    const bytes = serializeCurriculumTrail(trail);
    if (!bytes.ok) throw new Error(JSON.stringify(bytes.errors));
    const resumed = resumeCurriculumTrail(bytes.value);
    if (!resumed.ok) throw new Error(JSON.stringify(resumed.errors));
    expect(resumed.value).toEqual(trail);
    expect(verifyTrailChain(resumed.value)).toEqual({ ok: true, value: true });
    // Byte-stable: serializing the resumed trail yields the same bytes.
    const again = serializeCurriculumTrail(resumed.value);
    if (!again.ok) throw new Error(JSON.stringify(again.errors));
    expect(again.value).toBe(bytes.value);
  });

  it('refuses unparseable bytes, wrong schemas and tampered payloads (typed)', () => {
    const unparseable = resumeCurriculumTrail('not json {');
    expect(unparseable.ok).toBe(false);
    if (!unparseable.ok) expect(unparseable.errors[0]?.code).toBe('invalid_payload');

    const wrongSchema = resumeCurriculumTrail('{"schema":"other","trail":{}}');
    expect(wrongSchema.ok).toBe(false);
    if (!wrongSchema.ok) expect(wrongSchema.errors[0]?.code).toBe('invalid_payload');

    // A tampered payload: the schema marker is right but a record was edited.
    const bytes = goldenTrailBytes();
    const parsed = JSON.parse(bytes) as { trail: { records: unknown[] } };
    const record = parsed.trail.records[1] as Record<string, unknown>;
    record.reason = 'ladder_entry';
    const tampered = resumeCurriculumTrail(JSON.stringify(parsed));
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.errors[0]?.code).toBe('trail_rewrite');
    }
  });
});

describe('the entry record', () => {
  it('must enter at the bottom rung (the ladder is climbed from the bottom)', () => {
    const highEntry = {
      kind: 'entry',
      from: null,
      to: 'shadow_trading', // NOT the entry rung
      evidence: null,
      reason: 'ladder_entry',
      recordedAt: GOLDEN_T0,
      lineage: goldenTrailLineage(),
      live_permission: null,
    };
    const opened = openCurriculumTrail(highEntry);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.errors[0]?.code).toBe('ladder_violation');
    }
  });

  it('refuses a non-entry first record', () => {
    const refusal = recordedRefusal('synthetic_regimes', 'evidence_missing', GOLDEN_T0, goldenTrailLineage());
    if (!refusal.ok) throw new Error(JSON.stringify(refusal.errors));
    const opened = openCurriculumTrail(refusal.value);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.errors[0]?.message).toContain('entry');
    }
  });

  it('refuses a malformed lineage (L9/L12 negatives)', () => {
    const noTenant = enterCurriculum({ ...goldenTrailLineage(), tenant: '' }, GOLDEN_T0);
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.errors.map((error) => error.code)).toContain('lineage_gap');

    const noGoal = enterCurriculum({ ...goldenTrailLineage(), goal: '' }, GOLDEN_T0);
    expect(noGoal.ok).toBe(false);
    if (!noGoal.ok) expect(noGoal.errors.map((error) => error.code)).toContain('lineage_gap');
  });
});

describe('the version-checked append (defense in depth)', () => {
  it('re-checks the advance citation against the VERSION\'S declared criteria', () => {
    // The citation covers the WRONG criteria (not the version's declared
    // advancement criteria for the target stage): the builder accepts
    // nothing here, so we hand-build the record and let the trail's
    // version check refuse it.
    const trail = openCurriculumTrail(goldenEntry());
    if (!trail.ok) throw new Error(JSON.stringify(trail.errors));
    const record = {
      kind: 'advance',
      from: 'synthetic_regimes',
      to: 'historical_replay',
      evidence: {
        verdict: 'verdict-foreign-criteria',
        criteria: 'criteria-foreign@1',
        criteria_refs: ['criteria-not-declared@1'], // not the version's
        attained: true,
        evidence_ref: 'evidence-foreign-criteria',
      },
      reason: 'evidenced_advance',
      recordedAt: GOLDEN_T1,
      lineage: goldenTrailLineage(),
      live_permission: null,
    };
    const appended = appendTransition(trail.value, record, goldenCurriculumVersion());
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors.map((error) => error.code)).toContain('evidence_insufficient');
    }
  });
});

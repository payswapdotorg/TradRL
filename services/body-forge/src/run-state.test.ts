/**
 * @tradrl/body-forge — the run-state tests.
 *
 * Behavioral, law-driven (Work Order T017: "Resumable forge run state
 * (serialize -> parse -> resume, chain-verified)"):
 * - The full round trip: create -> forge-for-run -> serialize -> parse ->
 *   resume; the resumed run continues the ordinals and the chain.
 * - CHAIN-VERIFIED parse: tampered bytes anywhere in the log refuse the
 *   parse (attempt_rewrite / attempt_hidden).
 * - Identity coherence: a resumed attempt must carry the run's forge
 *   version, seed and scope (L9/L12) — a lineage switch is a typed error.
 * - Determinism: the same run identity + attempts -> byte-identical
 *   serialization; the run id is a pure function of its lineage inputs.
 * - Both minted and REJECTED attempts grow the log (L11: rejections
 *   retained).
 */

import { describe, expect, it } from 'vitest';

import { type SkillError, type TimestampMs } from '../../../packages/skills/src/index';
import {
  type ForgeRunState,
  FORGE_RUN_STATE_SCHEMA,
  createForgeRunState,
  deriveForgeRunId,
  forgeForRun,
  parseForgeRunState,
  resumeForgeRunState,
  serializeForgeRunState,
  validateForgeRunState,
} from './run-state';
import { fixtureForgeInput, fixtureUndeclaredRemovalForgeInput } from './fixtures';

const RUN = {
  forgeVersion: 'reference-forge/1',
  seed: 'forge-seed-1',
  tenantId: 'tenant-forge',
  projectId: 'project-forge',
};

const FIRST_ATTEMPT_AT = 1_713_000_000_000 as TimestampMs;
const SECOND_ATTEMPT_AT = 1_713_000_001_000 as TimestampMs;

describe('create + identity', () => {
  it('creates a genesis run state (empty log, derived id)', () => {
    const state = createForgeRunState(RUN);
    expect(state.schemaVersion).toBe(FORGE_RUN_STATE_SCHEMA);
    expect(state.runId).toBe(deriveForgeRunId(RUN.forgeVersion, RUN.seed, RUN.tenantId, RUN.projectId));
    expect(state.log.attempts.length).toBe(0);
    expect(state.log.attemptCount).toBe(0);
  });

  it('the run id is a pure function of (forgeVersion, seed, tenant, project)', () => {
    expect(deriveForgeRunId('a', 'b', 'c', 'd')).toBe(deriveForgeRunId('a', 'b', 'c', 'd'));
    expect(deriveForgeRunId('a', 'b', 'c', 'd')).not.toBe(deriveForgeRunId('a', 'b', 'c', 'e'));
  });

  it('invalid run identities throw (seed law + L12)', () => {
    expect(() => createForgeRunState({ ...RUN, seed: '' })).toThrow(/seed/);
    expect(() => createForgeRunState({ ...RUN, tenantId: '' })).toThrow(/tenant/i);
    expect(() => createForgeRunState({ ...RUN, forgeVersion: '' })).toThrow(/forgeVersion/);
  });
});

describe('forge-for-run (the pure transition)', () => {
  it('mints and appends the attempt in one step; the input state is untouched', () => {
    const state = createForgeRunState(RUN);
    const result = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidate).not.toBeNull();
      expect(result.value.state.log.attemptCount).toBe(1);
      expect(result.value.attempt.ordinal).toBe(1);
      expect(result.value.attempt.outcome).toBe('minted');
      expect(result.value.attempt.candidateRef).toBe('regime-researcher@1.3.0');
    }
    expect(state.log.attemptCount).toBe(0); // untouched (L3/L11 discipline)
  });

  it('a REFUSED forge still appends its attempt — the rejection is retained (L11)', () => {
    const state = createForgeRunState(RUN);
    const result = forgeForRun(state, fixtureUndeclaredRemovalForgeInput, FIRST_ATTEMPT_AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidate).toBeNull();
      expect(result.value.attempt.outcome).toBe('rejected');
      expect((result.value.attempt.reasons as readonly SkillError[]).length).toBeGreaterThan(0);
      expect(result.value.state.log.attemptCount).toBe(1);
    }
  });

  it('identity coherence: a forge version / seed / scope switch is a typed error', () => {
    const state = createForgeRunState(RUN);
    const wrongVersion = forgeForRun(state, { ...fixtureForgeInput, forgeVersion: 'other-forge/9' }, FIRST_ATTEMPT_AT);
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.errors[0]?.path).toContain('forgeVersion');
    }
    const wrongSeed = forgeForRun(state, { ...fixtureForgeInput, seed: 'other-seed' }, FIRST_ATTEMPT_AT);
    expect(wrongSeed.ok).toBe(false);
    if (!wrongSeed.ok) {
      expect(wrongSeed.errors[0]?.path).toContain('seed');
    }
    const wrongScope = forgeForRun(state, { ...fixtureForgeInput, tenantId: 'tenant-OTHER' }, FIRST_ATTEMPT_AT);
    expect(wrongScope.ok).toBe(false);
    if (!wrongScope.ok) {
      expect(wrongScope.errors[0]?.code).toBe('tenant_mismatch');
    }
  });
});

describe('serialize -> parse -> resume (chain-verified)', () => {
  it('the full round trip: forge, serialize, parse, resume — the chain continues', () => {
    const state = createForgeRunState(RUN);
    const first = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bytes = serializeForgeRunState(first.value.state);
    const parsed = parseForgeRunState(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeForgeRunState(parsed.value)).toBe(bytes); // byte-stable round trip

    // RESUME: the next attempt (a rejection this time) continues ordinals + chain.
    const resumed = resumeForgeRunState(bytes, fixtureUndeclaredRemovalForgeInput, SECOND_ATTEMPT_AT);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.state.log.attemptCount).toBe(2);
    expect(resumed.value.attempt.ordinal).toBe(2);
    expect(resumed.value.attempt.outcome).toBe('rejected');
    // And the resumed state parses again, chain-verified.
    const again = parseForgeRunState(serializeForgeRunState(resumed.value.state));
    expect(again.ok).toBe(true);
  });

  it('tampered log bytes refuse the parse (chain-verified)', () => {
    const state = createForgeRunState(RUN);
    const first = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bytes = serializeForgeRunState(first.value.state);
    // Tamper: inflate the recorded attempt count (hide the tail of history).
    const tampered = bytes.replace('"attemptCount":1', '"attemptCount":2');
    const parsed = parseForgeRunState(tampered);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((e) => e.code === 'attempt_hidden' || e.code === 'attempt_rewrite')).toBe(true);
    }
  });

  it('a tampered attempt payload refuses the parse (the digest chain)', () => {
    const state = createForgeRunState(RUN);
    const first = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bytes = serializeForgeRunState(first.value.state);
    // Tamper: rewrite the retained outcome (minted -> rejected).
    const tampered = bytes.replace('"outcome":"minted"', '"outcome":"rejected"');
    const parsed = parseForgeRunState(tampered);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((e) => e.code === 'attempt_rewrite')).toBe(true);
    }
  });

  it('a forged run id (lineage forgery) refuses validation', () => {
    const state: ForgeRunState = createForgeRunState(RUN);
    const forged = { ...state, runId: 'forge-run-deadbeef' };
    const result = validateForgeRunState(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'lineage_gap')).toBe(true);
    }
  });

  it('an unsupported schema version refuses the parse', () => {
    const state = createForgeRunState(RUN);
    const bytes = serializeForgeRunState(state).replace('"schemaVersion":1', '"schemaVersion":99');
    const parsed = parseForgeRunState(bytes);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((e) => e.message.includes('schema'))).toBe(true);
    }
  });

  it('non-JSON bytes are refused', () => {
    expect(parseForgeRunState('}{').ok).toBe(false);
  });
});

describe('determinism', () => {
  it('the same run + attempts serialize byte-identically, twice', () => {
    const state = createForgeRunState(RUN);
    const first = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    const second = forgeForRun(state, fixtureForgeInput, FIRST_ATTEMPT_AT);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(serializeForgeRunState(first.value.state)).toBe(serializeForgeRunState(second.value.state));
  });
});

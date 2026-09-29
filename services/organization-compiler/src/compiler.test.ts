// @tradrl/organization-compiler — reference-compiler behavioral tests.
//
// Laws under test (Work Order T016 acceptance criteria):
// - #3 DETERMINISM: same (goal, constraints, budgets, registry snapshot,
//   seed) -> byte-identical candidate log — deep-equal twice AND the
//   golden fixture digest/sequence.
// - #4 L16a end-to-end: a labeled registry record fails the compile with
//   the typed `label_as_evidence` error.
// - #5 L11 log content: rejected candidates retained with STRUCTURED
//   reasons; the golden sequence pins the exact dispositions.
// - #6/#9/#10 through compileOrganization: the enforcement point rejects
//   broken inputs AND broken compilers (a compiler that hides a candidate
//   is caught by the package's log validation).
// - #7 search-integrity bridge: the REAL compiled log maps losslessly
//   onto the evaluation lane's input shape (failures retained, best-of-N
//   computable) — end-to-end through `computeSearchIntegrityReport`.
// - Reproducibility serializer: canonical bytes -> parse -> deep-equal;
//   registry digest bound in every candidate lineage.
// - Discovery: coverage characterization emits `new-body-spec-required`
//   (level 3) for uncovered capabilities; the compile itself fails typed
//   (the forge is T017's, never the compiler's).

import { describe, expect, it } from 'vitest';
import {
  type CompilerContract,
  type OrgResult,
  type SearchLog,
  type TimestampMs,
  compileOrganization,
  deepFreeze,
  isSearchLog,
  registrySnapshotDigestMirror,
  toSearchIntegrityInput,
  validateCompileInput,
} from '../../../packages/organization/src/index';
import { computeSearchIntegrityReport } from '../../../packages/evaluation/src/index';
import {
  REFERENCE_COMPILER_VERSION,
  characterizeCoverage,
  referenceCompiler,
} from './strategy';
import {
  fixtureBudgets,
  fixtureCompileInput,
  fixtureConstraints,
  fixtureGoal,
  fixtureRequiredCapabilities,
  fixtureSnapshot,
} from './fixtures';
import {
  GOLDEN_CANDIDATE_SEQUENCE,
  GOLDEN_LOG_DIGEST,
  GOLDEN_RUN_ID,
} from './golden';
import {
  digestOfSerializedLog,
  parseCandidateLog,
  registryDigestBinds,
  serializeCandidateLog,
} from './serializer';

/** Compiles the fixture input with the reference compiler (must succeed). */
function compileFixture(): SearchLog {
  const result = compileOrganization(fixtureCompileInput, referenceCompiler);
  if (!result.ok) throw new Error(`fixture compile failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Determinism (acceptance #3) — twice + golden
// ---------------------------------------------------------------------------

describe('determinism: same inputs -> byte-identical candidate log', () => {
  it('two independent compiles are deep-equal AND byte-identical', () => {
    const a = compileFixture();
    const b = compileFixture();
    expect(a).toEqual(b);
    expect(serializeCandidateLog(a)).toBe(serializeCandidateLog(b));
    expect(digestOfSerializedLog(serializeCandidateLog(a))).toBe(
      digestOfSerializedLog(serializeCandidateLog(b)),
    );
  });

  it('the golden digest pins the canonical bytes (byte-stable across runs)', () => {
    const log = compileFixture();
    expect(digestOfSerializedLog(serializeCandidateLog(log))).toBe(GOLDEN_LOG_DIGEST);
  });

  it('the golden run id pins the derived compile-context digest', () => {
    expect(compileFixture().searchRunId).toBe(GOLDEN_RUN_ID);
  });

  it('the golden candidate sequence pins the exact dispositions (L11 log content)', () => {
    const log = compileFixture();
    const sequence = log.candidates.map((candidate) => ({
      candidateId: candidate.candidateId as string,
      disposition: candidate.disposition,
    }));
    expect(sequence).toEqual(GOLDEN_CANDIDATE_SEQUENCE);
  });

  it('a different seed produces a DIFFERENT log (the seed matters)', () => {
    const reseeded = {
      ...fixtureCompileInput,
      seed: 'atlas-regime-alpha-seed-8' as never,
    };
    const result = compileOrganization(reseeded, referenceCompiler);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(serializeCandidateLog(result.value)).not.toBe(
        serializeCandidateLog(compileFixture()),
      );
    }
  });

  it('a different registry snapshot produces a different log (the evidence base matters)', () => {
    const record = fixtureSnapshot.records[0];
    if (record === undefined) throw new Error('fixture record missing');
    const perturbed = {
      records: fixtureSnapshot.records.map((r) =>
        r === record
          ? { ...r, descriptors: r.descriptors.map((d, i) => (i === 0 ? { ...d, capability: 'perturbed-capability' as never } : d)) }
          : r,
      ),
      digest: 'aaaaaaaaaaaaaaaa' as never,
    };
    // Re-derive the digest so the snapshot is structurally valid.
    const rederived = validateCompileInput({
      ...fixtureCompileInput,
      registrySnapshot: perturbed,
    });
    // The perturbed snapshot's own digest no longer binds -> typed failure
    // BEFORE the strategy runs. Then build a properly-digested variant.
    expect(rederived.ok).toBe(false);
    const correct = {
      records: perturbed.records,
      digest: registrySnapshotDigestMirror(perturbed.records) as never,
    };
    const result = compileOrganization(
      { ...fixtureCompileInput, registrySnapshot: correct },
      referenceCompiler,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.searchRunId).not.toBe(GOLDEN_RUN_ID);
    }
  });

  it('the search is pure: the input is never mutated', () => {
    const frozenInput = deepFreeze(JSON.parse(JSON.stringify(fixtureCompileInput)));
    const result = compileOrganization(frozenInput, referenceCompiler);
    expect(result.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(frozenInput))).toEqual(JSON.parse(JSON.stringify(fixtureCompileInput)));
  });
});

// ---------------------------------------------------------------------------
// L11 log content (acceptance #5): rejected candidates retained, structured
// ---------------------------------------------------------------------------

describe('L11 log content: the full search history is retained', () => {
  it('every enumerated candidate is in the log (12 = 3 x 2 x 2 product)', () => {
    const log = compileFixture();
    expect(log.candidates).toHaveLength(12);
    expect(log.candidates.map((c) => c.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('rejected candidates carry STRUCTURED reasons (codes, not free text)', () => {
    const log = compileFixture();
    const rejected = log.candidates.filter((c) => c.disposition === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    for (const candidate of rejected) {
      expect(candidate.reasons.length).toBeGreaterThan(0);
      for (const reason of candidate.reasons) {
        expect(['below-required-satisfaction', 'budget-exceeded', 'blocking-constraint', 'retain-limit']).toContain(reason.code);
      }
    }
    // The below-required-satisfaction rejections carry the threshold + score.
    const below = rejected.find((c) => c.reasons.some((r) => r.code === 'below-required-satisfaction'));
    expect(below).toBeDefined();
    if (below !== undefined) {
      const reason = below.reasons[0];
      if (reason?.code === 'below-required-satisfaction') {
        expect(reason.requiredSatisfaction).toBe(fixtureGoal.successCriteria.requiredSatisfaction);
        expect(reason.attainmentScore).toBe(below.measurements.attainmentScore);
        expect(reason.attainmentScore).toBeLessThan(reason.requiredSatisfaction);
      }
    }
  });

  it('exactly one proposed candidate and the selection names it', () => {
    const log = compileFixture();
    const proposed = log.candidates.filter((c) => c.disposition === 'proposed');
    expect(proposed).toHaveLength(1);
    expect(log.selection.selectedCandidateId).toBe(proposed[0]?.candidateId);
  });

  it('the retain window holds exactly retainLimitK retained candidates', () => {
    const log = compileFixture();
    expect(log.candidates.filter((c) => c.disposition === 'retained')).toHaveLength(
      fixtureBudgets.retainLimitK,
    );
  });

  it('every candidate blueprint carries ALL SEVEN axes (acceptance #9 end-to-end)', () => {
    const log = compileFixture();
    for (const candidate of log.candidates) {
      const blueprint = candidate.blueprint as unknown as Record<string, unknown>;
      for (const axis of [
        'agentCount',
        'specializations',
        'assignments',
        'topology',
        'trainingAllocation',
        'decisionCadence',
        'adversarialPopulation',
      ]) {
        expect(blueprint[axis], `axis ${axis}`).toBeDefined();
      }
      expect(candidate.blueprint.agentCount).toBe(candidate.blueprint.assignments.length);
    }
  });

  it('every candidate lineage binds the registry snapshot digest (L9)', () => {
    const log = compileFixture();
    expect(registryDigestBinds(log)).toBe(true);
    for (const candidate of log.candidates) {
      expect(candidate.lineage.registrySnapshotDigest).toBe(log.registrySnapshot.digest);
      expect(candidate.lineage.goalRef).toBe(fixtureGoal.id);
      expect(candidate.lineage.constraintSetRef).toBe(fixtureConstraints.id);
      expect(candidate.lineage.seed).toBe(fixtureCompileInput.seed);
      expect(candidate.lineage.compilerVersion).toBe(REFERENCE_COMPILER_VERSION);
    }
  });

  it('no label, no authority anywhere in the blueprint/registry trees (L16a + safety)', () => {
    // The scan covers the LAW'S domain: candidate blueprints, the registry
    // snapshot and the discovery trace. The goal/constraint mirrors are
    // control-domain data — their own vocabulary (e.g. the horizon's
    // calendar `label`) is governed by the control plane, not L16a.
    const log = compileFixture();
    const scan = (value: unknown, bad: readonly string[]): string[] => {
      const found: string[] = [];
      if (Array.isArray(value)) {
        value.forEach((item) => found.push(...scan(item, bad)));
        return found;
      }
      if (typeof value !== 'object' || value === null) return found;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (bad.includes(key)) found.push(key);
        found.push(...scan(child, bad));
      }
      return found;
    };
    const LABELS = ['label', 'roleLabel', 'profession', 'role', 'title', 'jobTitle', 'vocation'];
    const AUTHORITY = ['authority', 'authorityToken', 'executionAuthority', 'executionGrant', 'grant', 'authorizedActions', 'token', 'credential', 'apiKey', 'secret', 'permissions', 'scopes'];
    for (const candidate of log.candidates) {
      expect(scan(candidate.blueprint, LABELS)).toEqual([]);
      expect(scan(candidate.blueprint, AUTHORITY)).toEqual([]);
    }
    expect(scan(log.registrySnapshot, LABELS)).toEqual([]);
    expect(scan(log.registrySnapshot, AUTHORITY)).toEqual([]);
    expect(scan(log.discovery, LABELS)).toEqual([]);
    expect(scan(log.discovery, AUTHORITY)).toEqual([]);
  });

  it('the discovery trace follows the CAPABILITY-DISCOVERY loop order', () => {
    const log = compileFixture();
    const steps = log.discovery.map((step) => step.step);
    expect(steps[0]).toBe('deficit-detected');
    expect(steps).toContain('capability-contract-characterized');
    expect(steps).toContain('candidates-generated');
    expect(steps).toContain('candidates-benchmarked');
    expect(steps.filter((s) => s === 'candidate-retained').length).toBeGreaterThan(0);
    expect(steps.filter((s) => s === 'candidate-rejected').length).toBeGreaterThan(0);
    // The deficit step carries the typed gap.
    const deficit = log.discovery[0];
    expect(deficit?.step).toBe('deficit-detected');
    if (deficit?.step === 'deficit-detected') {
      expect(deficit.gap.capabilityKey).toBe(fixtureRequiredCapabilities[0]);
      expect(deficit.gap.kind).toBe('regime');
    }
  });

  it('the log is deeply frozen and JSON-round-trippable', () => {
    const log = compileFixture();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.candidates)).toBe(true);
    const roundTrip: unknown = JSON.parse(JSON.stringify(log));
    expect(isSearchLog(roundTrip)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reproducibility serializer
// ---------------------------------------------------------------------------

describe('reproducibility serializer', () => {
  it('canonical bytes -> parse -> deep-equal to the compiled log', () => {
    const log = compileFixture();
    const serialized = serializeCandidateLog(log);
    const parsed = parseCandidateLog(serialized);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(log);
    }
  });

  it('serialization is deterministic (same log, same bytes, same digest)', () => {
    const a = serializeCandidateLog(compileFixture());
    const b = serializeCandidateLog(compileFixture());
    expect(a).toBe(b);
    expect(digestOfSerializedLog(a)).toBe(GOLDEN_LOG_DIGEST);
  });

  it('corrupted bytes fail the parse with a typed message (fail-closed)', () => {
    const corrupted = serializeCandidateLog(compileFixture()).slice(0, 50);
    expect(parseCandidateLog(corrupted).ok).toBe(false);
    expect(parseCandidateLog('not json at all').ok).toBe(false);
    const valid = parseCandidateLog(serializeCandidateLog(compileFixture()));
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      // Tamper: hide a candidate from the SERIALIZED form and re-parse —
      // the log law catches it (L11).
      const tampered = JSON.parse(serializeCandidateLog(valid.value)) as Record<string, unknown>;
      const candidates = tampered.candidates as unknown[];
      candidates.splice(4, 1); // hide candidate-5
      const reparse = parseCandidateLog(JSON.stringify(tampered));
      expect(reparse.ok).toBe(false);
      if (!reparse.ok) {
        expect(reparse.message).toMatch(/candidate_rewrite|selection_mismatch/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Search-integrity bridge end-to-end (acceptance #7)
// ---------------------------------------------------------------------------

describe('search-integrity bridge (the REAL compiled log onto the evaluation lane)', () => {
  const log = compileFixture();
  const baseInstant = 1_772_600_000_000 as TimestampMs;

  it('the bridge maps the log losslessly onto the evaluation input shape', () => {
    const bridged = toSearchIntegrityInput(log, baseInstant);
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) throw new Error('bridge failed');
    const { experiment, statistics, selection } = bridged.value;
    expect(experiment.trials).toHaveLength(12); // EVERY candidate retained
    expect(statistics).toHaveLength(12); // one statistic per trial (L11 coverage)
    expect(selection.selectedTrialId as string).toBe(log.selection.selectedCandidateId);
  });

  it('the REAL computeSearchIntegrityReport scores the bridge output (L11 quantified)', () => {
    const bridged = toSearchIntegrityInput(log, baseInstant);
    if (!bridged.ok) throw new Error('bridge failed');
    const { experiment, statistics, selection } = bridged.value;
    const report = computeSearchIntegrityReport(
      experiment as unknown as Parameters<typeof computeSearchIntegrityReport>[0],
      statistics as unknown as readonly unknown[],
      selection as unknown,
    );
    expect(report.ok).toBe(true);
    if (report.ok) {
      const value = report.value;
      expect(value.trialsCounted).toBe(12);
      expect(value.succeeded).toBe(3); // proposed + 2 retained
      expect(value.rejectionsRetained).toBe(9); // the REJECTED candidates retained
      expect(value.bestOfN?.candidates).toBe(3);
      expect(value.bestOfN?.selectedIsBest).toBe(true);
      // The blind expectation over scored candidates vs the selected max.
      const scores = log.candidates
        .filter((c) => c.disposition !== 'rejected')
        .map((c) => c.objective.score);
      const blind = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      expect(value.bestOfN?.blindSelectionExpectation).toBeCloseTo(blind, 12);
      expect(value.bestOfN?.selectionInflation).toBeGreaterThan(0);
    }
  });

  it('the bridge derives deterministic per-candidate instants from the explicit base', () => {
    const a = toSearchIntegrityInput(log, baseInstant);
    const b = toSearchIntegrityInput(log, baseInstant);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = toSearchIntegrityInput(log, (baseInstant + 1000) as TimestampMs);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});

// ---------------------------------------------------------------------------
// Typed failures through the enforcement point (acceptance #4, #10 + input laws)
// ---------------------------------------------------------------------------

describe('compileOrganization: typed failures on broken inputs', () => {
  it('an unseeded search is unseeded_search (no ambient randomness)', () => {
    const result = compileOrganization({ ...fixtureCompileInput, seed: '' as never }, referenceCompiler);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unseeded_search')).toBe(true);
    }
  });

  it('a tenant mismatch between goal, constraints and scope is tenant_mismatch (L12)', () => {
    const result = compileOrganization(
      { ...fixtureCompileInput, constraints: { ...fixtureConstraints, tenantId: 'tenant-other' as never } },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'tenant_mismatch')).toBe(true);
    }
  });

  it('a labeled registry record fails with label_as_evidence (L16a end-to-end)', () => {
    const labeled = {
      records: [
        ...(fixtureSnapshot.records.slice(1) as unknown as Record<string, unknown>[]),
        { ...(fixtureSnapshot.records[0] as unknown as Record<string, unknown>), profession: 'mathematician' },
      ],
      digest: 'aaaaaaaaaaaaaaaa' as never,
    };
    const result = compileOrganization(
      { ...fixtureCompileInput, registrySnapshot: labeled },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.code === 'label_as_evidence');
      expect(error).toBeDefined();
      expect(error?.message).toContain('Never equate model and profession');
    }
  });

  it('a registry digest that does not bind its records is registry_digest_mismatch (L9)', () => {
    const result = compileOrganization(
      { ...fixtureCompileInput, registrySnapshot: { records: fixtureSnapshot.records, digest: '0000000000000000' as never } },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'registry_digest_mismatch')).toBe(true);
    }
  });

  it('budgets too small for the demand are rejected (maxAgents < required capabilities)', () => {
    const result = compileOrganization(
      { ...fixtureCompileInput, budgets: { ...fixtureBudgets, maxAgents: 2 } },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'budgets.maxAgents')).toBe(true);
    }
  });

  it('a compiler version disagreement is rejected (lineage coherence, L9)', () => {
    const result = compileOrganization(
      { ...fixtureCompileInput, compilerVersion: 'reference-enumeration/2' as never },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'compilerVersion')).toBe(true);
    }
  });

  it('an uncovered required capability fails typed (unknown_capability_record)', () => {
    const result = compileOrganization(
      {
        ...fixtureCompileInput,
        requiredCapabilities: [...fixtureRequiredCapabilities, 'uncoverable-capability' as never],
      },
      referenceCompiler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unknown_capability_record')).toBe(true);
    }
  });

  it('a non-object input is a typed invalid_type', () => {
    expect(compileOrganization(null, referenceCompiler).ok).toBe(false);
    expect(compileOrganization('input', referenceCompiler).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Discovery level 3: new-body-spec-required (declared, never forged)
// ---------------------------------------------------------------------------

describe('coverage characterization (discovery level 3)', () => {
  it('emits new-body-spec-required for uncovered capabilities', () => {
    const input = {
      ...fixtureCompileInput,
      requiredCapabilities: [...fixtureRequiredCapabilities, 'uncoverable-capability' as never],
    };
    const steps = characterizeCoverage(input);
    const level3 = steps.find((step) => step.step === 'new-body-spec-required');
    expect(level3).toBeDefined();
    if (level3 !== undefined && level3.step === 'new-body-spec-required') {
      expect(level3.capabilityKeys).toContain('uncoverable-capability');
      // The compiler declares the gap; it NEVER forges the body (T017's forge).
    }
    // The compile itself fails typed (see the unknown_capability_record test).
    const result = compileOrganization(input, referenceCompiler);
    expect(result.ok).toBe(false);
  });

  it('a fully covered demand emits no level-3 step', () => {
    const steps = characterizeCoverage(fixtureCompileInput);
    expect(steps.every((step) => step.step !== 'new-body-spec-required')).toBe(true);
  });

  it('the deficit steps mirror the input gaps (failure-driven discovery)', () => {
    const steps = characterizeCoverage(fixtureCompileInput);
    const deficits = steps.filter((step) => step.step === 'deficit-detected');
    expect(deficits).toHaveLength(fixtureCompileInput.gaps.length);
  });
});

// ---------------------------------------------------------------------------
// The enforcement point catches BROKEN COMPILERS (the contract has teeth)
// ---------------------------------------------------------------------------

describe('compileOrganization validates the compiler output (contract enforcement)', () => {
  /**
   * A compiler that HIDES a candidate from the MIDDLE of the sequence
   * (leaving a sequence gap — a structurally detectable rewrite).
   */
  const hidingCompiler: CompilerContract = {
    compilerVersion: referenceCompiler.compilerVersion,
    strategy: referenceCompiler.strategy,
    compile: (input): OrgResult<SearchLog> => {
      const result = referenceCompiler.compile(input);
      if (!result.ok) return result;
      const candidates = [...result.value.candidates];
      candidates.splice(4, 1); // hide candidate-5 -> sequence gap 1..4,6..12
      return { ok: true, value: { ...result.value, candidates } as SearchLog };
    },
  };

  it('a compiler that hides a candidate is caught (candidate_rewrite, L11)', () => {
    const result = compileOrganization(fixtureCompileInput, hidingCompiler);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'candidate_rewrite')).toBe(true);
    }
  });

  it('tail truncation is caught by the REPLAY discipline (recompile and compare)', () => {
    // A contiguous truncation of the log's tail is not structurally
    // detectable (the strategy's enumeration count lives outside the log);
    // the L11 answer is REPRODUCIBILITY: recompile the same inputs and
    // compare — the replay produces the full candidate history, and the
    // golden digest pins it.
    const truncated = (() => {
      const result = referenceCompiler.compile(fixtureCompileInput);
      if (!result.ok) throw new Error('compile failed');
      return { ...result.value, candidates: result.value.candidates.slice(0, -1) } as SearchLog;
    })();
    const replay = compileFixture();
    expect(truncated.candidates).toHaveLength(11);
    expect(replay.candidates).toHaveLength(12);
    expect(serializeCandidateLog(truncated)).not.toBe(serializeCandidateLog(replay));
    expect(digestOfSerializedLog(serializeCandidateLog(replay))).toBe(GOLDEN_LOG_DIGEST);
  });

  /** A compiler that rewrites a rejected candidate into retained. */
  const rewritingCompiler: CompilerContract = {
    compilerVersion: referenceCompiler.compilerVersion,
    strategy: referenceCompiler.strategy,
    compile: (input): OrgResult<SearchLog> => {
      const result = referenceCompiler.compile(input);
      if (!result.ok) return result;
      const candidates = result.value.candidates.map((candidate) =>
        candidate.disposition === 'rejected'
          ? { ...candidate, disposition: 'retained', reasons: [] as never }
          : candidate,
      );
      return { ok: true, value: { ...result.value, candidates } as SearchLog };
    },
  };

  it('a compiler that launders a rejection into retention is caught (retention-window law)', () => {
    const result = compileOrganization(fixtureCompileInput, rewritingCompiler);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'selection_mismatch')).toBe(true);
      expect(
        result.errors.some((e) => e.message.includes('retention window')),
      ).toBe(true);
    }
  });

  it('a compiler whose function member is missing fails the contract guard', () => {
    expect(compileOrganization(fixtureCompileInput, {} as never).ok).toBe(false);
    expect(compileOrganization(fixtureCompileInput, 'compiler' as never).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Immutability of the compiled artifacts
// ---------------------------------------------------------------------------

describe('immutability (deep freeze discipline)', () => {
  it('the log, its candidates, blueprints and measurements are frozen', () => {
    const log = compileFixture();
    expect(Object.isFrozen(log)).toBe(true);
    for (const candidate of log.candidates) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.blueprint)).toBe(true);
      expect(Object.isFrozen(candidate.measurements)).toBe(true);
      expect(Object.isFrozen(candidate.lineage)).toBe(true);
      expect(Object.isFrozen(candidate.objective)).toBe(true);
    }
    expect(() => {
      (log as unknown as { candidates: unknown[] }).candidates.push(null);
    }).toThrow();
  });
});

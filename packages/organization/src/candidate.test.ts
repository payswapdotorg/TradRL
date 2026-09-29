// @tradrl/organization — candidate + search-log behavioral tests (T016).
//
// Laws under test:
// - L11 (acceptance #5): the candidate sequence is append-only; rejected
//   candidates are RETAINED records with STRUCTURED reasons; rewriting or
//   hiding a candidate is the typed error `candidate_rewrite`; the log
//   content retains rejections.
// - L9 (acceptance #10): every candidate carries its full lineage block
//   (goal ref, constraint-set ref, registry digest, seed, compiler
//   version, tenant, project) — a lineage disagreement is `lineage_gap`;
//   parents must reference EARLIER candidates (the search is a tree).
// - Selection: exactly one `proposed` candidate, and the selection claim
//   names it (`selection_mismatch` otherwise).
// - Derived run id binding (byte-determinism of the log identity).
// - Immutability: logs and candidates are deeply frozen; appends are
//   copy-on-write.

import { describe, expect, it } from 'vitest';
import {
  capabilityKey,
  projectId as projectIdFactory,
  type CandidateLineage,
  type OrganizationCandidate,
  type SearchLog,
  appendOrganizationCandidate,
  createOrganizationCandidate,
  isOrganizationCandidate,
  isSearchLog,
  searchRunIdOf,
  validateSearchLog,
} from './index';
import { aggregateOrganizationObjective } from './index';
import {
  fixtureBlueprint,
  fixtureBudgets,
  fixtureCompilerVersion,
  fixtureConstraints,
  fixtureGoal,
  fixtureSeed,
  fixtureSnapshot,
  fixtureStrategy,
  fixtureTenant,
} from './fixtures';

// ---------------------------------------------------------------------------
// Log construction helpers (deterministic, fixture-driven)
// ---------------------------------------------------------------------------

const lineage = (parent: string | null): CandidateLineage => ({
  goalRef: fixtureGoal.id,
  goalVersion: fixtureGoal.version,
  constraintSetRef: fixtureConstraints.id,
  constraintSetVersion: fixtureConstraints.version,
  registrySnapshotDigest: fixtureSnapshot.digest,
  seed: fixtureSeed,
  compilerVersion: fixtureCompilerVersion,
  parentCandidateId: parent as never,
  tenantId: fixtureTenant,
  projectId: projectIdFactory('project/atlas/regime-alpha'),
});

const measurements = (attainment: number, compute: number) => ({
  attainmentScore: attainment,
  attainmentEvidenceRef: 'evidence/attainment/atlas-run-42',
  riskPenalty: 0.25,
  riskPolicyRefs: ['policy/risk/atlas/researcher-gate'],
  computeUnits: compute,
  coordinationCostWires: 2,
  latencyMs: 1200,
  robustness: 0.7,
  redundancy: 0.5,
});

function makeCandidate(
  id: string,
  sequence: number,
  disposition: 'proposed' | 'retained' | 'rejected',
  attainment: number,
  compute: number,
  parent: string | null,
): OrganizationCandidate {
  const aggregate = aggregateOrganizationObjective(measurements(attainment, compute), fixtureStrategy);
  if (!aggregate.ok) throw new Error('fixture aggregation failed');
  return createOrganizationCandidate({
    candidateId: id as never,
    sequence,
    blueprint: fixtureBlueprint as never,
    measurements: measurements(attainment, compute) as never,
    objective: aggregate.value,
    lineage: lineage(parent),
    disposition,
    reasons:
      disposition === 'rejected'
        ? [{ code: 'retain-limit', retainedCount: 2 }]
        : [],
  });
}

const candidates: readonly OrganizationCandidate[] = [
  makeCandidate('candidate-1', 1, 'rejected', 0.5, 20, null),
  makeCandidate('candidate-2', 2, 'proposed', 0.8, 10, 'candidate-1'),
  makeCandidate('candidate-3', 3, 'retained', 0.7, 12, 'candidate-1'),
  makeCandidate('candidate-4', 4, 'rejected', 0.6, 30, 'candidate-2'),
];

const requiredCapabilities = [capabilityKey('mathematical-reasoning'), capabilityKey('regime-analysis')] as const;

const baseLog: SearchLog = {
  searchRunId: searchRunIdOf({
    goal: fixtureGoal,
    constraints: fixtureConstraints,
    budgets: fixtureBudgets,
    registrySnapshot: fixtureSnapshot,
    seed: fixtureSeed,
    compilerVersion: fixtureCompilerVersion,
    requiredCapabilities,
    gaps: [],
  }),
  tenantId: fixtureTenant,
  projectId: projectIdFactory('project/atlas/regime-alpha'),
  goal: fixtureGoal,
  constraints: fixtureConstraints,
  budgets: fixtureBudgets,
  registrySnapshot: fixtureSnapshot,
  seed: fixtureSeed,
  compilerVersion: fixtureCompilerVersion,
  strategy: fixtureStrategy as never,
  requiredCapabilities,
  candidates,
  discovery: [], // empty discovery trace is legal
  selection: { selectedCandidateId: 'candidate-2' as never },
};

describe('search log positive path (L11/L9)', () => {
  it('the fixture log validates against the full law', () => {
    const result = validateSearchLog(baseLog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toHaveLength(4);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('the structural guard accepts the fixture log', () => {
    expect(isSearchLog(baseLog)).toBe(true);
  });

  it('rejected candidates are RETAINED records with structured reasons (log content)', () => {
    const rejected = candidates.filter((c) => c.disposition === 'rejected');
    expect(rejected).toHaveLength(2);
    for (const candidate of rejected) {
      expect(candidate.reasons.length).toBeGreaterThan(0);
      expect(candidate.reasons[0]?.code).toBe('retain-limit');
      expect((candidate.reasons[0] as { retainedCount: number }).retainedCount).toBe(2);
    }
  });

  it('proposed and retained candidates carry no rejection reasons', () => {
    for (const candidate of candidates.filter((c) => c.disposition !== 'rejected')) {
      expect(candidate.reasons).toHaveLength(0);
    }
  });

  it('the derived run id is byte-deterministic over the compile context', () => {
    const a = searchRunIdOf({
      goal: fixtureGoal,
      constraints: fixtureConstraints,
      budgets: fixtureBudgets,
      registrySnapshot: fixtureSnapshot,
      seed: fixtureSeed,
      compilerVersion: fixtureCompilerVersion,
      requiredCapabilities,
      gaps: [],
    });
    const b = searchRunIdOf({
      goal: JSON.parse(JSON.stringify(fixtureGoal)),
      constraints: JSON.parse(JSON.stringify(fixtureConstraints)),
      budgets: JSON.parse(JSON.stringify(fixtureBudgets)),
      registrySnapshot: JSON.parse(JSON.stringify(fixtureSnapshot)),
      seed: JSON.parse(JSON.stringify(fixtureSeed)),
      compilerVersion: fixtureCompilerVersion,
      requiredCapabilities,
      gaps: [],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^orgsearch:[0-9a-f]{16}$/);
  });

  it('a different seed derives a different run id (the seed matters)', () => {
    const other = searchRunIdOf({
      goal: fixtureGoal,
      constraints: fixtureConstraints,
      budgets: fixtureBudgets,
      registrySnapshot: fixtureSnapshot,
      seed: 'atlas-regime-alpha-seed-8' as never,
      compilerVersion: fixtureCompilerVersion,
      requiredCapabilities,
      gaps: [],
    });
    expect(other).not.toBe(baseLog.searchRunId);
  });

  it('the log survives a JSON round-trip and revalidates', () => {
    const roundTrip: unknown = JSON.parse(JSON.stringify(baseLog));
    expect(validateSearchLog(roundTrip).ok).toBe(true);
  });

  it('the parent refs form a tree (children reference earlier candidates)', () => {
    const byId = new Map(candidates.map((c) => [c.candidateId as string, c]));
    expect(byId.get('candidate-2')?.lineage.parentCandidateId).toBe('candidate-1');
    expect(byId.get('candidate-1')?.lineage.parentCandidateId).toBeNull();
  });
});

describe('L11 trip-wires: rewriting and hiding are typed errors (acceptance #5)', () => {
  it('a duplicate candidate id is candidate_rewrite', () => {
    const duplicated = {
      ...baseLog,
      candidates: [...candidates, makeCandidate('candidate-4', 5, 'retained', 0.65, 12, null)],
      selection: { selectedCandidateId: 'candidate-2' as never },
    };
    const result = validateSearchLog(duplicated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'candidate_rewrite' && e.message.includes('duplicate candidate id'))).toBe(true);
    }
  });

  it('a sequence gap is a HIDDEN candidate: candidate_rewrite (L11)', () => {
    // Drop candidate-3 from the middle and renumber nothing: sequence jumps 1,2,4.
    const withGap = {
      ...baseLog,
      candidates: [candidates[0], candidates[1], candidates[3]],
    };
    const result = validateSearchLog(withGap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const gapError = result.errors.find(
        (e) => e.code === 'candidate_rewrite' && e.message.includes('HIDDEN candidate'),
      );
      expect(gapError).toBeDefined();
      expect(gapError?.path).toContain('sequence');
    }
  });

  it('truncating the log (hiding the tail) breaks the selection law', () => {
    const truncated = {
      ...baseLog,
      candidates: [candidates[0], candidates[2], candidates[3]], // proposed candidate-2 hidden
    };
    const result = validateSearchLog(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'selection_mismatch')).toBe(true);
    }
  });

  it('two proposed candidates are selection_mismatch', () => {
    const twoProposed = {
      ...baseLog,
      candidates: [...candidates, makeCandidate('candidate-5', 5, 'proposed', 0.9, 5, null)],
    };
    const result = validateSearchLog(twoProposed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'selection_mismatch' && e.message.includes('exactly ONE proposed'))).toBe(true);
    }
  });

  it('a selection naming a non-proposed candidate is selection_mismatch', () => {
    const misSelection = {
      ...baseLog,
      selection: { selectedCandidateId: 'candidate-3' as never },
    };
    const result = validateSearchLog(misSelection);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'selection_mismatch')).toBe(true);
    }
  });

  it('a rejected candidate with EMPTY reasons fails its guard (unexplained rejection)', () => {
    const unexplained = makeCandidate('candidate-x', 5, 'rejected', 0.5, 10, null);
    expect(isOrganizationCandidate({ ...unexplained, reasons: [] })).toBe(false);
  });

  it('a non-rejected candidate WITH reasons fails its guard', () => {
    const noisy = makeCandidate('candidate-y', 5, 'retained', 0.5, 10, null);
    expect(
      isOrganizationCandidate({ ...noisy, reasons: [{ code: 'retain-limit', retainedCount: 2 }] }),
    ).toBe(false);
  });
});

describe('L9 trip-wires: lineage gaps (acceptance #10)', () => {
  const candidateIndex = (log: SearchLog, id: string): number =>
    log.candidates.findIndex((c) => (c.candidateId as string) === id);

  it('a candidate missing the registry snapshot digest binding is lineage_gap', () => {
    const broken = makeCandidate('candidate-6', 5, 'rejected', 0.4, 10, null);
    const tampered = {
      ...baseLog,
      candidates: [...candidates, { ...broken, lineage: { ...broken.lineage, registrySnapshotDigest: '0000000000000000' as never } }],
    };
    const result = validateSearchLog(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const gap = result.errors.find((e) => e.code === 'lineage_gap');
      expect(gap).toBeDefined();
      expect(gap?.message).toContain('registry digest');
    }
  });

  it('a candidate missing the seed/compiler-version/goal binding is lineage_gap', () => {
    for (const field of ['seed', 'compilerVersion', 'goalRef', 'constraintSetRef', 'tenantId', 'projectId'] as const) {
      const broken = makeCandidate(`candidate-${field}`, 5, 'rejected', 0.4, 10, null);
      const tampered = {
        ...baseLog,
        candidates: [
          ...candidates,
          { ...broken, lineage: { ...broken.lineage, [field]: 'wrong' as never } },
        ],
      };
      const result = validateSearchLog(tampered);
      expect(result.ok, `field ${field} must be lineage-checked`).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'lineage_gap'), `field ${field}`).toBe(true);
      }
    }
  });

  it('a parent candidate that does not exist is lineage_gap', () => {
    const orphan = makeCandidate('candidate-7', 5, 'rejected', 0.4, 10, 'candidate-ghost');
    const tampered = { ...baseLog, candidates: [...candidates, orphan] };
    const result = validateSearchLog(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'lineage_gap' && e.message.includes('does not exist'))).toBe(true);
    }
  });

  it('a parent candidate that is NOT earlier is lineage_gap (the tree grows forward)', () => {
    const late = makeCandidate('candidate-8', 5, 'rejected', 0.4, 10, 'candidate-4'); // candidate-4 is at index 3 < 4... use self-parent instead
    const selfParent = makeCandidate('candidate-8', 5, 'rejected', 0.4, 10, 'candidate-8');
    const tampered = { ...baseLog, candidates: [...candidates, selfParent, late] };
    const result = validateSearchLog(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'lineage_gap' && e.message.includes('not EARLIER'))).toBe(true);
    }
    expect(candidateIndex(baseLog, 'candidate-4')).toBe(3);
  });

  it('a run id that does not bind the compile context is lineage_gap', () => {
    const forged = { ...baseLog, searchRunId: 'orgsearch:0000000000000000' as never };
    const result = validateSearchLog(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'lineage_gap' && e.path === 'searchRunId')).toBe(true);
    }
  });

  it('an unseeded log is unseeded_search (no ambient randomness)', () => {
    const unseeded = { ...baseLog, seed: '' as never };
    const result = validateSearchLog(unseeded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unseeded_search')).toBe(true);
    }
  });

  it('a registry snapshot that fails its own law fails the log (L16a/L9 propagate)', () => {
    const labeledSnapshot = {
      records: [
        {
          ...(fixtureSnapshot.records[0] as object),
          role: 'researcher',
        },
      ],
      digest: 'aaaaaaaaaaaaaaaa' as never,
    };
    const tainted = { ...baseLog, registrySnapshot: labeledSnapshot };
    const result = validateSearchLog(tainted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });
});

describe('appendOrganizationCandidate (the ONLY mutation; copy-on-write)', () => {
  it('appending the next contiguous candidate returns a NEW frozen log', () => {
    const next = makeCandidate('candidate-9', 5, 'rejected', 0.3, 8, 'candidate-3');
    const result = appendOrganizationCandidate(baseLog, next);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toHaveLength(5);
      expect(result.value).not.toBe(baseLog); // copy-on-write
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(baseLog.candidates).toHaveLength(4); // source untouched
    }
  });

  it('appending the PROPOSED candidate sets the selection', () => {
    const empty: SearchLog = { ...baseLog, candidates: [], selection: { selectedCandidateId: '' as never } };
    const first = makeCandidate('candidate-a', 1, 'proposed', 0.9, 5, null);
    const result = appendOrganizationCandidate(empty, first);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selection.selectedCandidateId as string).toBe('candidate-a');
    }
  });

  it('appending out of sequence is candidate_rewrite', () => {
    const skipped = makeCandidate('candidate-9', 9, 'rejected', 0.3, 8, null);
    const result = appendOrganizationCandidate(baseLog, skipped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('candidate_rewrite');
      expect(result.errors[0]?.message).toContain('append-only');
    }
  });

  it('appending a duplicate id is candidate_rewrite', () => {
    const duplicate = makeCandidate('candidate-2', 5, 'rejected', 0.3, 8, null);
    const result = appendOrganizationCandidate(baseLog, duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('candidate_rewrite');
      expect(result.errors[0]?.message).toContain('rewriting a candidate');
    }
  });

  it('appending a lineage-mismatched candidate is lineage_gap', () => {
    const foreign = makeCandidate('candidate-9', 5, 'rejected', 0.3, 8, null);
    const tampered = {
      ...foreign,
      lineage: { ...foreign.lineage, seed: 'another-seed' as never },
    };
    const result = appendOrganizationCandidate(baseLog, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_gap');
    }
  });

  it('appending a SECOND proposed candidate is selection_mismatch', () => {
    const second = makeCandidate('candidate-9', 5, 'proposed', 0.95, 5, null);
    const result = appendOrganizationCandidate(baseLog, second);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('selection_mismatch');
    }
  });

  it('the log is immutable: mutation attempts throw (deep freeze)', () => {
    const validated = validateSearchLog(baseLog);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('fixture log must validate');
    const log = validated.value;
    expect(() => {
      (log as unknown as { candidates: unknown[] }).candidates.push(null);
    }).toThrow();
    expect(() => {
      (log as unknown as { seed: string }).seed = 'mutated';
    }).toThrow();
  });

  it('candidates are deeply frozen by their factory', () => {
    const candidate = candidates[0] as OrganizationCandidate;
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.lineage)).toBe(true);
    expect(Object.isFrozen(candidate.objective)).toBe(true);
  });
});

describe('structural boundary negatives', () => {
  it('non-objects are typed invalid_type', () => {
    expect(validateSearchLog(null).ok).toBe(false);
    expect(validateSearchLog('log').ok).toBe(false);
    expect(validateSearchLog([]).ok).toBe(false);
  });

  it('candidates failing their guard are collected', () => {
    const broken = { ...baseLog, candidates: ['not a candidate'] };
    const result = validateSearchLog(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe('candidates[0]');
    }
  });

  it('the rejection-reason union is closed', () => {
    expect(
      isOrganizationCandidate(
        makeCandidate('candidate-z', 5, 'rejected', 0.3, 8, null) as never,
      ),
    ).toBe(true);
    const invalidReason = { ...makeCandidate('candidate-z', 5, 'rejected', 0.3, 8, null), reasons: [{ code: 'vibes' }] };
    expect(isOrganizationCandidate(invalidReason)).toBe(false);
  });
});

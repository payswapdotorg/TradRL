// @tradrl/capability-provider — the verification contract's laws.
//
// The goalpost law: the contract is closed-vocabulary, NON-EMPTY, with
// unique requirement refs; the coverage law: outcomes answer the
// contract EXACTLY (no gaps, no dupes, no inventions); the verdict is
// the pure fold (code, never judgment — L20).

import { describe, expect, it } from 'vitest';
import {
  coverageProblems,
  isProviderVerificationReport,
  isVerificationOutcome,
  isVerificationRequirement,
  isVerificationKind,
  mintVerificationReport,
  validateVerificationReport,
  VERIFICATION_KINDS,
  verificationContractProblems,
  verdictOf,
} from './index';
import type { VerificationOutcome, VerificationRequirement } from './index';
import { FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, passingOutcomes, T0 } from './fixtures';

describe('the requirement vocabulary (closed)', () => {
  it('the kinds are exactly benchmark | measurement | local-evaluation', () => {
    expect([...VERIFICATION_KINDS]).toEqual(['benchmark', 'measurement', 'local-evaluation']);
  });

  it('isVerificationKind closes the vocabulary', () => {
    expect(isVerificationKind('benchmark')).toBe(true);
    expect(isVerificationKind('peer-review')).toBe(false);
  });

  it('a benchmark requirement needs a non-empty benchmarkId', () => {
    expect(isVerificationRequirement({ kind: 'benchmark', requirementRef: 'r', benchmarkId: 'b' })).toBe(true);
    expect(isVerificationRequirement({ kind: 'benchmark', requirementRef: 'r', benchmarkId: '' })).toBe(false);
    expect(isVerificationRequirement({ kind: 'benchmark', requirementRef: 'r' })).toBe(false);
  });

  it('a measurement requirement needs a valid metric and at least one sane bound', () => {
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', max: 900 })).toBe(true);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', min: 10 })).toBe(true);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', min: 10, max: 900 })).toBe(true);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms' })).toBe(false);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'not-a-metric', max: 900 })).toBe(false);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', min: 900, max: 10 })).toBe(false);
    expect(isVerificationRequirement({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', max: Infinity })).toBe(false);
  });

  it('a local-evaluation requirement needs a non-empty evaluationRef', () => {
    expect(isVerificationRequirement({ kind: 'local-evaluation', requirementRef: 'r', evaluationRef: 'eval://s' })).toBe(true);
    expect(isVerificationRequirement({ kind: 'local-evaluation', requirementRef: 'r', evaluationRef: '' })).toBe(false);
  });

  it('every requirement needs a non-empty requirementRef', () => {
    expect(isVerificationRequirement({ kind: 'benchmark', requirementRef: '', benchmarkId: 'b' })).toBe(false);
  });

  it('an unknown kind fails the union', () => {
    expect(isVerificationRequirement({ kind: 'vibes', requirementRef: 'r' })).toBe(false);
  });
});

describe('the contract-list law (the frozen goalposts)', () => {
  it('an EMPTY contract is unverifiable (verification_required)', () => {
    const problems = verificationContractProblems([], 'request.verification');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('NON-EMPTY');
  });

  it('duplicate requirementRefs are named', () => {
    const contract: readonly VerificationRequirement[] = [
      { kind: 'benchmark', requirementRef: 'same', benchmarkId: 'b1' },
      { kind: 'benchmark', requirementRef: 'same', benchmarkId: 'b2' },
    ];
    const problems = verificationContractProblems(contract, 'request.verification');
    expect(problems.some((p) => p.includes('duplicate requirementRef'))).toBe(true);
  });

  it('a malformed requirement in the list is named', () => {
    const problems = verificationContractProblems([{ kind: 'nope' } as never], 'request.verification');
    expect(problems.some((p) => p.includes('closed VerificationRequirement union'))).toBe(true);
  });
});

describe('the outcome + verdict laws', () => {
  it('isVerificationOutcome checks the shape', () => {
    expect(isVerificationOutcome({ requirementRef: 'r', passed: true, detail: 'd' })).toBe(true);
    expect(isVerificationOutcome({ requirementRef: 'r', passed: 'yes', detail: 'd' })).toBe(false);
    expect(isVerificationOutcome({ requirementRef: 'r', passed: true, detail: '' })).toBe(false);
  });

  it('the verdict fold: verified iff EVERY outcome passed (L20 — code, never judgment)', () => {
    const pass = (requirementRef: string): VerificationOutcome => ({ requirementRef, passed: true, detail: 'ok' });
    expect(verdictOf([pass('a'), pass('b')])).toBe('verified');
    expect(verdictOf([pass('a'), { requirementRef: 'b', passed: false, detail: 'no' }])).toBe('rejected');
    expect(verdictOf([])).toBe('verified'); // the empty fold is vacuous truth — coverage forbids it in practice
  });

  it('the coverage law: a missing answer is named', () => {
    const problems = coverageProblems(FIXTURE_VERIFICATION, passingOutcomes().slice(0, 2));
    expect(problems.some((p) => p.includes('has no outcome'))).toBe(true);
  });

  it('the coverage law: an invented requirement is named', () => {
    const extra = [...passingOutcomes(), { requirementRef: 'not-in-contract', passed: true, detail: 'invented' }];
    const problems = coverageProblems(FIXTURE_VERIFICATION, extra);
    expect(problems.some((p) => p.includes('not in the engagement\'s verification contract'))).toBe(true);
  });

  it('the coverage law: a duplicate answer is named', () => {
    const dup = [...passingOutcomes(), passingOutcomes()[0]];
    const problems = coverageProblems(FIXTURE_VERIFICATION, dup);
    expect(problems.some((p) => p.includes('duplicate answer'))).toBe(true);
  });

  it('EXACT coverage of the fixture contract has no problems', () => {
    expect(coverageProblems(FIXTURE_VERIFICATION, passingOutcomes())).toEqual([]);
  });
});

describe('mintVerificationReport (the ONLY sanctioned report constructor)', () => {
  const base = {
    engagementId: 'eng:0123456789abcdef',
    deliverableId: 'dlv:0123456789abcdef',
    contract: FIXTURE_VERIFICATION,
    verifiedAt: T0 + 4_000,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
  } as unknown as Parameters<typeof mintVerificationReport>[0];

  it('mints a verified report over exact passing coverage (vrf: id, frozen, guard-satisfying)', () => {
    const result = mintVerificationReport({ ...base, outcomes: passingOutcomes() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verdict).toBe('verified');
    expect(result.value.reportId).toMatch(/^vrf:[0-9a-f]{16}$/);
    expect(isProviderVerificationReport(result.value)).toBe(true);
  });

  it('mints a rejected report when any outcome fails (the fold)', () => {
    const failing: readonly VerificationOutcome[] = [
      { requirementRef: 'bench-check', passed: true, detail: 'ok' },
      { requirementRef: 'latency-check', passed: false, detail: 'over the bound' },
      { requirementRef: 'local-eval', passed: true, detail: 'ok' },
    ];
    const result = mintVerificationReport({ ...base, outcomes: failing });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verdict).toBe('rejected');
  });

  it('refuses inexact coverage with the typed verification_contract_breach', () => {
    const partial = mintVerificationReport({ ...base, outcomes: passingOutcomes().slice(0, 2) });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors[0].code).toBe('verification_contract_breach');

    const invented = mintVerificationReport({ ...base, outcomes: [...passingOutcomes(), { requirementRef: 'ghost', passed: true, detail: 'x' }] });
    expect(invented.ok).toBe(false);
    if (!invented.ok) expect(invented.errors[0].code).toBe('verification_contract_breach');
  });

  it('refuses malformed outcomes and bad instants/scope', () => {
    const malformed = mintVerificationReport({ ...base, outcomes: [{ requirementRef: 'r', passed: true } as never] });
    expect(malformed.ok).toBe(false);
    const badInstant = mintVerificationReport({ ...base, outcomes: passingOutcomes(), verifiedAt: -1 } as never);
    expect(badInstant.ok).toBe(false);
    const noTenant = mintVerificationReport({ ...base, outcomes: passingOutcomes(), tenantId: '' } as never);
    expect(noTenant.ok).toBe(false);
  });

  it('the report id is content-addressed (same inputs, same id, twice)', () => {
    const a = mintVerificationReport({ ...base, outcomes: passingOutcomes() });
    const b = mintVerificationReport({ ...base, outcomes: passingOutcomes() });
    expect(a.ok && b.ok && a.value.reportId === b.value.reportId).toBe(true);
  });
});

describe('validateVerificationReport (the untrusted-input leg)', () => {
  it('round-trips a minted report', () => {
    const minted = mintVerificationReport({
      engagementId: 'eng:0123456789abcdef',
      deliverableId: 'dlv:0123456789abcdef',
      contract: FIXTURE_VERIFICATION,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 4_000,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
    } as unknown as Parameters<typeof mintVerificationReport>[0]);
    if (!minted.ok) throw new Error('mint failed');
    const validated = validateVerificationReport(minted.value);
    expect(validated.ok).toBe(true);
  });

  it('rejects a non-object and a wrong verdict vocabulary', () => {
    expect(validateVerificationReport(42).ok).toBe(false);
    const bad = validateVerificationReport({ verdict: 'maybe' });
    expect(bad.ok).toBe(false);
  });
});

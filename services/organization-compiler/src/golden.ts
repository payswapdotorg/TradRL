/**
 * @tradrl/organization-compiler — the golden determinism fixtures.
 *
 * The GOLDEN CANDIDATE SEQUENCE: the byte-stable output of the reference
 * compiler over the fixture compile input. The constants below are the
 * digest of the canonical JSON serialization, the derived run id, and the
 * ordered candidate id/disposition sequence produced by ONE run; the test
 * suite asserts every subsequent run reproduces them EXACTLY (the
 * determinism law: same goal, constraints, budgets, registry snapshot,
 * seed, compiler version, demand -> byte-identical candidate log).
 *
 * If the strategy changes deliberately, re-derive the golden constants
 * (the test prints them on failure) — a strategy change is a NEW
 * COMPILER VERSION, never a silent drift.
 */

/** The golden digest of the canonical JSON of the fixture candidate log. */
export const GOLDEN_LOG_DIGEST = '8707d26bb95f5570';

/** The golden derived search-run id over the fixture compile context. */
export const GOLDEN_RUN_ID = 'orgsearch:2446c2a7383690a2';

/** The golden candidate sequence: id, disposition pairs in enumeration order. */
export const GOLDEN_CANDIDATE_SEQUENCE: readonly {
  readonly candidateId: string;
  readonly disposition: string;
}[] = [
  { candidateId: 'candidate-1', disposition: 'retained' },
  { candidateId: 'candidate-2', disposition: 'proposed' },
  { candidateId: 'candidate-3', disposition: 'retained' },
  { candidateId: 'candidate-4', disposition: 'rejected' },
  { candidateId: 'candidate-5', disposition: 'rejected' },
  { candidateId: 'candidate-6', disposition: 'rejected' },
  { candidateId: 'candidate-7', disposition: 'rejected' },
  { candidateId: 'candidate-8', disposition: 'rejected' },
  { candidateId: 'candidate-9', disposition: 'rejected' },
  { candidateId: 'candidate-10', disposition: 'rejected' },
  { candidateId: 'candidate-11', disposition: 'rejected' },
  { candidateId: 'candidate-12', disposition: 'rejected' },
];

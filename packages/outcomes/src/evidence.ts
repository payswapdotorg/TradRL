/**
 * @tradrl/outcomes — the EVIDENCE REFERENCES: the typed links from
 * learning records (outcomes, post-mortems, hooks) to the underlying
 * records of the producing lanes.
 *
 * Every reference names its owning lane through a CLOSED kind
 * vocabulary (an unknown kind is the typed `unknown_evidence_kind`).
 * Where the owning lane's ids have a declared prefix grammar, the
 * guard enforces it (T030's `swo:`/`swf-`/`swr:`/`shs:`, T019's
 * `xd:`, T018's `si:`); T011's trajectory/experiment/trial ids are
 * opaque non-empty strings (the T011 discipline), so presence is the
 * check. The prefix discipline makes cross-lane identity confusion
 * visible in evidence.
 */

import { fail, ok, type OutcomesResult } from './errors';
import { isDigest, isNonEmptyString, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The closed evidence-kind vocabulary
// ---------------------------------------------------------------------------

/** The closed evidence-kind vocabulary (each member names the lane that owns the referenced record). */
export const EVIDENCE_KINDS = [
  'shadow_outcome',
  'shadow_fill',
  'shadow_refusal',
  'shadow_session',
  'decision',
  'intent',
  'trajectory',
  'experiment',
  'trial',
  'book_snapshot',
  'mark_fact',
] as const;

/** One evidence kind. */
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Guard: an evidence kind. */
export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(v);
}

/** One evidence reference: the owning kind + the opaque record ref. */
export interface EvidenceRef {
  readonly kind: EvidenceKind;
  readonly ref: string;
}

/** The prefix discipline per kind (null = opaque non-empty, the T011 discipline). */
const KIND_PREFIXES: Readonly<Record<EvidenceKind, string | null>> = {
  shadow_outcome: 'swo:',
  shadow_fill: 'swf-',
  shadow_refusal: 'swr:',
  shadow_session: 'shs:',
  decision: 'xd:',
  intent: 'si:',
  trajectory: null,
  experiment: null,
  trial: null,
  book_snapshot: null, // the ingestion batch's 8-hex digest (checked below)
  mark_fact: null, // the mark-fact composite key (opaque)
};

/** Guard: an evidence reference (the closed kind + the owning lane's id grammar). */
export function isEvidenceRef(v: unknown): v is EvidenceRef {
  if (!isRecord(v)) return false;
  if (!isEvidenceKind(v.kind)) return false;
  if (!isNonEmptyString(v.ref)) return false;
  const prefix = KIND_PREFIXES[v.kind];
  if (prefix !== null && !(v.ref as string).startsWith(prefix)) return false;
  if (v.kind === 'book_snapshot' && !isDigest(v.ref)) return false;
  return true;
}

/**
 * Require an evidence reference — the typed-error site: an unknown
 * KIND is the typed `unknown_evidence_kind`; a ref that violates its
 * kind's prefix grammar is the typed `invalid_field`.
 */
export function requireEvidenceRef(v: unknown, path = 'evidence'): OutcomesResult<EvidenceRef> {
  if (!isRecord(v)) return fail('invalid_type', `${path} must be an object { kind, ref }`, path);
  if (!isEvidenceKind(v.kind)) {
    return fail(
      'unknown_evidence_kind',
      `${JSON.stringify(v.kind)} is not an evidence kind — the vocabulary is closed: ${EVIDENCE_KINDS.join(' | ')}`,
      `${path}.kind`,
    );
  }
  if (typeof v.ref !== 'string' || v.ref === '') {
    return fail('invalid_field', `${path}.ref must be a non-empty record reference`, `${path}.ref`);
  }
  const prefix = KIND_PREFIXES[v.kind];
  if (prefix !== null && !(v.ref as string).startsWith(prefix)) {
    return fail('invalid_field', `${path}.ref ${JSON.stringify(v.ref)} violates the ${v.kind} evidence grammar (expected the owning lane's ${JSON.stringify(prefix)} prefix)`, `${path}.ref`);
  }
  if (v.kind === 'book_snapshot' && !isDigest(v.ref)) {
    return fail('invalid_field', `${path}.ref must be the book snapshot's 8-hex digest`, `${path}.ref`);
  }
  return ok({ kind: v.kind, ref: v.ref });
}

/** Validate a whole evidence list (every member through {@link requireEvidenceRef}). */
export function validateEvidenceList(v: unknown, path = 'evidence'): OutcomesResult<readonly EvidenceRef[]> {
  if (!Array.isArray(v)) return fail('invalid_field', `${path} must be an array of evidence refs`, path);
  const refs: EvidenceRef[] = [];
  for (let index = 0; index < v.length; index++) {
    const one = requireEvidenceRef(v[index], `${path}[${index}]`);
    if (!one.ok) return one;
    refs.push(one.value);
  }
  return ok(refs);
}

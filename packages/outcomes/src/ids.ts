/**
 * @tradrl/outcomes — the branded identity spaces (content-addressed ids
 * minted over canonical digests; every id is a non-empty string with a
 * lane-specific prefix so cross-lane identity confusion is visible in
 * evidence).
 *
 * Cross-lane entities (tenant, project, decisions, intents, sessions,
 * trajectories, experiments, trials, fill/refusal refs) stay OPAQUE —
 * they are the owning lanes' branded strings, consumed through
 * structural mirrors only (D-003/D-004). Where the owning lane's id has
 * a declared prefix grammar (T030's `swo:`/`swf-`/`swr:`/`shs:`,
 * T019's `xd:`), the evidence guards enforce it; T011's trajectory/
 * experiment/trial ids are deliberately opaque non-empty strings (the
 * T011 discipline), so their guards check presence only.
 */

import { isNonEmptyString } from './primitives';

// ---------------------------------------------------------------------------
// The branded identity spaces owned by this lane
// ---------------------------------------------------------------------------

/** An outcome record id (`out:` + digest of the record's canonical content). */
export type OutcomeRecordId = string & { readonly __outcomeRecordId: unique symbol };

/** A post-mortem record id (`pmr:` + digest of the record's canonical content). */
export type PostMortemId = string & { readonly __postMortemId: unique symbol };

/** An outcome-learning hook id (`olh:` + digest of the hook's canonical content). */
export type LearningHookId = string & { readonly __learningHookId: unique symbol };

// ---------------------------------------------------------------------------
// Guards + mints (this lane's ids)
// ---------------------------------------------------------------------------

/** Guard: an outcome record id. */
export function isOutcomeRecordId(v: unknown): v is OutcomeRecordId {
  return isNonEmptyString(v) && (v as string).startsWith('out:');
}

/** Guard: a post-mortem record id. */
export function isPostMortemId(v: unknown): v is PostMortemId {
  return isNonEmptyString(v) && (v as string).startsWith('pmr:');
}

/** Guard: an outcome-learning hook id. */
export function isLearningHookId(v: unknown): v is LearningHookId {
  return isNonEmptyString(v) && (v as string).startsWith('olh:');
}

/** Mint an outcome record id from its content digest (content-addressed, L9). */
export function mintOutcomeRecordId(digest: string): OutcomeRecordId {
  return `out:${digest}` as OutcomeRecordId;
}

/** Mint a post-mortem id from its content digest (content-addressed, L9). */
export function mintPostMortemId(digest: string): PostMortemId {
  return `pmr:${digest}` as PostMortemId;
}

/** Mint an outcome-learning hook id from its content digest (content-addressed, L9). */
export function mintLearningHookId(digest: string): LearningHookId {
  return `olh:${digest}` as LearningHookId;
}

// ---------------------------------------------------------------------------
// Opaque cross-lane references (structural mirrors — never imports)
// ---------------------------------------------------------------------------

/** The opaque tenant scope (L12 — every record carries it; mirror of domain-core's TenantId). */
export type TenantRef = string;

/** The opaque project scope (L12/L15 — the continuity root; mirror of domain-core's ProjectId). */
export type ProjectRef = string;

/** The opaque T019 execution-gate decision ref (the owning lane mints `xd:`-prefixed ids). */
export type DecisionRef = string;

/** The opaque T018 strategy intent ref (the owning lane mints `si:`-prefixed ids). */
export type IntentRef = string;

/** The opaque T030 shadow session ref (`shs:`-prefixed by its owning lane). */
export type SessionRef = string;

/** The opaque T011 trajectory ref (opaque non-empty string — T011's discipline). */
export type TrajectoryRef = string;

/** The opaque T011 experiment ref (opaque non-empty string). */
export type ExperimentRef = string;

/** The opaque T011 trial ref (opaque non-empty string). */
export type TrialRef = string;

/** Guard helper: an opaque non-empty reference. */
export function isOpaqueRef(v: unknown): v is string {
  return isNonEmptyString(v);
}

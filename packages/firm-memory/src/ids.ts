/**
 * @tradrl/firm-memory — the branded identity spaces (content-addressed
 * ids minted over canonical digests; every id is a non-empty string
 * with a lane-specific prefix so cross-lane identity confusion is
 * visible in provenance).
 *
 * Cross-lane entities (tenant, project, decisions, intents, sessions,
 * trajectories, experiments, trials, outcome records, post-mortem
 * records) stay OPAQUE — they are the owning lanes' branded strings,
 * consumed through structural mirrors only (D-003/D-004). Where the
 * owning lane's id has a declared prefix grammar (T033's `out:`/`pmr:`,
 * T030's `shs:`, T019's `xd:`, T018's `si:`), the provenance guards
 * enforce it; T011's trajectory/experiment/trial ids are deliberately
 * opaque non-empty strings (the T011 discipline), so their guards
 * check presence only.
 */

import { isNonEmptyString } from './primitives';

// ---------------------------------------------------------------------------
// The branded identity spaces owned by this lane
// ---------------------------------------------------------------------------

/** A firm-knowledge record id (`fkr:` + digest of the record's canonical content). */
export type FirmKnowledgeId = string & { readonly __firmKnowledgeId: unique symbol };

/** A contradiction record id (`fkc:` + digest of the record's canonical content). */
export type ContradictionId = string & { readonly __contradictionId: unique symbol };

/** A firm-ingestion receipt id (`fmr:` + digest of the receipt's canonical content). */
export type FirmReceiptId = string & { readonly __firmReceiptId: unique symbol };

// ---------------------------------------------------------------------------
// Guards + mints (this lane's ids)
// ---------------------------------------------------------------------------

/** Guard: a firm-knowledge record id. */
export function isFirmKnowledgeId(v: unknown): v is FirmKnowledgeId {
  return isNonEmptyString(v) && (v as string).startsWith('fkr:');
}

/** Guard: a contradiction record id. */
export function isContradictionId(v: unknown): v is ContradictionId {
  return isNonEmptyString(v) && (v as string).startsWith('fkc:');
}

/** Guard: a firm-ingestion receipt id. */
export function isFirmReceiptId(v: unknown): v is FirmReceiptId {
  return isNonEmptyString(v) && (v as string).startsWith('fmr:');
}

/** Mint a firm-knowledge id from its content digest (content-addressed, L9). */
export function mintFirmKnowledgeId(digest: string): FirmKnowledgeId {
  return `fkr:${digest}` as FirmKnowledgeId;
}

/** Mint a contradiction id from its content digest (content-addressed, L9). */
export function mintContradictionId(digest: string): ContradictionId {
  return `fkc:${digest}` as ContradictionId;
}

/** Mint a firm-ingestion receipt id from its content digest (content-addressed, L9). */
export function mintFirmReceiptId(digest: string): FirmReceiptId {
  return `fmr:${digest}` as FirmReceiptId;
}

// ---------------------------------------------------------------------------
// Opaque cross-lane references (structural mirrors — never imports)
// ---------------------------------------------------------------------------

/** The opaque tenant scope (L12 — every record carries it; mirror of domain-core's/control-domain's TenantId). */
export type TenantRef = string;

/** The opaque project scope (L12/L15 — the continuity root; mirror of domain-core's/control-domain's ProjectId). */
export type ProjectRef = string;

/** The opaque T033 outcome-record ref (`out:`-prefixed by its owning lane). */
export type OutcomeRef = string;

/** The opaque T033 post-mortem ref (`pmr:`-prefixed by its owning lane). */
export type PostMortemRef = string;

/** The opaque T030 shadow session ref (`shs:`-prefixed by its owning lane). */
export type SessionRef = string;

/** The opaque T019 execution-gate decision ref (the owning lane mints `xd:`-prefixed ids). */
export type DecisionRef = string;

/** The opaque T018 strategy intent ref (the owning lane mints `si:`-prefixed ids). */
export type IntentRef = string;

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

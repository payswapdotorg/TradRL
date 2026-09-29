/**
 * @tradrl/organization — capability gaps (failure-driven learning).
 *
 * Spec anchors: spec/LEARNING-LOOP.md — VERBATIM: "Failures create typed
 * CapabilityGaps such as regime, sentiment/event, liquidity, execution,
 * risk or coordination failure." And spec/CAPABILITY-DISCOVERY.md,
 * discovery loop step 1: "Detect capability deficit from task/project
 * evidence."
 *
 * A `CapabilityGap` is the compiler's INPUT signal for discovery steps:
 * an upstream failure analysis (evaluation lane, T012) or the reference
 * compiler's registry-coverage analysis records a typed gap — WHICH
 * capability class failed, WHICH capability contract is missing, and the
 * OPAQUE evidence reference that detected it. The record is structured
 * data: no free text, no labels (the capabilityKey cites a capability
 * CONTRACT, never a profession — L16a).
 */

import {
  type CapabilityGapId,
  type CapabilityKey,
  type TimestampMs,
  deepFreeze,
  isCapabilityGapId,
  isCapabilityKey,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
} from './primitives';

// Evidence references are opaque strings (the evidence subsystem owns the
// referents); the objective model declares the same space as
// `AttainmentEvidenceRef`, and gaps reuse it for failure evidence.
import type { AttainmentEvidenceRef } from './primitives';

/** The closed capability-gap kind vocabulary — the six failure classes (LEARNING-LOOP, verbatim). */
export const CAPABILITY_GAP_KINDS = [
  'regime',
  'sentiment-event',
  'liquidity',
  'execution',
  'risk',
  'coordination',
] as const;

/** One failure class (LEARNING-LOOP: "regime, sentiment/event, liquidity, execution, risk or coordination failure"). */
export type CapabilityGapKind = (typeof CAPABILITY_GAP_KINDS)[number];

/** Guard: `CapabilityGapKind`. */
export function isCapabilityGapKind(v: unknown): v is CapabilityGapKind {
  return typeof v === 'string' && (CAPABILITY_GAP_KINDS as readonly string[]).includes(v);
}

/**
 * One typed capability gap: a failure class, the missing capability
 * contract, the opaque evidence reference that detected the deficit, and
 * the explicit detection instant (never a wall clock — the determinism
 * law). Tenant/project scope per L12.
 */
export interface CapabilityGap {
  /** Gap identity (unique within the compile input's gap list). */
  readonly gapId: CapabilityGapId;
  /** The failure class (closed vocabulary above). */
  readonly kind: CapabilityGapKind;
  /** The capability contract whose absence the failure evidences. */
  readonly capabilityKey: CapabilityKey;
  /** Opaque reference to the failure evidence that detected the deficit. */
  readonly evidenceRef: AttainmentEvidenceRef;
  /** Explicit detection instant (epoch ms — carried, never read from a clock). */
  readonly detectedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Owning project (L12). */
  readonly projectId: string;
}

/** Guard: `CapabilityGap` (total, hand-rolled). */
export function isCapabilityGap(v: unknown): v is CapabilityGap {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isCapabilityGapKind(v.kind) &&
    isCapabilityKey(v.capabilityKey) &&
    isNonEmptyString(v.evidenceRef) &&
    isTimestampMs(v.detectedAt) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId)
  );
}

/**
 * Constructs a deeply frozen `CapabilityGap`, throwing `TypeError`
 * (field-prefixed) on invalid input.
 */
export function createCapabilityGap(draft: CapabilityGap): CapabilityGap {
  const problems: string[] = [];
  if (!isCapabilityGapId(draft.gapId)) problems.push('gapId: invalid CapabilityGapId');
  if (!isCapabilityGapKind(draft.kind)) {
    problems.push(`kind: must be one of ${CAPABILITY_GAP_KINDS.join(' | ')}`);
  }
  if (!isCapabilityKey(draft.capabilityKey)) {
    problems.push('capabilityKey: invalid CapabilityKey (a capability CONTRACT, never a profession label — L16a)');
  }
  if (!isNonEmptyString(draft.evidenceRef)) {
    problems.push('evidenceRef: must be a non-empty opaque evidence reference');
  }
  if (!isTimestampMs(draft.detectedAt)) problems.push('detectedAt: invalid TimestampMs');
  if (!isNonEmptyString(draft.tenantId)) problems.push('tenantId: must be a non-empty tenant id (L12)');
  if (!isNonEmptyString(draft.projectId)) problems.push('projectId: must be a non-empty project id (L12)');
  if (problems.length > 0) throw new TypeError(`createCapabilityGap: ${problems.join('; ')}`);
  return deepFreeze({ ...draft });
}

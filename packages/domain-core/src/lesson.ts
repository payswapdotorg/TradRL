// @tradrl/domain-core — Lesson: durable, provenance-bound learning record.
//
// A Lesson is the durable unit of institutional learning: a statement learned
// from a specific provenance (outcome, experiment, evidence capsule or
// post-mortem), tenant-scoped so Firm Brain reuse never crosses tenants
// (L12), and validated before reuse (learning loop: local validation).
// Lessons may address a CapabilityGap by opaque reference.

import { Timestamp, isNonEmptyString, isRecord, isTimestamp } from './primitives';
import {
  CapabilityGapId,
  EvidenceCapsuleId,
  ExperimentId,
  LessonId,
  OutcomeId,
  PostMortemId,
  ProjectId,
  TenantId,
  isCapabilityGapId,
  isEvidenceCapsuleId,
  isExperimentId,
  isLessonId,
  isOutcomeId,
  isPostMortemId,
  isProjectId,
  isTenantId,
} from './ids';

export type LessonStatus = 'candidate' | 'validated' | 'retired';

export const LESSON_STATUSES: readonly LessonStatus[] = [
  'candidate',
  'validated',
  'retired',
] as const;

/** Provenance: at least ONE reference must be present. */
export interface LessonProvenance {
  readonly outcomeId?: OutcomeId;
  readonly experimentId?: ExperimentId;
  readonly evidenceCapsuleId?: EvidenceCapsuleId;
  readonly postMortemId?: PostMortemId;
}

export interface Lesson {
  readonly id: LessonId;
  /** Owning tenant (L12: Firm-Brain scope; never crosses tenants by default). */
  readonly tenantId: TenantId;
  /** Project the lesson was learned in. Required — lessons are provenance-bound. */
  readonly projectId: ProjectId;
  readonly learnedAt: Timestamp;
  /** The lesson itself, stated in one sentence. */
  readonly statement: string;
  readonly detail?: string;
  readonly status: LessonStatus;
  readonly provenance: LessonProvenance;
  /** Capability gap this lesson addresses. Opaque (learning lanes). */
  readonly capabilityGapId?: CapabilityGapId;
  readonly tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isLessonStatus(v: unknown): v is LessonStatus {
  return isNonEmptyString(v) && (LESSON_STATUSES as readonly string[]).includes(v);
}

export function isLessonProvenance(v: unknown): v is LessonProvenance {
  if (!isRecord(v)) return false;
  if (v.outcomeId !== undefined && !isOutcomeId(v.outcomeId)) return false;
  if (v.experimentId !== undefined && !isExperimentId(v.experimentId)) return false;
  if (v.evidenceCapsuleId !== undefined && !isEvidenceCapsuleId(v.evidenceCapsuleId)) return false;
  if (v.postMortemId !== undefined && !isPostMortemId(v.postMortemId)) return false;
  return (
    v.outcomeId !== undefined ||
    v.experimentId !== undefined ||
    v.evidenceCapsuleId !== undefined ||
    v.postMortemId !== undefined
  );
}

export function isLesson(v: unknown): v is Lesson {
  if (!isRecord(v)) return false;
  if (!isLessonId(v.id)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isTimestamp(v.learnedAt)) return false;
  if (!isNonEmptyString(v.statement)) return false;
  if (v.detail !== undefined && !isNonEmptyString(v.detail)) return false;
  if (!isLessonStatus(v.status)) return false;
  if (!isLessonProvenance(v.provenance)) return false;
  if (v.capabilityGapId !== undefined && !isCapabilityGapId(v.capabilityGapId)) return false;
  if (v.tags !== undefined) {
    if (!Array.isArray(v.tags)) return false;
    if (!v.tags.every((x) => isNonEmptyString(x))) return false;
  }
  return true;
}

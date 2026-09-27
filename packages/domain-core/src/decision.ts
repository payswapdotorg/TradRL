// @tradrl/domain-core — Decision: point-in-time decision record.
//
// A Decision is an immutable, attributable record of a choice made by an
// agent instance at a moment in time, with the evidence capsule backing it,
// the alternatives considered and a calibrated confidence value. Downstream
// Outcome records link realized results back to this decision (L15 lineage).

import { Timestamp, isNonEmptyString, isRecord, isTimestamp, isUnitInterval } from './primitives';
import {
  AgentInstanceId,
  DecisionId,
  EvidenceCapsuleId,
  ProjectId,
  isAgentInstanceId,
  isDecisionId,
  isEvidenceCapsuleId,
  isProjectId,
} from './ids';

/** An alternative that was considered and not chosen. */
export interface DecisionAlternative {
  /** What the alternative was. */
  readonly summary: string;
  /** Why it was not chosen. */
  readonly rationale?: string;
}

export interface Decision {
  readonly id: DecisionId;
  readonly projectId: ProjectId;
  /** Agent instance that made the decision. Opaque (T003). */
  readonly agentInstanceId: AgentInstanceId;
  readonly madeAt: Timestamp;
  /** What was decided. Human-readable; interpretation never execution. */
  readonly summary: string;
  /** Evidence capsule backing the decision. Opaque (evidence lane). */
  readonly evidenceCapsuleId: EvidenceCapsuleId;
  /** Alternatives considered (possibly none for forced actions). */
  readonly alternatives: readonly DecisionAlternative[];
  /** Calibrated confidence in the decision. Closed interval [0, 1]. */
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isDecisionAlternative(v: unknown): v is DecisionAlternative {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (v.rationale !== undefined && !isNonEmptyString(v.rationale)) return false;
  return true;
}

export function isDecision(v: unknown): v is Decision {
  if (!isRecord(v)) return false;
  if (!isDecisionId(v.id)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isAgentInstanceId(v.agentInstanceId)) return false;
  if (!isTimestamp(v.madeAt)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!isEvidenceCapsuleId(v.evidenceCapsuleId)) return false;
  if (!Array.isArray(v.alternatives)) return false;
  if (!v.alternatives.every((x) => isDecisionAlternative(x))) return false;
  if (!isUnitInterval(v.confidence)) return false;
  return true;
}

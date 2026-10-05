// @tradrl/web-console — the availability projection (L4 at the interface).
//
// THE LAW (Work Order T042, mirroring UX.md "Visible information must
// respect simulated availability" and ARCHITECTURE-LOCK L4): "every
// visible datum passes an availability projection (L4 at the
// interface: rendering a fact whose availability instant is after
// the selected view time is a typed error — enforce in code)."
//
// Two halves:
//   1. `availabilityOf` — every mirrored record kind declares the
//      instant its facts became knowable (the record's own asOf/at/
//      completedAt — the boundary's point-in-time discipline, not a
//      console guess);
//   2. the projection + the render-side gate — `projectToView`
//      filters what MAY be shown at a view instant, and
//      `assertVisible` throws the typed AvailabilityViolationError
//      when a violating datum reaches a render path anyway (a bug or
//      a bypass — both surface loudly, never as a wrong render).
//
// Spec anchors: R3 (point-in-time availability), R7 (first-class
// Time Machine), L4.

import type {
  GoalStatement,
  GatewaySubmissionRecord,
  JobRecord,
  OrgStatusSnapshot,
  OutcomeRecord,
  PostMortemRecord,
  ProjectRecord,
  ServedKnowledge,
  ConstraintSetStatement,
} from '../api/contracts';
import { AvailabilityViolationError } from './errors';

/** The availability-bearing datum: every renderable record exposes the instant its facts became knowable. */
export interface AvailableDatum {
  /** The datum's identity for error messages (a ref/id — closed vocabulary, never free reasoning text). */
  readonly datumRef: string;
  /** The instant (epoch ms) at which this datum's facts became knowable. */
  readonly availableAt: number;
}

/** The availability instant of a project record (its last update — the lifecycle facts it serves). */
export function availabilityOfProject(record: ProjectRecord): number {
  return record.updatedAt;
}

/** The availability instant of a goal statement (its creation). */
export function availabilityOfGoal(record: GoalStatement): number {
  return record.createdAt;
}

/** The availability instant of a constraint set (its creation). */
export function availabilityOfConstraintSet(record: ConstraintSetStatement): number {
  return record.createdAt;
}

/** The availability instant of an organization status snapshot (the `at` it was observed at). */
export function availabilityOfOrgSnapshot(record: OrgStatusSnapshot): number {
  return record.at;
}

/**
 * The availability instant of a job record: a finished job's record
 * (status/result/completedAt) is knowable at its completion; a
 * pending job's submission is knowable at its submission. The
 * projection is CONSERVATIVE — the boundary serves the current
 * record, so the console never back-fills intermediate states into a
 * past view (what you could not yet know, you do not see).
 */
export function availabilityOfJob(record: JobRecord): number {
  return record.completedAt ?? record.submittedAt;
}

/** The availability instant of an outcome record (its asOf). */
export function availabilityOfOutcome(record: OutcomeRecord): number {
  return record.asOf;
}

/** The availability instant of a post-mortem record (its asOf). */
export function availabilityOfPostMortem(record: PostMortemRecord): number {
  return record.asOf;
}

/** The availability instant of a served knowledge entry (the instant the firm memory recorded it). */
export function availabilityOfKnowledge(record: ServedKnowledge): number {
  return record.record.asOf;
}

/** The availability instant of a gateway submission record (the instant the gateway decided). */
export function availabilityOfSubmission(record: GatewaySubmissionRecord): number {
  return record.kind === 'routed' ? record.routedAt : record.refusedAt;
}

/**
 * THE PROJECTION: filter a listing to what was knowable at the view
 * instant. Pure; order-preserving (the boundary's ordering is the
 * console's ordering — determinism).
 */
/** The availability instant of one record (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
export type AvailabilityOf<T> = (record: T) => number;

export function projectToView<T>(records: readonly T[], viewAt: number, availabilityOf: AvailabilityOf<T>): readonly T[] {
  return records.filter((record) => availabilityOf(record) <= viewAt);
}

/**
 * THE RENDER GATE: assert that one datum about to be rendered was
 * knowable at the view instant. Rendering a post-availability fact
 * is the typed AvailabilityViolationError — the render model calls
 * this for EVERY datum it paints.
 */
export function assertVisible(datum: AvailableDatum, viewAt: number): void {
  if (datum.availableAt > viewAt) {
    throw new AvailabilityViolationError(
      `the datum ${datum.datumRef} (available at ${datum.availableAt}) cannot be rendered at view time ${viewAt} — rendering a fact before its availability instant is a typed error (L4)`,
      datum.availableAt,
      viewAt,
    );
  }
}

/** The availability of a whole listing as one datum (the latest fact it carries — the conservative bound). */
export function availabilityOfListing(records: readonly AvailableDatum[]): number {
  let latest = 0;
  for (const record of records) {
    if (record.availableAt > latest) latest = record.availableAt;
  }
  return latest;
}

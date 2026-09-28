// @tradrl/control-domain — the typed error taxonomy.
//
// Laws honored here:
// - L20 (safety outside prompts): every rejection is a TYPED error with a
//   machine-checkable code — control-plane state changes never fail silent.
//   Mirrors the error discipline of @tradrl/agent-body
//   (`IllegalTransitionError`) and the fail-closed reporting of
//   @tradrl/domain-core's constraint evaluator.
// - Errors are data: `code` is a closed vocabulary (a contract), `details`
//   are human-readable field-prefixed problem strings (never executed).
//
// Throw sites: the compiler (`compileAcceptance`), the lifecycle reducer
// (`transitionProject`), the record factories/bindings, and the reference
// service (`services/control-plane`). Guards themselves never throw — they
// are total predicates; throwing happens in the factories that OWN the
// invariant being violated.

import type { ProjectLifecycleEvent, ProjectLifecycleStatus } from './lifecycle';

/** Closed vocabulary of control-plane failure codes. */
export const CONTROL_ERROR_CODES = [
  /** The goal statement failed structural validation (but is structured). */
  'invalid-goal',
  /** The goal's success criteria are not structured records (e.g. prose). */
  'unstructured-criteria',
  /** The success criteria are structured but vacuous (zero criteria). */
  'empty-success-criteria',
  /** The constraint-set statement failed structural validation. */
  'invalid-constraint-set',
  /** Goal and constraint set belong to different tenants (L12). */
  'goal-set-tenant-mismatch',
  /** Project tenant scope differs from the goal/constraint-set tenant scope (L12). */
  'project-tenant-mismatch',
  /** A lifecycle state or event failed structural validation. */
  'invalid-lifecycle-state',
  /** The transition is not an edge of the lifecycle state machine. */
  'illegal-transition',
  /** A transition precondition failed: no compiled acceptance criteria. */
  'missing-acceptance-criteria',
  /** A transition precondition failed: no bound organization. */
  'missing-organization-binding',
  /** An organization binding was attempted from a status that forbids it. */
  'invalid-binding-state',
  /** A project record / draft failed structural validation. */
  'invalid-project-record',
  /** Service: unknown project id within the requesting tenant scope. */
  'project-not-found',
  /** Service: project id already exists within the tenant. */
  'duplicate-project',
  /** Audit replay: sequence gap, corrupt entry or incoherent operation. */
  'invalid-audit-log',
] as const;

export type ControlErrorCode = (typeof CONTROL_ERROR_CODES)[number];

/** Guard: `ControlErrorCode`. */
export const isControlErrorCode = (v: unknown): v is ControlErrorCode =>
  typeof v === 'string' && (CONTROL_ERROR_CODES as readonly string[]).includes(v);

/**
 * Base class of every typed control-plane error. `details` carries
 * field-prefixed problem strings (e.g. `"horizon: endsAt must be after
 * startsAt"`); they are diagnostic text for humans, never executed.
 */
export class ControlDomainError extends Error {
  readonly code: ControlErrorCode;
  readonly details: readonly string[];

  constructor(code: ControlErrorCode, message: string, details: readonly string[] = []) {
    super(details.length === 0 ? message : `${message} (${details.join('; ')})`);
    this.name = 'ControlDomainError';
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}

/**
 * Thrown when an event is not a legal edge of the project lifecycle state
 * machine (including every escape from a terminal state). Mirrors
 * `IllegalTransitionError` from the agent-body lane.
 */
export class IllegalProjectTransitionError extends ControlDomainError {
  readonly from: ProjectLifecycleStatus;
  readonly event: ProjectLifecycleEvent;

  constructor(from: ProjectLifecycleStatus, event: ProjectLifecycleEvent) {
    super('illegal-transition', `illegal project lifecycle transition: ${from} --${event}-->`);
    this.name = 'IllegalProjectTransitionError';
    this.from = from;
    this.event = event;
  }
}

/**
 * Thrown when a transition is a legal edge but its precondition is unmet:
 * `activate`/`resume`/`complete` require compiled acceptance criteria;
 * `activate`/`resume` additionally require a bound organization ref.
 * Encoding the preconditions in the machine (not in caller discipline) is
 * what makes "active without acceptance criteria" inexpressible.
 */
export class ProjectPreconditionError extends ControlDomainError {
  readonly requirement: 'acceptance-criteria' | 'organization-binding';

  constructor(
    requirement: 'acceptance-criteria' | 'organization-binding',
    message: string,
    details: readonly string[] = [],
  ) {
    super(
      requirement === 'acceptance-criteria' ? 'missing-acceptance-criteria' : 'missing-organization-binding',
      message,
      details,
    );
    this.name = 'ProjectPreconditionError';
    this.requirement = requirement;
  }
}

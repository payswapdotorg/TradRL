// @tradrl/control-domain — ProjectLifecycle: the lifecycle state machine.
//
// THE control plane owns project lifecycle transitions. domain-core's
// `ProjectStatus` values are deliberately LABELS, not a machine ("Status
// values are labels, not a state machine: transitions are enforced by the
// control plane (T007)" — contracts/domain/project.md). This module IS
// that machine.
//
// States (per Work Order T007): draft -> active -> paused -> archived,
// plus the terminal states completed and abandoned.
//
// ```text
//   draft ──activate──► active ◄──resume── paused ◄──pause── active
//     │                   │                       │
//     ├─abandon─► abandoned │                   ├─complete─► completed
//     ├─archive──► archived │                   ├─abandon──► abandoned
//     ▼                   ▼                   ▼
//  abandoned          completed          archived  (all three terminal)
// ```
//
// Terminal discipline: completed, abandoned AND archived are terminal —
// nothing leaves the archive; there is no resurrection. Every illegal edge
// (including every terminal-state escape) is rejected with a typed
// `IllegalProjectTransitionError`.
//
// Preconditions (encoded in the machine, not in caller discipline):
// - `activate` and `resume` REQUIRE compiled acceptance criteria AND a
//   bound organization ref — "active without acceptance criteria" is
//   inexpressible (L7: attainment definitions precede operation).
// - `complete` REQUIRES compiled acceptance criteria — a final evaluation
//   is impossible without them.
//
// Effects are DATA (never executed here): they are the hand-off contract to
// the lanes that must act on a transition — the organization compiler /
// runtime (T016/T006) and the evaluation lane (T012); see
// services/control-plane/README.md.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L7, L15, L16; spec/DOMAIN-MODEL.md
// (Project); AGENTS.md ("Raw PnL is never the sole acceptance criterion",
// "Experiments retain reproducible lineage").

import { deepFreeze, isOneOf, isRecord } from './primitives';
import {
  AcceptanceCriteriaId,
  OrganizationRef,
  ProjectId,
  isAcceptanceCriteriaId,
  isOrganizationRef,
  isProjectId,
} from './ids';
import {
  ControlDomainError,
  IllegalProjectTransitionError,
  ProjectPreconditionError,
} from './errors';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Project lifecycle states. Mapping to domain-core's `ProjectStatus`
 * labels: draft↔draft, active↔active, paused↔paused, completed↔completed,
 * abandoned↔terminated, archived↔archived; domain-core's interim
 * `compiling` label is realized here as "draft with partial bindings"
 * (criteria compiled and/or organization bound while status stays draft).
 */
export const PROJECT_LIFECYCLE_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
  'completed',
  'abandoned',
] as const;

/** Project lifecycle state. */
export type ProjectLifecycleStatus = (typeof PROJECT_LIFECYCLE_STATUSES)[number];

/** Guard: `ProjectLifecycleStatus`. */
export const isProjectLifecycleStatus = isOneOf(PROJECT_LIFECYCLE_STATUSES);

/** Lifecycle events (the reducer's input vocabulary). */
export const PROJECT_LIFECYCLE_EVENTS = [
  'activate',
  'pause',
  'resume',
  'complete',
  'abandon',
  'archive',
] as const;

/** A project lifecycle event. */
export type ProjectLifecycleEvent = (typeof PROJECT_LIFECYCLE_EVENTS)[number];

/** Guard: `ProjectLifecycleEvent`. */
export const isProjectLifecycleEvent = isOneOf(PROJECT_LIFECYCLE_EVENTS);

/**
 * The transition table: for each status, the events that MAY be applied.
 * DERIVED from `EVENT_TARGETS` below, so the table and the target map can
 * never disagree.
 */
export const PROJECT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ProjectLifecycleStatus, readonly ProjectLifecycleEvent[]>
> = buildTransitionTable();

/**
 * For each event, the legal (source status -> target status) edges.
 * The single source of truth of the state machine.
 */
const EVENT_TARGETS: Readonly<
  Record<ProjectLifecycleEvent, Readonly<Partial<Record<ProjectLifecycleStatus, ProjectLifecycleStatus>>>>
> = deepFreeze({
  activate: { draft: 'active' },
  pause: { active: 'paused' },
  resume: { paused: 'active' },
  complete: { active: 'completed', paused: 'completed' },
  abandon: { draft: 'abandoned', active: 'abandoned', paused: 'abandoned' },
  archive: { draft: 'archived', paused: 'archived' },
});

function buildTransitionTable(): Readonly<
  Record<ProjectLifecycleStatus, readonly ProjectLifecycleEvent[]>
> {
  const table: Record<ProjectLifecycleStatus, ProjectLifecycleEvent[]> = {
    draft: [],
    active: [],
    paused: [],
    archived: [],
    completed: [],
    abandoned: [],
  };
  for (const event of PROJECT_LIFECYCLE_EVENTS) {
    const edges = EVENT_TARGETS[event];
    for (const from of Object.keys(edges) as ProjectLifecycleStatus[]) {
      table[from].push(event);
    }
  }
  return deepFreeze(table);
}

/**
 * `true` when applying `event` in `status` is a legal edge of the machine.
 * Total: invalid status/event => false.
 */
export function canTransitionProjectLifecycle(
  status: ProjectLifecycleStatus,
  event: ProjectLifecycleEvent,
): boolean {
  if (!isProjectLifecycleStatus(status) || !isProjectLifecycleEvent(event)) return false;
  return PROJECT_LIFECYCLE_TRANSITIONS[status].includes(event);
}

/** The target status of applying `event` in `status`, or `null` when illegal. */
export function transitionTarget(
  status: ProjectLifecycleStatus,
  event: ProjectLifecycleEvent,
): ProjectLifecycleStatus | null {
  if (!isProjectLifecycleStatus(status) || !isProjectLifecycleEvent(event)) return null;
  const target: ProjectLifecycleStatus | undefined = EVENT_TARGETS[event][status];
  return target === undefined ? null : target;
}

// ---------------------------------------------------------------------------
// Lifecycle state record
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a project: identity, machine status, and the two
 * bindings the machine's preconditions reason about — the compiled
 * acceptance criteria (null until compiled) and the bound organization
 * (null until the organization compiler's output is bound). The state
 * record carries the project id so every emitted effect is lineage-
 * addressable (L15).
 */
export interface ProjectLifecycleState {
  readonly projectId: ProjectId;
  readonly status: ProjectLifecycleStatus;
  /** Content-addressed id of the compiled AcceptanceCriteria; null pre-compilation. */
  readonly acceptanceCriteriaId: AcceptanceCriteriaId | null;
  /** Opaque ref to the bound organization (T016); null until bound. */
  readonly organizationRef: OrganizationRef | null;
}

/**
 * Guard: `ProjectLifecycleState`. Encodes the machine's POSTCONDITIONS as
 * record invariants (fail-closed — a hand-crafted record cannot describe a
 * state the machine could never produce):
 * - `draft`, `abandoned`, `archived`: bindings optional (a project may be
 *   abandoned/archived from draft with nothing bound);
 * - `active` and `paused` REQUIRE both bindings (they are only reachable
 *   through `activate`, which requires them);
 * - `completed` REQUIRES acceptance criteria and the organization binding
 *   (only reachable from active/paused through `complete`, which requires
 *   the criteria; both source states carry the organization).
 */
export function isProjectLifecycleState(v: unknown): v is ProjectLifecycleState {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isProjectLifecycleStatus(v.status)) return false;
  if (v.acceptanceCriteriaId !== null && !isAcceptanceCriteriaId(v.acceptanceCriteriaId)) {
    return false;
  }
  if (v.organizationRef !== null && !isOrganizationRef(v.organizationRef)) return false;
  switch (v.status) {
    case 'active':
    case 'paused':
    case 'completed':
      return v.acceptanceCriteriaId !== null && v.organizationRef !== null;
    case 'draft':
    case 'abandoned':
    case 'archived':
      return true;
  }
}

// ---------------------------------------------------------------------------
// Effects (data-only hand-offs)
// ---------------------------------------------------------------------------

/**
 * A transition effect. The control DOMAIN never executes effects; the
 * reference service and the consuming lanes do (README). Every effect
 * carries the project id (L15: continuity is queryable).
 */
export type ProjectTransitionEffect =
  | {
      /** Hand the bound organization its activation: project + compiled criteria. */
      readonly kind: 'organization.activate';
      readonly projectId: ProjectId;
      readonly organizationRef: OrganizationRef;
      readonly acceptanceCriteriaId: AcceptanceCriteriaId;
    }
  | {
      /** The bound organization must suspend (pause/complete/abandon). */
      readonly kind: 'organization.suspend';
      readonly projectId: ProjectId;
      readonly organizationRef: OrganizationRef;
    }
  | {
      /** The bound organization may resume (resume). */
      readonly kind: 'organization.resume';
      readonly projectId: ProjectId;
      readonly organizationRef: OrganizationRef;
    }
  | {
      /** Trigger the FINAL evaluation against the compiled criteria (complete). */
      readonly kind: 'evaluation.finalize';
      readonly projectId: ProjectId;
      readonly acceptanceCriteriaId: AcceptanceCriteriaId;
    }
  | {
      /** The project record enters retention/archive treatment (archive). */
      readonly kind: 'record.archive';
      readonly projectId: ProjectId;
    };

/** Guard: `ProjectTransitionEffect`. */
export function isProjectTransitionEffect(v: unknown): v is ProjectTransitionEffect {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'organization.activate':
      return (
        isProjectId(v.projectId) &&
        isOrganizationRef(v.organizationRef) &&
        isAcceptanceCriteriaId(v.acceptanceCriteriaId)
      );
    case 'organization.suspend':
    case 'organization.resume':
      return isProjectId(v.projectId) && isOrganizationRef(v.organizationRef);
    case 'evaluation.finalize':
      return isProjectId(v.projectId) && isAcceptanceCriteriaId(v.acceptanceCriteriaId);
    case 'record.archive':
      return isProjectId(v.projectId);
    default:
      return false;
  }
}

/** Result of the pure reducer: the next state plus the emitted effects. */
export interface ProjectTransitionResult {
  readonly state: ProjectLifecycleState;
  readonly effects: readonly ProjectTransitionEffect[];
}

// ---------------------------------------------------------------------------
// The reducer (pure; typed errors on every illegal path)
// ---------------------------------------------------------------------------

/**
 * The project lifecycle reducer: applies `event` to `state` and returns the
 * NEXT state plus the effects the transition emits. PURE — no ambient
 * state, no clock, no I/O; the input record is never mutated and both
 * output values are deeply frozen.
 *
 * Fail-closed with typed errors:
 * - structurally invalid state or unknown event ->
 *   `ControlDomainError('invalid-lifecycle-state')`;
 * - an edge that is not in the table (including EVERY terminal-state
 *   escape) -> `IllegalProjectTransitionError`;
 * - a legal edge whose precondition is unmet (`activate`/`resume` without
 *   compiled criteria or bound organization, `complete` without criteria)
 *   -> `ProjectPreconditionError`.
 */
export function transitionProject(
  state: ProjectLifecycleState,
  event: ProjectLifecycleEvent,
): ProjectTransitionResult {
  if (!isProjectLifecycleState(state)) {
    throw new ControlDomainError(
      'invalid-lifecycle-state',
      'transitionProject: state failed structural validation',
      ['state: expected a valid ProjectLifecycleState record'],
    );
  }
  if (!isProjectLifecycleEvent(event)) {
    throw new ControlDomainError(
      'invalid-lifecycle-state',
      `transitionProject: unknown lifecycle event ${JSON.stringify(event)}`,
      ['event: expected one of ' + PROJECT_LIFECYCLE_EVENTS.join(', ')],
    );
  }

  const target = transitionTarget(state.status, event);
  if (target === null) {
    throw new IllegalProjectTransitionError(state.status, event);
  }

  // Preconditions (fail-closed, re-checked on EVERY edge into/through the
  // operating states — a hand-crafted state cannot smuggle itself past).
  if (target === 'active') {
    if (state.acceptanceCriteriaId === null) {
      throw new ProjectPreconditionError(
        'acceptance-criteria',
        `transitionProject: ${state.status} --${event}--> active requires compiled acceptance criteria`,
        ['acceptanceCriteriaId: null — compile the goal first'],
      );
    }
    if (state.organizationRef === null) {
      throw new ProjectPreconditionError(
        'organization-binding',
        `transitionProject: ${state.status} --${event}--> active requires a bound organization ref`,
        ['organizationRef: null — bind an organization first'],
      );
    }
  }
  if (event === 'complete' && state.acceptanceCriteriaId === null) {
    throw new ProjectPreconditionError(
      'acceptance-criteria',
      'transitionProject: complete requires compiled acceptance criteria for the final evaluation',
      ['acceptanceCriteriaId: null — compile the goal first'],
    );
  }

  const nextState: ProjectLifecycleState = { ...state, status: target };
  const effects = effectsFor(state, event);
  return deepFreeze({ state: nextState, effects: deepFreeze(effects) });
}

/** Computes the effects of a LEGAL (state, event) edge. Deterministic order. */
function effectsFor(
  state: ProjectLifecycleState,
  event: ProjectLifecycleEvent,
): ProjectTransitionEffect[] {
  const org = state.organizationRef;
  const criteria = state.acceptanceCriteriaId;
  const effects: ProjectTransitionEffect[] = [];
  switch (event) {
    case 'activate':
      // Preconditions guarantee org and criteria are bound here.
      effects.push({
        kind: 'organization.activate',
        projectId: state.projectId,
        organizationRef: org as OrganizationRef,
        acceptanceCriteriaId: criteria as AcceptanceCriteriaId,
      });
      break;
    case 'pause':
      effects.push({
        kind: 'organization.suspend',
        projectId: state.projectId,
        organizationRef: org as OrganizationRef,
      });
      break;
    case 'resume':
      effects.push({
        kind: 'organization.resume',
        projectId: state.projectId,
        organizationRef: org as OrganizationRef,
      });
      break;
    case 'complete':
      effects.push({
        kind: 'evaluation.finalize',
        projectId: state.projectId,
        acceptanceCriteriaId: criteria as AcceptanceCriteriaId,
      });
      if (org !== null) {
        effects.push({
          kind: 'organization.suspend',
          projectId: state.projectId,
          organizationRef: org,
        });
      }
      break;
    case 'abandon':
      if (org !== null) {
        effects.push({
          kind: 'organization.suspend',
          projectId: state.projectId,
          organizationRef: org,
        });
      }
      break;
    case 'archive':
      effects.push({ kind: 'record.archive', projectId: state.projectId });
      break;
  }
  return effects;
}

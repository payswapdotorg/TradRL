// deploy/vercel/runtime/durable.ts — THE W-3e DURABLE HYDRATION SEAM (W-25D, defect D-5).
//
// WHAT THIS IS: the seam deploy/wire/production.md documented as "the
// W-3e/lead step". T041's port methods are SYNCHRONOUS (in-memory by
// design — the frozen service is never edited), while the durable Neon
// adapters (deploy/wire, W-3d) are ASYNC. This module bridges the two:
// the composition root (runtime/compose.ts) is injected with SYNC
// in-memory ports whose state is a PROJECTION of the durable stores.
//
// THE PROJECTION (boot-time, per instance): at the first request after a
// cold start the seam reads the durable stores —
//   1. the project REGISTRY (NeonProjectStore.projectRecordsOf, creation
//      order) — for every record, its GOAL SET (the create-project input's
//      goal + constraint set, persisted at createProject time) drives the
//      REAL T007 control plane's own createProject (the domain law —
//      compileAcceptance, the record factory — stays in the REAL frozen
//      service; the seam orchestrates, never re-implements);
//   2. the project EVENT LOG (append-only, ordinal order) — every
//      lifecycle event replays through the real reducer; every
//      `organization-bound` event replays through the real binder;
//   3. the KNOWLEDGE of every reconstructed project (NeonFirmMemoryStore,
//      point-in-time max — everything the store holds);
//   4. the OUTCOMES + POST-MORTEMS of every reconstructed project
//      (NeonOutcomeLearningStore).
// Any failed durable read fails the WHOLE projection (a partial projection
// would be a silent divergence); a record that cannot reconstruct under
// the current domain law is SKIPPED and reported (never a crash).
//
// THE WRITE-THROUGH ORDERING LAW (one sentence, pinned by durable.test.ts):
// every mutation applies to the in-memory port to build the request's own
// answer, the durable writes are issued in dependency order (goal set ->
// record for creates; record -> event for transitions/binds), and the HOST
// awaits them (drain) BEFORE the response is served — a failed durable
// write replaces the response with the typed 503 and triggers a full
// re-projection from the durable truth, so the unconfirmed mutation is
// never served and the in-memory state never silently diverges. (The
// re-projection — not a per-field rollback — is the seam's universal
// recovery: the durable store is the truth, the in-memory port is its
// projection, and a failed write means the projection is stale.)
//
// THE DEGRADATION MODEL (R46, the matrix):
//   - Neon keys ABSENT (the durable backing resolved without them): the
//     seam is not built; compose.ts serves the typed `deploy_adapter_absent`
//     stubs for the Neon-backed surfaces.
//   - Neon DOWN at boot (or a re-projection fails): the projection answers
//     the typed failure of the failed read (e.g. `neon_unreachable`) on
//     every Neon-backed route, per request (no circuit state — settled()
//     retries the projection on every request while it is failed), and
//     everything else (authn/authz, rate limits, metering, audit, meta,
//     the gateway/jobs stubs) keeps working.
//   - Neon down MID-INSTANCE: reads keep serving the boot projection (the
//     projection IS the serving surface — never a crash, never a stale
//     write); writes degrade per the ordering law above.
//
// WHAT PERSISTS (the D-5 payoff): a launched project (POST /v1/projects)
// persists its registry record + goal set; its organization bindings and
// lifecycle transitions append to the event log — and every cold start
// rehydrates the whole world, so a project launched on one serverless
// instance appears in the switcher (with its goal, its lifecycle state and
// its bound organization) on every other instance. The knowledge/outcome
// surfaces are READ projections in this wave: they rehydrate whatever the
// durable stores hold (their writers are the owning T033/T034 services,
// not this boundary — the ports are read-only by design). Since W-26B the
// composition composes the SAME simulated execution-gateway + job-
// submission engines the demo backing composes over this seam (runtime/
// compose.ts — the durable superset law), and the boot world
// (runtime/durable-world.ts) seeds the demo world + the fixture substance
// into these stores; jobs and the org-status snapshots stay API-OWNED
// per-instance state (the frozen service's closures — the disclosed
// limitation, re-seeded per instance by the boot world + the tick).
//
// WHAT STAYS API-OWNED (honest limitation): the boundary's job store and
// org-status snapshots live in the frozen service's closure with no
// injection surface — they remain per-instance under the durable backing
// and reset on cold starts (documented; a T041-side change would be needed
// to persist them).
//
// Zero-dep law: platform APIs only. Spec anchors: ARCHITECTURE-LOCK
// invariant-9 (ports injected, never imported by adapters), L4/L8/L12/L15,
// R46, D-033, D-5; deploy/wire/production.md (the composition law).

import {
  ControlDomainError,
  createControlPlane,
  type ControlPlane,
  type ConstraintSetStatement,
  type GoalStatement,
} from '../../../services/control-plane/src/index';
import type {
  ControlPlanePort,
  FirmMemoryPort,
  OutcomeLearningPort,
  OutcomeRecordMirror,
  PortFailure,
  PortResult,
  PostMortemRecordMirror,
  ProjectRecord,
  ServedKnowledge,
  TransitionProjectResponse,
} from '../../../services/api/src/index';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, NeonProjectStore, type GoalSetRecord, type NeonStoreDeps } from '../../adapters/neon/stores';
import type { NeonConfig } from '../../adapters/neon/client';
import type { ServedKnowledgeMirror } from '../../adapters/neon/mirrors';
import { enabledAdapters, type ProviderEnv } from '../../wire/composition';
import { isNonEmptyString, isRecord, type FetchLike, type InstantSourceMirror, type StoreFailure, type StoreResult } from '../../adapters/shared';

// ---------------------------------------------------------------------------
// The seam's inputs + observable surfaces
// ---------------------------------------------------------------------------

/** The seam's injected dependencies (all explicit — never ambient). */
export interface DurableSeamDeps {
  /** The durable-provider environment (the wire's readProviderEnv — the single provider implementation). */
  readonly providerEnv: ProviderEnv;
  /** The composition's credential tenant (L12 — the projection's scope: only this tenant's durable rows hydrate). */
  readonly tenant: string;
  /** The injected fetch for the Neon stores (fakes in tests; the platform fetch when absent). */
  readonly fetchLike?: FetchLike;
  /** The injected instant source (the host MAY read the wall clock — compose.ts's own law). */
  readonly instants: InstantSourceMirror;
}

/** One hydrated goal set — the create-project input's goal + constraint set, verbatim (what main already carries). */
export interface HydratedGoalSet {
  readonly goal: unknown;
  readonly constraintSet: unknown;
}

/**
 * The boot projection's report — the observable hydration surface (the
 * order is the report's structure: registry -> events -> knowledge ->
 * outcomes -> post-mortems; the counts are the completeness pin).
 */
export interface ProjectionReport {
  /** Projects reconstructed through the REAL control plane (creation order). */
  readonly projects: number;
  /** Lifecycle/organization events replayed (ordinal order per project). */
  readonly events: number;
  /** Knowledge envelopes hydrated. */
  readonly knowledge: number;
  /** Outcome records hydrated. */
  readonly outcomes: number;
  /** Post-mortem records hydrated. */
  readonly postMortems: number;
  /** Rows that could not reconstruct (a missing goal set, a domain-law refusal) — skipped, never a crash. */
  readonly skipped: readonly { readonly project: string; readonly reason: string }[];
}

/** One pending durable write (queued in port order; drained by the host before the response is served). */
interface PendingDurableWrite {
  readonly label: string;
  readonly run: () => Promise<StoreResult<unknown>>;
}

/** The drain verdict: ok, or the typed failure of the first failed durable write. */
export type DrainResult = { readonly ok: true } | { readonly ok: false; readonly error: StoreFailure };

/**
 * The durable backing handle (what compose.ts carries for the router): the
 * sync ports the composition root is injected with + the projection
 * lifecycle the host drives.
 */
export interface DurableBackingHandle {
  /** The SYNC in-memory ports (hydrated from the durable stores — the seam's whole point). */
  readonly ports: {
    readonly controlPlane: ControlPlanePort;
    readonly firmMemory: FirmMemoryPort;
    readonly outcomeLearning: OutcomeLearningPort;
  };
  /**
   * Await the projection: starts it on the first call (the boot-time
   * projection — the first request after the cold start pays the
   * hydration), awaits any in-flight (re-)projection, and — per request,
   * no circuit state — retries a FAILED projection (so a Neon that
   * recovers mid-instance heals the surfaces without a cold start).
   */
  settled(): Promise<void>;
  /**
   * Force a full re-projection from the durable truth (W-26B — the boot
   * world's post-seed refresh; see the builder's `reproject`). A failure
   * leaves the seam in the typed degraded state (the per-request retry
   * heals).
   */
  reproject(): Promise<void>;
  /**
   * Drain the request's pending durable writes (the host calls this AFTER
   * `service.handle` and BEFORE serving the response). An empty queue is
   * ok; the first failed write stops the drain, reports the typed failure
   * (the host serves the typed 503) and triggers the re-projection.
   */
  drain(): Promise<DrainResult>;
  /**
   * The hydrated goal set of one project (the host-owned goal read route's
   * data). The typed degraded state while the projection is down; `null`
   * when the projection holds no goal set for the project.
   */
  goalOf(projectId: string): { readonly ok: true; readonly value: HydratedGoalSet | null } | { readonly ok: false; readonly error: StoreFailure };
  /** The last COMPLETED projection's report (null before the first completion — the order/completeness surface). */
  lastProjection(): ProjectionReport | null;
  /** The typed failure of the last failed projection (null when none). */
  lastFailure(): StoreFailure | null;
}

// ---------------------------------------------------------------------------
// The event vocabulary (the seam's two append-only event kinds)
// ---------------------------------------------------------------------------

/**
 * The organization-binding event (the seam's event for bindOrganization —
 * `organization-bound` with the ref in the detail; the lifecycle events
 * carry the reducer's own vocabulary verbatim).
 */
export const ORGANIZATION_BOUND_EVENT = 'organization-bound';

/** The point-in-time instant the projection reads at (everything the durable store holds — L4's ceiling). Exported by W-26B: the boot world's guarded fixture reads use the SAME ceiling. */
export const HYDRATION_AT = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER

// ---------------------------------------------------------------------------
// The seam builder
// ---------------------------------------------------------------------------

/**
 * The Neon store deps of the seam's own stores (the shared construction —
 * W-26B): the same config/fetch/instants `buildDurableBacking` builds its
 * stores over, factored out so the boot world (runtime/durable-world.ts)
 * rides the SAME provider configuration for its guarded fixture reads and
 * writes. Returns `null` exactly when the seam would not build (Neon keys
 * incomplete — the matrix's absent row).
 */
export function neonStoreDepsOf(deps: DurableSeamDeps): NeonStoreDeps | null {
  if (!enabledAdapters(deps.providerEnv).neon) return null;
  const neon = deps.providerEnv.neon;
  const config: NeonConfig = {
    apiHost: neon.host as string,
    database: neon.database as string,
    apiUser: neon.user as string,
    apiKey: neon.apiKey as string,
  };
  return { config, ...(deps.fetchLike === undefined ? {} : { fetchLike: deps.fetchLike }), instants: deps.instants };
}

/**
 * Build the durable backing: the Neon stores + the sync in-memory ports
 * over the REAL T007 control plane, with the boot-time projection and the
 * write-through law. Returns `null` when the Neon adapter is NOT enabled
 * (its env keys are absent — the caller serves the typed absent stubs; the
 * matrix's Neon-absent row). The composition stays PURE: the projection
 * starts lazily on the first `settled()` (never at build time — no ambient
 * network), exactly once per instance.
 */
export function buildDurableBacking(deps: DurableSeamDeps): DurableBackingHandle | null {
  const neonDeps = neonStoreDepsOf(deps);
  if (neonDeps === null) return null;
  const firmMemoryStore = new NeonFirmMemoryStore(neonDeps);
  const outcomeStore = new NeonOutcomeLearningStore(neonDeps);
  const projectStore = new NeonProjectStore(neonDeps);

  // The mutable projection state. `current` swaps ATOMICALLY at the end of
  // a successful projection (the event loop makes the swap synchronous);
  // `state` gates every port call — a stale (failed-write) projection is
  // never served, even though `current` still holds it.
  type Phase = 'idle' | 'projecting' | 'ready' | 'failed';
  let phase: Phase = 'idle';
  let liveGoalSets: Map<string, GoalSetRecord> = new Map();
  let current: {
    readonly controlPlane: ControlPlane;
    readonly knowledge: readonly ServedKnowledgeMirror[];
    readonly outcomes: readonly unknown[];
    readonly postMortems: readonly unknown[];
    readonly goalSets: ReadonlyMap<string, GoalSetRecord>;
    readonly report: ProjectionReport;
  } | null = null;
  let failure: StoreFailure | null = null;
  let report: ProjectionReport | null = null;
  let inFlight: Promise<void> | null = null;
  /**
   * W-26C (the boot-world race hardening): a failed durable write marks
   * the seam DIRTY — a projection whose reads PREDATE that failure (an
   * attempt already in flight when the write failed) must never satisfy a
   * later read or the boot world's registry guard: the ports stay degraded
   * and settled()/reproject() land a projection that STARTED after the
   * failure (its reads postdate it — the durable truth). Cleared only by
   * such a post-failure successful projection.
   */
  let dirty = false;
  const pending: PendingDurableWrite[] = [];

  // -------------------------------------------------------------------------
  // THE BOOT-TIME PROJECTION (registry -> events -> knowledge -> outcomes)
  // -------------------------------------------------------------------------

  async function project(): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: StoreFailure }> {
    const controlPlane = createControlPlane(); // the REAL T007 service — a FRESH instance per projection (the universal recovery)
    const knowledge: ServedKnowledgeMirror[] = [];
    const outcomes: unknown[] = [];
    const postMortems: unknown[] = [];
    const goalSets = new Map<string, GoalSetRecord>();
    const skipped: { readonly project: string; readonly reason: string }[] = [];
    let events = 0;

    // 1. THE REGISTRY (creation order — the D-5 core).
    const registry = await projectStore.projectRecordsOf(deps.tenant);
    if (!registry.ok) return { ok: false, error: registry.error };
    const reconstructed: { readonly id: string }[] = [];
    for (const row of registry.value) {
      if (!isRecord(row)) {
        skipped.push({ project: '<malformed-row>', reason: 'the stored project row is not an object' });
        continue;
      }
      const id = row.id;
      const name = row.name;
      const executionMode = row.executionMode;
      const createdAt = row.createdAt;
      if (!isNonEmptyString(id) || !isNonEmptyString(name) || !isNonEmptyString(executionMode) || typeof createdAt !== 'number') {
        skipped.push({ project: typeof id === 'string' ? id : '<malformed-row>', reason: 'the stored project row lacks id/name/executionMode/createdAt' });
        continue;
      }
      if (row.tenantId !== deps.tenant) {
        skipped.push({ project: id, reason: 'the stored project row belongs to another tenant (L12 — never served)' });
        continue;
      }
      // 2. THE GOAL SET (the create-project input's goal + constraint set — the seam persists them at createProject time).
      const goalSet = await projectStore.goalSetOf(deps.tenant, id);
      if (!goalSet.ok) return { ok: false, error: goalSet.error };
      if (goalSet.value === null) {
        skipped.push({ project: id, reason: 'no durable goal set (the record cannot reconstruct through the real control plane)' });
        continue;
      }
      try {
        controlPlane.createProject({
          id: id as never,
          tenantId: deps.tenant as never,
          name,
          executionMode: executionMode as never,
          goal: goalSet.value.goal as GoalStatement,
          constraintSet: goalSet.value.constraintSet as ConstraintSetStatement,
          at: createdAt as never,
        });
      } catch (cause) {
        skipped.push({ project: id, reason: cause instanceof ControlDomainError ? cause.code : 'the record failed reconstruction under the current domain law' });
        continue;
      }
      goalSets.set(id, goalSet.value);
      reconstructed.push({ id });

      // 3. THE EVENT LOG (ordinal order): lifecycle events replay through
      //    the real reducer; organization bindings through the real binder.
      const log = await projectStore.projectEventsOf(deps.tenant, id);
      if (!log.ok) return { ok: false, error: log.error };
      for (const entry of log.value) {
        try {
          if (entry.event === ORGANIZATION_BOUND_EVENT) {
            const detail = entry.detail;
            if (!isRecord(detail) || !isNonEmptyString(detail.organizationRef)) {
              skipped.push({ project: id, reason: `event ${ORGANIZATION_BOUND_EVENT}: the detail lacks organizationRef` });
              continue;
            }
            controlPlane.bindOrganization({ tenantId: deps.tenant as never, projectId: id as never, organizationRef: detail.organizationRef as never, at: entry.at as never });
          } else {
            controlPlane.transition({ tenantId: deps.tenant as never, projectId: id as never, event: entry.event as never, at: entry.at as never });
          }
          events += 1;
        } catch (cause) {
          skipped.push({ project: id, reason: `event ${entry.event}: ${cause instanceof ControlDomainError ? cause.code : 'rejected'}` });
        }
      }
    }

    // 4. THE KNOWLEDGE + 5. THE OUTCOMES/POST-MORTEMS of every
    //    reconstructed project (a failed read fails the WHOLE projection —
    //    a partial projection would be a silent divergence).
    for (const { id } of reconstructed) {
      const served = await firmMemoryStore.queryKnowledge({ tenant: deps.tenant, project: id }, { at: HYDRATION_AT, retention: null });
      if (!served.ok) return { ok: false, error: served.error };
      knowledge.push(...served.value);
    }
    for (const { id } of reconstructed) {
      const outcomeRows = await outcomeStore.queryOutcomes({ tenant: deps.tenant, project: id }, { at: HYDRATION_AT, retention: null });
      if (!outcomeRows.ok) return { ok: false, error: outcomeRows.error };
      outcomes.push(...outcomeRows.value);
      const postMortemRows = await outcomeStore.queryPostMortems({ tenant: deps.tenant, project: id }, { at: HYDRATION_AT, retention: null });
      if (!postMortemRows.ok) return { ok: false, error: postMortemRows.error };
      postMortems.push(...postMortemRows.value);
    }

    // THE ATOMIC SWAP — the projection becomes the serving state.
    current = {
      controlPlane,
      knowledge: Object.freeze(knowledge),
      outcomes: Object.freeze(outcomes),
      postMortems: Object.freeze(postMortems),
      goalSets,
      report: { projects: reconstructed.length, events, knowledge: knowledge.length, outcomes: outcomes.length, postMortems: postMortems.length, skipped: Object.freeze([...skipped]) },
    };
    liveGoalSets = goalSets; // the live overlay the createProject write-through extends
    report = current.report;
    failure = null;
    return { ok: true };
  }

  /** Run one projection attempt, applying the phase transitions (never throws). */
  async function attempt(): Promise<void> {
    phase = 'projecting';
    // W-26C: an attempt started while the seam is dirty reads the
    // POST-failure durable truth — only such an attempt may clear the flag
    // (a pre-failure attempt completing late must leave it set).
    const startedDirty = dirty;
    try {
      const result = await project();
      if (result.ok) {
        phase = 'ready';
        if (startedDirty) dirty = false;
      } else {
        failure = result.error;
        phase = 'failed';
      }
    } catch (cause) {
      // Unreachable by construction (the stores are typed, the service is
      // wrapped) — a throw here is a seam bug; the boundary still never
      // crashes (R46): the typed degraded state answers.
      failure = { code: 'durable_projection_failed', message: `the durable projection failed unexpectedly: ${(cause as Error).message}` };
      phase = 'failed';
    } finally {
      inFlight = null;
    }
  }

  function settled(): Promise<void> {
    // W-26C: a dirty-but-ready seam (a projection completed with
    // pre-failure reads) re-projects too — settled() only returns over a
    // projection that started after the last failed write.
    if (inFlight === null && (phase !== 'ready' || dirty)) {
      inFlight = attempt(); // the boot projection, a re-projection after a failed write, or the per-request retry of a failed projection
    }
    return inFlight === null ? Promise.resolve() : inFlight;
  }

  /**
   * Force a full re-projection from the durable truth (W-26B — the boot
   * world's refresh): the boot seed and the fixture boot-writes change the
   * durable stores AFTER the boot projection ran, so the composition
   * refreshes the projection before the first serve — the seeded world
   * becomes the serving projection (never a stale, pre-seed one). Joins any
   * in-flight attempt first, then runs exactly one fresh projection and
   * awaits it; a failure leaves the seam in the typed degraded state (the
   * per-request `settled()` retry heals — the same law as a failed boot
   * projection).
   */
  async function reproject(): Promise<void> {
    if (inFlight !== null) {
      await inFlight; // attempt() never throws (it catches into the typed failure state)
    }
    phase = 'projecting';
    inFlight = attempt();
    await inFlight;
  }

  // -------------------------------------------------------------------------
  // The typed degraded state (R46 — never a crash, never a silent empty)
  // -------------------------------------------------------------------------

  function degraded(): PortFailure {
    // The last known durable failure surfaces verbatim (the write failure's
    // own code — e.g. neon_unreachable — while the re-projection runs, and
    // the failed projection's code after it lands); only a never-projected
    // seam answers the pending code.
    if (failure !== null) {
      return { code: failure.code, message: `${failure.message} (the durable projection is degraded; the boundary degrades this route — R46)` };
    }
    return { code: 'durable_projection_pending', message: 'the durable projection is in flight (the boot-time hydration or a re-projection — the host awaits settled()); the boundary degrades this route (R46)' };
  }

  function requireReady(): { readonly ok: false; readonly error: PortFailure } | null {
    // W-26C: a DIRTY seam never serves — a projection whose reads predate
    // the last failed write may hold the unconfirmed mutation (the silent
    // divergence the W-25D law forbids); the typed degraded state answers
    // until a post-failure projection lands.
    return phase === 'ready' && current !== null && !dirty ? null : { ok: false, error: degraded() };
  }

  function crossTenant(): PortFailure {
    return { code: 'cross_tenant_access', message: `the durable seam serves the deployment's credential tenant only (L12) — refusing the cross-tenant mutation` };
  }

  // -------------------------------------------------------------------------
  // THE SYNC PORTS (the REAL control plane behind the write-through law)
  // -------------------------------------------------------------------------

  /** Adapt the REAL (throwing) control plane call to the boundary's result-shaped port — the interop.test.ts precedent, deploy-side. */
  function adapt<T>(operation: () => T): PortResult<T> {
    try {
      return { ok: true, value: operation() };
    } catch (cause) {
      if (cause instanceof ControlDomainError) {
        return {
          ok: false,
          error: {
            code: cause.code,
            message: cause.message,
            ...(cause.details.length === 0 ? {} : { problems: cause.details.map((detail) => ({ path: detail.split(':')[0] ?? '', message: detail })) }),
          },
        };
      }
      throw cause; // a non-typed throw is a seam bug — loud, never swallowed
    }
  }

  const controlPlanePort: ControlPlanePort = {
    createProject(input): PortResult<ProjectRecord> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      if (input.tenantId !== deps.tenant) return { ok: false, error: crossTenant() };
      const result = adapt(() => current!.controlPlane.createProject({
        id: input.id as never,
        tenantId: input.tenantId as never,
        name: input.name,
        executionMode: input.executionMode as never,
        goal: input.goal as GoalStatement,
        constraintSet: input.constraintSet as ConstraintSetStatement,
        at: input.at as never,
      }));
      if (!result.ok) return result;
      const record = result.value;
      const projectId = input.id as string;
      const goalSet: GoalSetRecord = { goal: input.goal, constraintSet: input.constraintSet };
      // The live goal-set overlay (the projection's map, extended by this
      // create — the host goal read serves it immediately; a failed drain's
      // re-projection rebuilds the map from the durable truth, wiping any
      // unconfirmed overlay).
      liveGoalSets.set(projectId, goalSet);
      // WRITE-THROUGH (dependency order: the goal set FIRST — a partial
      // failure leaves an unread orphan goal set, never a record that
      // cannot reconstruct — then the registry record).
      pending.push({ label: 'goalset.put', run: () => projectStore.putGoalSet(deps.tenant, projectId, goalSet) });
      pending.push({ label: 'project.put', run: () => projectStore.putProjectRecord(deps.tenant, record) });
      return { ok: true, value: record as never };
    },
    getProject(tenantId, projectId): PortResult<ProjectRecord> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      const result = adapt(() => current!.controlPlane.getProject(tenantId as never, projectId as never));
      return result.ok ? { ok: true, value: result.value as never } : result;
    },
    projectsOf(tenantId): PortResult<readonly ProjectRecord[]> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      const result = adapt(() => current!.controlPlane.projectsOf(tenantId as never));
      return result.ok ? { ok: true, value: result.value as never } : result;
    },
    transition(input): PortResult<TransitionProjectResponse> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      if (input.tenantId !== deps.tenant) return { ok: false, error: crossTenant() };
      const result = adapt(() => current!.controlPlane.transition({
        tenantId: input.tenantId as never,
        projectId: input.projectId as never,
        event: input.event as never,
        at: input.at as never,
      }));
      if (!result.ok) return result;
      const projectId = input.projectId as string;
      // WRITE-THROUGH (the record snapshot FIRST, the event SECOND — a
      // partial failure loses the transition, consistent with the 503 the
      // caller receives; the event log is the lifecycle truth the next
      // projection replays).
      pending.push({ label: 'project.put', run: () => projectStore.putProjectRecord(deps.tenant, result.value.record) });
      pending.push({ label: 'event.append', run: () => projectStore.appendProjectEvent({ tenant: deps.tenant, projectId, event: input.event, at: input.at }) });
      return { ok: true, value: result.value as never };
    },
    bindOrganization(input): PortResult<ProjectRecord> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      if (input.tenantId !== deps.tenant) return { ok: false, error: crossTenant() };
      const result = adapt(() => current!.controlPlane.bindOrganization({
        tenantId: input.tenantId as never,
        projectId: input.projectId as never,
        organizationRef: input.organizationRef as never,
        at: input.at as never,
      }));
      if (!result.ok) return result;
      const projectId = input.projectId as string;
      pending.push({ label: 'project.put', run: () => projectStore.putProjectRecord(deps.tenant, result.value) });
      pending.push({ label: 'event.append', run: () => projectStore.appendProjectEvent({ tenant: deps.tenant, projectId, event: ORGANIZATION_BOUND_EVENT, at: input.at, detail: { organizationRef: input.organizationRef } }) });
      return { ok: true, value: result.value as never };
    },
  };

  const firmMemoryPort: FirmMemoryPort = {
    queryKnowledge(query, options): PortResult<readonly ServedKnowledge[]> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      // The projection contract: serve exactly what the durable store's
      // row set for the scope would serve (scope + point-in-time + the
      // ordinal order; L4 — the future is never returned).
      const served = current.knowledge.filter((entry) => {
        const record = entry.record as { readonly tenant?: unknown; readonly project?: unknown; readonly knowledgeId?: unknown; readonly asOf?: unknown };
        if (record.tenant !== query.tenant) return false;
        if (record.project !== query.project) return false;
        if (query.knowledgeId !== undefined && record.knowledgeId !== query.knowledgeId) return false;
        if (options.activeOnly === true && entry.status !== 'active') return false;
        if (typeof record.asOf === 'number' && record.asOf > options.at) return false;
        return true;
      });
      return { ok: true, value: Object.freeze([...served]) as never };
    },
  };

  const outcomeLearningPort: OutcomeLearningPort = {
    queryOutcomes(query, options): PortResult<readonly OutcomeRecordMirror[]> {
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      const served = current.outcomes.filter((record) => {
        if (!isRecord(record)) return false;
        return record.tenant === query.tenant && record.project === query.project;
      });
      return { ok: true, value: foldOutcomes(served, options.latestPerOutcome === true) as never };
    },
    queryPostMortems(query, _options): PortResult<readonly PostMortemRecordMirror[]> {
      void _options;
      const guard = requireReady();
      if (guard !== null || current === null) return guard ?? { ok: false, error: degraded() };
      const served = current.postMortems.filter((record) => {
        if (!isRecord(record)) return false;
        const lineage = record.lineage;
        if (!isRecord(lineage)) return false;
        return lineage.tenant === query.tenant && lineage.project === query.project;
      });
      return { ok: true, value: Object.freeze([...served]) as never };
    },
  };

  /** The latestPerOutcome fold — the durable store's own lane fold, mirrored (the newest version per outcome id). */
  function foldOutcomes(records: readonly unknown[], enabled: boolean): readonly unknown[] {
    if (!enabled) return Object.freeze([...records]);
    const latest = new Map<string, unknown>();
    for (const record of records) {
      if (isRecord(record) && isNonEmptyString(record.outcomeId)) latest.set(record.outcomeId, record);
    }
    return Object.freeze([...latest.values()]);
  }

  // -------------------------------------------------------------------------
  // THE DRAIN (the ordering law's second half — the host owns the async lane)
  // -------------------------------------------------------------------------

  async function drain(): Promise<DrainResult> {
    const writes = pending.splice(0, pending.length);
    for (const write of writes) {
      const result = await write.run();
      if (!result.ok) {
        // THE FAILED-DURABLE-WRITE LAW: the projection is stale — freeze it
        // (no port call serves the unconfirmed mutation) and rebuild it
        // from the durable truth. The host serves the typed 503 for THIS
        // request; the re-projection is not awaited (the 503 answers now).
        //
        // W-26C (the boot-world race hardening): the re-projection is
        // TRACKED in `inFlight` (never again an untracked `void` twin) so
        // the next settled()/reproject() JOINS this rebuild instead of
        // racing a second concurrent projection — and the DIRTY flag keeps
        // every surface degraded (never a pre-failure snapshot) until a
        // projection that started AFTER the failure lands the durable
        // truth. The boot world's retry then reads it FRESH (the concurrent
        // cold-boot collision self-heals on the first retry).
        failure = result.error; // the degraded surfaces report the durable failure's own code
        phase = 'projecting';
        dirty = true;
        if (inFlight === null) {
          inFlight = attempt();
        }
        // (an already-tracked attempt keeps its slot: it started BEFORE
        // this failure, so the dirty flag above forces settled() to land a
        // fresh post-failure projection after it completes — never join
        // the stale one as sufficient)
        return { ok: false, error: result.error };
      }
    }
    return { ok: true };
  }

  function goalOf(projectId: string): { readonly ok: true; readonly value: GoalSetRecord | null } | { readonly ok: false; readonly error: StoreFailure } {
    if (phase !== 'ready' || current === null || dirty) {
      const degradedFailure: StoreFailure = failure !== null
        ? failure
        : { code: 'durable_projection_pending', message: 'the durable projection is in flight; the goal read degrades (R46)' };
      return { ok: false, error: degradedFailure };
    }
    return { ok: true, value: liveGoalSets.get(projectId) ?? null };
  }

  return {
    ports: { controlPlane: controlPlanePort, firmMemory: firmMemoryPort, outcomeLearning: outcomeLearningPort },
    settled,
    reproject,
    drain,
    goalOf,
    lastProjection: () => report,
    lastFailure: () => failure,
  };
}

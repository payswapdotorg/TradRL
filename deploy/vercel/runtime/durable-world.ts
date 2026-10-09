// deploy/vercel/runtime/durable-world.ts — THE W-26B DURABLE ACTIVATION
// (the boot world + the durable machinery tick).
//
// WHAT THIS IS: the completion of the durable backing's product surface.
// Until W-26B the DURABLE resolution was the W-3f CHECKPOINT state: the
// execution gateway and the job-submission port answered the typed 503
// stubs (launches broke), the demo world never seeded (the public
// free-tier instant-value surface was GONE under durable), the per-request
// machinery tick never ran (jobs never advanced, user-launched projects
// never compiled), and the fixture substance (the demo knowledge capsule,
// the demo outcome + post-mortem) never reached the Neon stores — the
// read-only ports serve only what IS in Neon, and nothing could ever
// populate those tables through the routes.
//
// This module closes the gap so the DURABLE resolution is a SUPERSET of
// the DEMO resolution — everything demo serves, PLUS Neon persistence:
//
//   R3 — THE BOOT WORLD SEED: the SAME `seedDemoWorld(service, seed, at)`
//   the demo backing composes (runtime/demo.ts — backing-agnostic, it only
//   needs the service), driven once per DATABASE when the credential
//   tenant's hydrated project registry LACKS the demo project. Every seed
//   mutation rides the REAL routes (L20 for real) and write-throughs to
//   Neon (the W-25D ordering law); the guard is REQUIRED — a duplicate-id
//   create would be refused by the real control plane and the seed would
//   throw. On subsequent boots the hydrated registry already has the
//   project, so the guard skips the create and the per-instance job store
//   re-seeds its two demo jobs (`seedDemoJobs`, the same submissions the
//   world seed drives — idempotent per instance via the fixed keys; the
//   job store is the frozen service's closure, the disclosed limitation).
//
//   R4 — THE FIXTURE BOOT-WRITE: the fixture substance for the READ-ONLY
//   ports (`fixtureKnowledge`, `demoOutcomeRecord`, `demoPostMortemRecord`
//   — the exact records the demo fakes are constructed with) boots into
//   the Neon stores through the STORE layer (the W-25D seam's put
//   functions — the ports are query-only, the stores are the write seam),
//   guarded per table: when the tenant's rows for the demo project are
//   absent, write them once; when they already exist, write NOTHING. The
//   fixed fixture ids + the upsert statements make the writes idempotent.
//   The hydrated projection then serves them like any durable row.
//
//   R7 — THE ORG-STATUS SNAPSHOT PASS: the org-status read (GET
//   /v1/organizations/:ref/status) serves the boundary's API-OWNED
//   per-instance watch store, whose ONLY writer is POST
//   /internal/organizations/status (the private plane — the host owns the
//   internal credential and plays the machinery reporter role, the W-3f
//   law). A cold start empties that store (no injection surface exists in
//   the frozen service), so after each cold start this pass reports a
//   fresh snapshot for every BOUND project of the credential tenant whose
//   per-instance store lacks one (the demo project included) — through the
//   REAL private route, the same construction the world seed and the
//   compile pass use. Unbound projects are left to the machinery tick's
//   org-compile pass (the same demoMachineryTick law, re-binding +
//   re-reporting once per project). What remains per-instance is disclosed
//   in the PR's honest-limitations register (the snapshot store itself is
//   not Neon-persisted; the report instant is the boot instant).
//
//   R8 — THE DURABLE JOBS HYDRATION (W-27, D-7): the durable jobs lane
//   persists every non-demo job mutation (the submission AND each
//   transition — the composition's service wrapper queues the records
//   through the seam's write-through, drained per the ordering law), and
//   every boot REPLAYS the credential tenant's durable job records back
//   into THIS instance's API-owned job store (the frozen service's
//   closure — no injection surface exists) through the REAL public job
//   routes: the seam's job-submission port serves each durable record
//   verbatim (the exact jobId, status, result and timestamps) while the
//   hydration bracket is open, so the frozen pipeline's own handler
//   stores it. The per-id GET /v1/jobs/:jobId (the frozen route,
//   unchanged) and the jobs-list fold then serve durable jobs on EVERY
//   instance — the D-7 defect's both halves (the detail 404 loop + the
//   boot-time empty list) close. Records already present in the
//   instance's store are skipped (a retried boot world is idempotent —
//   the per-instance idempotency cache would not re-store them, so the
//   replay would misalign the port's FIFO without the skip).
//
// THE ORDERING LAW (the W-25D seam's law, ridden by the boot world): the
// seed's durable writes DRAIN before the first serve; a failed write is
// the typed degraded state — the triggering request answers the typed
// 503, the seam re-projects from the durable truth, and the boot world
// RETRIES on the next request (no circuit state — a Neon that recovers
// mid-instance heals). NEVER a crash, NEVER a silent partial world: after
// the seed + the fixture writes land, the boot world forces a full
// RE-PROJECTION so the serving projection IS the seeded world.
//
// THE RACE HARDENING (W-26C, R5): two instances may cold-boot over one
// empty durable store SIMULTANEOUSLY — both registry guards read the
// pre-seed truth, both seed, and the loser's append-only event collides
// on the live PRIMARY KEY (the 2026-10-06 production incident's wire
// error). The failed attempt now AWAITS the re-projection from the
// durable truth before its typed 503 surfaces, so the NEXT attempt's
// registry guard reads the winner's rows and skips the re-seed — the
// collision is a TRANSIENT 503 that self-heals on the first retry (the
// drain-failure re-projection is tracked, never an untracked twin; the
// seam's dirty flag keeps pre-failure snapshots from ever serving —
// runtime/durable.ts).
//
// THE MACHINERY TICK (R2): the SAME `demoMachineryTick` law the demo
// backing drives per request — the org-compile pass (bind through the real
// public route + the watch snapshot through the real private route) and
// the job advancement (submitted -> running -> complete through the real
// private plane) — with the context's `ports.controlPlane` being THIS
// seam's HYDRATED control plane (the projection's project listing drives
// the compile pass unchanged).
//
// Zero-dep law: platform APIs only. Spec anchors: ARCHITECTURE-LOCK
// L8/L9/L12/L15/L20, R46, D-033, D-3/D-4/D-5; deploy/wire/production.md
// (the composition law).

import {
  deepFreeze,
  isRecord,
  type ApiService,
  type JobRecord,
  type TenantId,
} from '../../../services/api/src/index';
import { fixtureKnowledge } from '../../../services/api/src/fixtures';
import {
  DEMO_PROJECT_ID,
  demoMachineryTick,
  demoOrgSnapshotInstantOf,
  demoOrgStatusSnapshot,
  demoOutcomeRecord,
  demoPostMortemRecord,
  seedDemoJobs,
  seedDemoWorld,
} from './demo';
import { HYDRATION_AT, type DurableBackingHandle } from './durable';
import type { DeliverableSource } from './deliverable';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, type NeonStoreDeps, type TenantKnowledgeRow, type TenantScopedRecordRow } from '../../adapters/neon/stores';

// ---------------------------------------------------------------------------
// The activation's inputs + observable surfaces
// ---------------------------------------------------------------------------

/** The boot world's seed inputs (the composition's own values — never request values). */
export interface DurableWorldSeedInput {
  /** The credential tenant (L12 — the boot world is scoped to it; the real routes inject the tenant). */
  readonly tenant: string;
  /** The public-plane developer token (the demo project create + organization bind). */
  readonly developerToken: string;
  /** The private-plane internal token (the org-status report + the job transitions); `null` = the private plane stays closed. */
  readonly internalToken: string | null;
}

/** The durable activation's construction inputs (all explicit — never ambient). */
export interface DurableActivationInput {
  /** The composed boundary service (the boot world drives it THROUGH the real routes). */
  readonly service: ApiService;
  /** The W-25D seam handle (the hydrated control plane + the projection lifecycle). */
  readonly durable: DurableBackingHandle;
  /** The seam's Neon store deps (the SAME provider configuration — durable.ts's `neonStoreDepsOf`). */
  readonly storeDeps: NeonStoreDeps;
  /** The seed inputs (the composition's credential values). */
  readonly seed: DurableWorldSeedInput;
  /**
   * THE DELIVERABLE SOURCE (FW-36-A, Round E register E-1): the research
   * completion's composed release-candidate reads the project's captured
   * mandate + observed world + composition-time promotion through this (the
   * seam's own hydrated surfaces, composed by compose.ts). A composition
   * with nothing on record passes `emptyDeliverableSource` — the composer
   * degrades to its honest statements (THE HONESTY LAW, R46).
   */
  readonly deliverables: DeliverableSource;
  /** The boot-instant source (the host MAY read the wall clock — compose.ts's own law). */
  readonly at: () => number;
}

/** The typed failure of a failed boot world (R46 — never a crash; retried per request). */
export interface DurableBootWorldFailure {
  readonly code: string;
  readonly message: string;
}

/** The durable activation: the per-request machinery tick + the idempotent boot world. */
export interface DurableActivation {
  /**
   * The per-request machinery tick (R2): the SAME `demoMachineryTick` law
   * the demo backing drives, over THIS seam's hydrated control plane.
   * `null` when no internal credential is configured (nothing animates —
   * honest under SIMULATED).
   */
  readonly tick: ((at: number) => void) | null;
  /**
   * The idempotent boot world (R3 + R4 + R7): seeds the demo world, writes
   * the fixture substance and re-reports the org-status snapshots once per
   * instance, with every durable write DRAINED before the first serve. A
   * failure rejects with the typed `DurableBootWorldFailure` and clears the
   * latch — the next request retries (no circuit state; a mid-instance
   * Neon recovery heals).
   */
  readonly ensureBootWorld: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// THE PER-INSTANCE STALENESS HEAL (FW-31-B — the P02 stall root cause's fix)
// ---------------------------------------------------------------------------

/**
 * The staleness heal's interval: at most ONE heal attempt per instance per
 * interval (two fresh SQL-over-HTTP reads — the tenant-wide jobs read + the
 * session-listing JOIN — a CONSTANT cost, never per-request; the W-30
 * round-trip law's boot projection is untouched). 10s bounds the P02
 * stall's worst case to the interval + the machinery's own 3s/8s schedule
 * (the observed stalls were 3-4 MINUTES: the balancer kept routing the
 * console's polls to a warm instance that booted before the launch, and
 * NOTHING ever re-read the durable truth there — the boot-time hydration
 * was the only cross-instance bridge).
 */
const STALENESS_HEAL_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// The boot world
// ---------------------------------------------------------------------------

/**
 * Build the durable activation. Pure construction (no network, no ambient
 * reads): the boot world runs only when the host calls `ensureBootWorld`
 * (the router does, once per request — internally latched per instance).
 */
export function buildDurableActivation(input: DurableActivationInput): DurableActivation {
  const { service, durable, storeDeps, seed } = input;
  const firmMemoryStore = new NeonFirmMemoryStore(storeDeps);
  const outcomeStore = new NeonOutcomeLearningStore(storeDeps);
  const tenantId = seed.tenant as TenantId;

  /** One step's typed failure — the whole boot world aborts (never a partial). */
  const fail = (code: string, message: string): DurableBootWorldFailure => ({ code, message });

  /**
   * R4: the guarded fixture boot-write for ONE table — when the tenant's
   * rows for the demo project are absent, write the fixture records once
   * through the STORE layer; when they already exist, write nothing.
   */
  async function bootWriteFixtures(): Promise<boolean> {
    let wrote = false;
    // The knowledge (the fixture capsule — the same record the demo fake is constructed with).
    const knowledge = await firmMemoryStore.queryKnowledge({ tenant: seed.tenant, project: DEMO_PROJECT_ID }, { at: HYDRATION_AT, retention: null });
    if (!knowledge.ok) throw fail(knowledge.error.code, `the fixture knowledge read failed: ${knowledge.error.message}`);
    if (knowledge.value.length === 0) {
      for (const envelope of fixtureKnowledge(seed.tenant, DEMO_PROJECT_ID)) {
        const written = await firmMemoryStore.putKnowledge(seed.tenant, envelope);
        if (!written.ok) throw fail(written.error.code, `the fixture knowledge write failed: ${written.error.message}`);
        wrote = true;
      }
    }
    // The outcome record (the demo mirror, verbatim — the store's upsert is idempotent on (tenant, outcome id)).
    const outcomes = await outcomeStore.queryOutcomes({ tenant: seed.tenant, project: DEMO_PROJECT_ID }, { at: HYDRATION_AT, retention: null });
    if (!outcomes.ok) throw fail(outcomes.error.code, `the fixture outcome read failed: ${outcomes.error.message}`);
    if (outcomes.value.length === 0) {
      const written = await outcomeStore.putOutcome(seed.tenant, demoOutcomeRecord(seed.tenant, DEMO_PROJECT_ID));
      if (!written.ok) throw fail(written.error.code, `the fixture outcome write failed: ${written.error.message}`);
      wrote = true;
    }
    // The post-mortem record (the demo mirror; the store's extracted columns need the
    // top-level scope fields — additive on the payload, the lineage carries them in the mirror).
    const mortems = await outcomeStore.queryPostMortems({ tenant: seed.tenant, project: DEMO_PROJECT_ID }, { at: HYDRATION_AT, retention: null });
    if (!mortems.ok) throw fail(mortems.error.code, `the fixture post-mortem read failed: ${mortems.error.message}`);
    if (mortems.value.length === 0) {
      const record = deepFreeze({ ...demoPostMortemRecord(seed.tenant, DEMO_PROJECT_ID), tenant: seed.tenant, project: DEMO_PROJECT_ID });
      const written = await outcomeStore.putPostMortem(seed.tenant, record);
      if (!written.ok) throw fail(written.error.code, `the fixture post-mortem write failed: ${written.error.message}`);
      wrote = true;
    }
    return wrote;
  }

  /**
   * R7: the org-status snapshot pass — report a fresh snapshot for every
   * BOUND project of the credential tenant whose per-instance watch store
   * lacks one, through the REAL private route (the watch store's only
   * writer). Unbound projects are the machinery tick's compile pass's own
   * law. Idempotent per instance (the store check); a refusal is skipped
   * (R46 — never a crash). Since FW-31-B the pass takes the project list
   * STRUCTURALLY (id + organizationRef): the boot world passes the HYDRATED
   * projection's listing; the staleness heal passes the FRESH session-JOIN
   * rows (a warm instance's projection predates the launch — the R7-at-boot
   * law alone left the compiled org's snapshot unobservable there, the
   * "org never compiles" half of the P02 stall).
   *
   * FW-34-A (the notification-state drift fix): each project's input now
   * carries its durable compile instant — the ORG-BIND EVENT'S OWN `at`
   * from the durable event log (the seam's organizationBoundAtOf, read
   * against the CURRENT serving projection) — and the re-hydrated snapshot
   * is reported AT THAT INSTANT, never the boot/heal instant. The PRE-FW-34-A
   * pass stamped `demoOrgSnapshotInstantOf(project.id, at)` (the report
   * instant) for every launched desk: every cold start re-reported a
   * DIFFERENT instant, the console folded a NEW content-addressed notice id
   * per instance (its persisted read marks keyed by notice id never
   * matched), and a 23-minute-old "Organization compiled" event re-notified
   * as NEW unread on every restart while the notice's instant mislabeled as
   * the session start (Round C register item 4: L3/L4/M5/S2). With the
   * compile instant the snapshot is byte-identical on every instance that
   * reports it — the stable identity the notice fold derives from. A
   * project whose bind instant the projection does not carry yet (a warm
   * instance whose quiet re-projection is still pending) is SKIPPED this
   * interval: never a churned fresh instant (the next interval reports the
   * stable one). The DEMO project keeps the deterministic demo epoch
   * (unchanged — its snapshot was already instant-stable).
   */
  function reportMissingOrgStatusSnapshots(projects: readonly { readonly id: string; readonly organizationRef: string | null; readonly organizationBoundAt: number | null }[], at: number): void {
    if (seed.internalToken === null) return; // the private plane stays closed — the watch store stays honestly empty
    const known = new Set(service.orgStatusSnapshots().map((snapshot) => `${snapshot.organizationRef as string}/${snapshot.project as string}`));
    for (const project of projects) {
      const organizationRef = project.organizationRef;
      if (organizationRef === null) continue; // unbound — the tick's compile pass owns those
      if (known.has(`${organizationRef}/${project.id}`)) continue; // already reported on this instance
      // FW-34-A: the report instant is the DURABLE COMPILE instant for every
      // launched desk (the org-bind event's own `at` — the snapshot carries
      // the compile EVENT time, and the byte-identical report never mints a
      // fresh notice identity); the demo project keeps its deterministic
      // epoch. A launched desk whose bind instant is not yet readable is
      // SKIPPED — never a churned instant (the stable identity law above).
      const snapshotAt = project.id === DEMO_PROJECT_ID
        ? demoOrgSnapshotInstantOf(DEMO_PROJECT_ID, at)
        : project.organizationBoundAt;
      if (snapshotAt === null) continue;
      const snapshot = demoOrgStatusSnapshot(seed.tenant, project.id, organizationRef, snapshotAt);
      if (snapshot === null) continue; // unreachable (the fixture builder is the canonical shape) — skip, never a crash
      service.handle({
        method: 'POST',
        path: '/internal/organizations/status',
        headers: { authorization: `Bearer ${seed.internalToken}` },
        body: { snapshot },
      });
    }
  }

  /** The hydrated projection's project listing as the snapshot pass's structural input (R46: a degraded projection answers nothing — the pass skips, never a crash). The bind instant comes from the SAME projection (the org-bind event's own `at` — the notification-identity fix's anchor); a degraded bind read is a null (the pass skips that project, never a churned instant). */
  function hydratedProjectsForSnapshots(): readonly { readonly id: string; readonly organizationRef: string | null; readonly organizationBoundAt: number | null }[] {
    const listed = durable.ports.controlPlane.projectsOf(tenantId);
    if (!listed.ok) return [];
    return listed.value.map((project) => {
      const bindAt = durable.organizationBoundAtOf(project.id as string);
      return {
        id: project.id as string,
        organizationRef: typeof project.lifecycle.organizationRef === 'string' ? project.lifecycle.organizationRef : null,
        organizationBoundAt: bindAt.ok ? bindAt.value : null,
      };
    });
  }

  /**
   * The fresh session-JOIN rows' project payloads as the snapshot pass's
   * structural input (malformed rows skip fail-closed — never a crash). The
   * bind instant comes from the SERVING projection's captured org-bind
   * events (FW-34-A): the derived-truth half (step 1) triggers the quiet
   * re-projection FIRST, so by the time this input feeds the org half the
   * projection carries the launch's bind; a row whose bind instant is not
   * readable yet feeds null and the pass SKIPS it (never a churned instant
   * — the next interval reports the stable identity).
   */
  function freshProjectsForSnapshots(rows: readonly { readonly project: unknown }[]): readonly { readonly id: string; readonly organizationRef: string | null; readonly organizationBoundAt: number | null }[] {
    const projects: { readonly id: string; readonly organizationRef: string | null; readonly organizationBoundAt: number | null }[] = [];
    for (const row of rows) {
      if (!isRecord(row.project)) continue;
      const id = row.project.id;
      const lifecycle = row.project.lifecycle;
      if (typeof id !== 'string' || id.length === 0 || !isRecord(lifecycle)) continue;
      const organizationRef = lifecycle.organizationRef;
      const bindAt = durable.organizationBoundAtOf(id);
      projects.push({ id, organizationRef: typeof organizationRef === 'string' && organizationRef.length > 0 ? organizationRef : null, organizationBoundAt: bindAt.ok ? bindAt.value : null });
    }
    return projects;
  }

  /** The project id of one session-JOIN row ('' when the payload carries none — malformed rows never trigger a refresh). */
  function projectOfSessionRow(row: { readonly project: unknown }): string {
    if (!isRecord(row.project)) return '';
    const id = row.project.id;
    return typeof id === 'string' ? id : '';
  }

  /**
   * FW-33-A (the derived-truth half's probe): does one tenant-wide opaque
   * record fold (outcomes or post-mortems) carry a row of a project the
   * projection SERVES whose id it lacks? Rows of projects the projection
   * has not seen (a fresh launch) ride the REGISTRY probe instead (their
   * rows arrive with the quiet refresh the registry triggers); rows of
   * projects it SKIPPED are not a trigger (they can never reconstruct
   * better). Structural throughout — a malformed payload row never
   * triggers a refresh (fail-closed, never a crash).
   */
  function tenantRowHasNewId(rows: readonly TenantScopedRecordRow[], servedProjects: ReadonlySet<string>, servedIds: ReadonlySet<string>, idField: 'outcomeId' | 'postMortemId'): boolean {
    for (const row of rows) {
      if (!servedProjects.has(row.project)) continue;
      if (!isRecord(row.record)) continue;
      const id = row.record[idField];
      if (typeof id === 'string' && id.length > 0 && !servedIds.has(id)) return true;
    }
    return false;
  }

  /** The knowledge fold's twin of the opaque-record probe (the id lives in the envelope's own record). */
  function knowledgeRowHasNewId(rows: readonly TenantKnowledgeRow[], servedProjects: ReadonlySet<string>, servedIds: ReadonlySet<string>): boolean {
    for (const row of rows) {
      if (!servedProjects.has(row.project)) continue;
      const record = (row.envelope as { readonly record?: unknown }).record;
      if (!isRecord(record)) continue;
      const id = record.knowledgeId;
      if (typeof id === 'string' && id.length > 0 && !servedIds.has(id)) return true;
    }
    return false;
  }

  /**
   * R8 (W-27, D-7): the durable jobs hydration — replay every durable job
   * record of the credential tenant's RECONSTRUCTED projects back into this
   * instance's API-owned job store through the REAL public job routes (the
   * port serves the durable records verbatim while the bracket is open).
   * A degraded registry/jobs read fails the boot world with the typed
   * failure (never a partial hydration); a refused replay means the frozen
   * job-submission contract drifted — loud, exactly like the world seed.
   */
  function hydrateDurableJobs(): void {
    const listed = durable.ports.controlPlane.projectsOf(tenantId);
    if (!listed.ok) throw fail(listed.error.code, `the hydrated registry is degraded: ${listed.error.message}`);
    const known = new Set(service.jobs().map((job) => job.jobId as string));
    const missing: JobRecord[] = [];
    for (const project of listed.value) {
      const read = durable.jobsOf(project.id as string);
      if (!read.ok) throw fail(read.error.code, `the durable jobs read failed for ${JSON.stringify(project.id as string)}: ${read.error.message}`);
      for (const record of read.value) {
        if (known.has(record.jobId)) continue; // already hydrated on this instance — a re-replay would hit the idempotency cache (never re-store), misaligning the port's FIFO
        missing.push(record);
      }
    }
    replayDurableJobs(missing);
  }

  /**
   * THE REPLAY DRIVER (the boot hydration + the staleness heal's shared
   * law, factored by FW-31-B): store the given durable job records into
   * THIS instance's API-owned job store through the REAL public job routes
   * — the port's hydration bracket serves each record VERBATIM (the exact
   * jobId, status, result and timestamps) while the driver runs
   * SYNCHRONOUSLY inside the bracket, so nothing else can consume a
   * preloaded record. Throws the typed failure when a replay is refused
   * (the frozen job-submission contract drifted — loud at boot; the heal
   * catches and skips, R46).
   */
  function replayDurableJobs(missing: readonly JobRecord[]): void {
    if (missing.length === 0) return;
    durable.beginJobHydration([...missing]); // the port serves exactly these records, in order
    try {
      for (const record of missing) {
        const replayed = service.handle({
          method: 'POST',
          path: record.kind === 'research' ? '/v1/jobs/research' : '/v1/jobs/learning',
          headers: { authorization: `Bearer ${seed.developerToken}`, 'idempotency-key': `idem:durable:hydrate:${record.jobId}` },
          body: { kind: record.kind, projectId: record.project, spec: { hydrated: true } },
        });
        const stored = (replayed.body as { readonly data?: unknown }).data;
        if (replayed.status !== 202 || !isRecord(stored) || stored.jobId !== record.jobId) {
          throw fail('durable_job_hydration_failed', `the durable job ${JSON.stringify(record.jobId)} failed its hydration replay (${replayed.status}) — the frozen job-submission contract may have drifted`);
        }
      }
    } finally {
      durable.endJobHydration(); // the port mints fresh records again (an unconsumed preload is dropped)
    }
  }

  /**
   * THE PER-INSTANCE STALENESS HEAL (FW-31-B — the P02 stall's fix): a
   * bounded, best-effort re-read of the durable truth for the two surfaces
   * the P02 stall stranded on a WARM instance (an instance whose boot
   * projection + API-owned job store predate a launch that landed on
   * ANOTHER instance):
   *
   *   1. THE DERIVED-TRUTH HALF (FW-33-A — Round B blocker 1, the
   *      launched-desk record durability defect's warm-instance half):
   *      the heal re-reads the OUTCOME + POST-MORTEM + KNOWLEDGE surfaces
   *      (one tenant-wide read each — CONSTANT cost per interval, the W-30
   *      round-trip law; the boot projection's reads stay exactly seven)
   *      and compares the fresh rows against the serving projection's
   *      MEMBERSHIP (durable.projectionMembership): any registry project
   *      the projection has not SEEN (a launch that landed on ANOTHER
   *      instance — this warm instance's goal sets + org binds predate it,
   *      so the FW-MI-B derived streams fold to honest emptiness), or any
   *      outcome/post-mortem/knowledge row of a project the projection
   *      DOES serve whose id it lacks (a PROMOTED DECISION minted on
   *      ANOTHER instance — the record is durable truth now, FW-33-A's
   *      outcome lane), triggers the QUIET RE-PROJECTION
   *      (durable.reprojectQuietly): the whole serving projection rebuilds
   *      from the fresh durable truth with NO serving degradation at any
   *      point, and the derived streams re-fold from it automatically
   *      (they read goalOf + the control-plane listing + the outcome
   *      rows). Rows of projects the projection SKIPPED are not a trigger
   *      (a skipped row can never reconstruct better — the membership's
   *      SEEN set carries them). This half runs FIRST: the quiet
   *      re-projection's commit guard discards a build that raced
   *      undrained writes, and the jobs half's replay queues exactly such
   *      writes — the probe + refresh need the pending lane clean.
   *
   *   2. THE JOBS HALF (FW-31-B): a fresh tenant-wide durable-jobs read;
   *      every record this instance's job store LACKS (the launch's
   *      kickoff job, its transitions) replays back through the REAL
   *      public job routes (the same replay driver the boot hydration
   *      rides) — the frozen per-id GET /v1/jobs/:jobId and the
   *      host-owned jobs list then serve them on THIS instance too (the
   *      pre-fix stall: the console's poll answered the typed 404 forever,
   *      the launch phase never advanced, CONNECTION degraded — Round A's
   *      L1/M1, intermittent because it needed the balancer to keep
   *      routing the polls to the pre-launch warm instance).
   *
   *   3. THE ORG HALF (FW-31-B): the org-status snapshot pass over the
   *      FRESH session-JOIN rows (never this instance's stale projection)
   *      — every BOUND project whose watch-store snapshot this instance
   *      lacks gets its report through the REAL private route (the
   *      R7-at-boot law, brought to the bounded interval), so the compiled
   *      org's snapshot is observable on THIS instance (the "org never
   *      compiles" half — the org WAS compiled in the durable truth; the
   *      stale instance could never observe it).
   *
   * Best-effort by construction (the W-25D mid-instance law — the serving
   * projection is NEVER degraded by a heal): a failed read, a refused
   * replay or a discarded refresh is SKIPPED (R46 — never a crash, never a
   * rejected promise); the next interval retries. The W-30 round-trip law
   * is untouched (the boot projection's reads stay exactly seven; the heal
   * adds at most FIVE fresh reads per interval per instance — the jobs
   * read, the session-listing JOIN the org half already rides, and the
   * three derived-truth reads).
   */
  async function healStaleDurableState(at: number): Promise<void> {
    try {
      // 1. THE DERIVED-TRUTH HALF (FW-33-A) — FIRST, while the pending
      //    lane is clean: the quiet re-projection's commit guard discards
      //    a build that raced undrained writes, and the jobs half below
      //    queues exactly such writes (the replay's write-through lane) —
      //    the derived-truth probe + refresh must run before it. The fresh
      //    reads vs the serving projection's membership; a divergence is
      //    the quiet re-projection's trigger.
      const rows = await durable.sessionProjectRows();
      const membership = durable.projectionMembership();
      if (rows.ok && membership !== null) {
        const freshProjectIds = new Set(rows.value.map((row) => projectOfSessionRow(row)));
        const unseenProject = [...freshProjectIds].some((id) => id.length > 0 && !membership.registryProjectIds.has(id));
        const freshOutcomes = await outcomeStore.queryOutcomesOfTenant(seed.tenant);
        const freshPostMortems = freshOutcomes.ok ? await outcomeStore.queryPostMortemsOfTenant(seed.tenant) : null;
        const freshKnowledge = freshPostMortems !== null && freshPostMortems.ok
          ? await firmMemoryStore.queryKnowledgeOfTenant({ tenant: seed.tenant }, { at: HYDRATION_AT, retention: null })
          : null;
        const unseenOutcome = freshOutcomes.ok && tenantRowHasNewId(freshOutcomes.value, membership.registryProjectIds, membership.outcomeIds, 'outcomeId');
        const unseenPostMortem = freshPostMortems !== null && freshPostMortems.ok
          && tenantRowHasNewId(freshPostMortems.value, membership.registryProjectIds, membership.postMortemIds, 'postMortemId');
        const unseenKnowledge = freshKnowledge !== null && freshKnowledge.ok
          && knowledgeRowHasNewId(freshKnowledge.value, membership.registryProjectIds, membership.knowledgeIds);
        if (unseenProject || unseenOutcome || unseenPostMortem || unseenKnowledge) {
          await durable.reprojectQuietly();
        }
      }
      // 2. THE JOBS HALF — the fresh tenant-wide durable-jobs read (the
      //    replay's write-through lane queues here; a later request's drain
      //    confirms it — the W-27 law).
      const jobs = await durable.freshJobRecordsOfTenant();
      if (jobs.ok) {
        const known = new Set(service.jobs().map((job) => job.jobId as string));
        const missing = jobs.value.filter((record) => !known.has(record.jobId));
        replayDurableJobs(missing);
      }
      // 3. THE ORG HALF — the snapshot pass over the fresh JOIN rows (the
      //    read from step 1 rides again — the same rows, the same interval).
      if (rows.ok) reportMissingOrgStatusSnapshots(freshProjectsForSnapshots(rows.value), at);
    } catch {
      // R46: the heal is best-effort — a transient failure never takes the
      // request (or the instance) down; the next interval retries.
    }
  }

  /** One boot-world attempt (throws the typed failure on any unconfirmed part). */
  async function run(): Promise<void> {
    const bootAt = input.at();
    // 1. THE REGISTRY GUARD (R3): the credential tenant's hydrated registry.
    //    A duplicate create would be refused by the real control plane and
    //    the seed would throw — the guard is REQUIRED.
    const registry = durable.ports.controlPlane.projectsOf(tenantId);
    if (!registry.ok) throw fail(registry.error.code, `the hydrated registry is degraded: ${registry.error.message}`);
    const demoSeeded = registry.value.some((project) => (project.id as string) === DEMO_PROJECT_ID);
    let worldChanged = false;
    if (!demoSeeded) {
      // 2. THE WORLD SEED (R3): the SAME seedDemoWorld the demo backing
      //    composes, through the REAL routes — the write-through queues the
      //    durable writes (goal set -> record; record -> event for the bind).
      try {
        seedDemoWorld(service, { tenant: seed.tenant, developerToken: seed.developerToken, internalToken: seed.internalToken }, bootAt);
        worldChanged = true;
      } catch (cause) {
        // An impossible seed (the frozen contract drifted): recover by
        // draining + re-projecting (the unconfirmed partial world never
        // serves), then the typed failure — never a crash.
        await durable.drain().catch(() => undefined);
        await durable.reproject().catch(() => undefined);
        throw fail('durable_boot_world_failed', `the demo world seed was refused: ${(cause as Error).message}`);
      }
      // 3. THE ORDERING LAW: the seed's durable writes drain BEFORE the
      //    first serve. A failed drain re-projects (the seam's own law) and
      //    the boot world reports the typed failure — never a silent partial.
      const drained = await durable.drain();
      if (!drained.ok) {
        // R5 (W-26C — the boot-world race hardening): the concurrent
        // cold-boot race — another instance's identical seed already landed
        // in the durable store and THIS instance's append-only event
        // collided (the live PRIMARY KEY's 400). AWAIT the re-projection
        // from the durable truth BEFORE the typed failure surfaces, so the
        // failed attempt's NEXT run reads the durable truth FRESH (the
        // winner's rows are present — the registry guard skips the re-seed)
        // — the boot world self-heals on the FIRST retry, never a repeating
        // 503. (The seed-refusal path above already carried this law; the
        // drain-failure path now carries it too — the asymmetry removed.)
        await durable.reproject().catch(() => undefined);
        throw fail(drained.error.code, `the demo world seed's durable write failed: ${drained.error.message}`);
      }
    } else {
      // Subsequent boots: the registry guard skips the create; the
      // per-instance job store still re-seeds its two demo jobs (R3's
      // disclosed limitation — the frozen service's closure).
      seedDemoJobs(service, seed.developerToken);
    }
    // 3b. THE DURABLE JOBS HYDRATION (R8, W-27, D-7): the durable job
    //     records replay back into this instance's API-owned job store
    //     through the REAL public job routes — before the first serve (and
    //     therefore before the first tick, so non-terminal durable jobs
    //     join the machinery advancement immediately on THIS instance).
    hydrateDurableJobs();
    // 4. THE FIXTURE BOOT-WRITE (R4), guarded per table.
    if (await bootWriteFixtures()) worldChanged = true;
    // 5. THE POST-SEED REFRESH: the durable truth changed after the boot
    //    projection ran — force a re-projection so the serving projection IS
    //    the seeded world (never a stale, pre-seed one). A failure leaves
    //    the seam in the typed degraded state (the per-request retry heals).
    if (worldChanged) {
      await durable.reproject();
      const failure = durable.lastFailure();
      if (failure !== null) throw fail(failure.code, `the post-seed re-projection failed: ${failure.message}`);
    }
    // 6. THE ORG-STATUS SNAPSHOT PASS (R7) — last, against the CURRENT
    //    projection (the freshly seeded world included).
    reportMissingOrgStatusSnapshots(hydratedProjectsForSnapshots(), bootAt);
  }

  // The per-instance latch: a successful run latches; a failed run clears
  // so the next request retries (no circuit state).
  let latched: Promise<void> | null = null;
  function ensureBootWorld(): Promise<void> {
    if (latched === null) {
      latched = run().then(undefined, (cause: unknown) => {
        latched = null; // retry on the next request (the settled() healing law)
        throw cause;
      });
    }
    return latched;
  }

  // The machinery tick (R2): the SAME law over the seam's hydrated control
  // plane — and, since FW-31-B, the bounded STALENESS HEAL rides the tick's
  // cadence: at most one heal attempt per STALENESS_HEAL_INTERVAL_MS per
  // instance, fire-and-forget (the heal never blocks the request — it only
  // reads the durable truth + replays into the per-instance stores; the
  // serving projection is untouched, per the W-25D mid-instance law).
  const internalToken = seed.internalToken;
  let lastStalenessHealAt: number | null = null;
  const tick = internalToken === null
    ? null
    : (at: number) => {
        // FW-31-B (the P02 stall): the bounded staleness heal, BEFORE the
        // compile pass — a healed job store lets THIS tick's advancement
        // see the launch's kickoff job the same request (a healed watch
        // store lets the org-status read observe the compiled org). The
        // instance's FIRST tick only ARMS the interval (the boot world
        // just read the durable truth — a heal at boot adds nothing); a
        // later tick pays at most one heal per interval.
        if (lastStalenessHealAt === null) {
          lastStalenessHealAt = at;
        } else if (at - lastStalenessHealAt >= STALENESS_HEAL_INTERVAL_MS) {
          lastStalenessHealAt = at;
          void healStaleDurableState(at); // best-effort by construction — never a rejection
        }
        // The context's control plane is the seam's HYDRATED port — the
        // compile pass's projectsOf read works unchanged (R2's law). Since
        // FW-36-A the same context carries the DELIVERABLE SOURCE (E-1):
        // every research job the tick completes composes its release
        // candidate from the project's own captured records.
        demoMachineryTick(service, { ports: { controlPlane: durable.ports.controlPlane }, deliverables: input.deliverables, tenant: seed.tenant, developerToken: seed.developerToken, internalToken }, at);
      };

  return { tick, ensureBootWorld };
}

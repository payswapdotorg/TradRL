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
//      (NeonOutcomeLearningStore);
//   5. the JOBS of every reconstructed project (NeonJobStore, W-27 D-7).
// Any failed durable read fails the WHOLE projection (a partial projection
// would be a silent divergence); a record that cannot reconstruct under
// the current domain law is SKIPPED and reported (never a crash).
//
// THE W-30 ROUND-TRIP LAW (PROD-504): the reads are TENANT-WIDE and BATCHED
// — SEVEN SQL-over-HTTP round trips in TOTAL (the registry + the existing
// projects+goals JOIN + one tenant-wide read each for events, knowledge,
// outcomes, post-mortems and jobs), CONSTANT w.r.t. project count, then an
// in-memory group-by-project fold. The pre-fix seam read PER PROJECT
// (goal set + events + knowledge + outcomes + post-mortems + jobs ≈ 6
// queries per project): at 25 durable projects that was ≈151 sequential
// fetches before authn on every cold start — past the platform's function
// duration cap, the production 504 (FUNCTION_INVOCATION_TIMEOUT). The law
// is pinned by test: the projection's fetch count is identical at 3 and at
// 30 projects (durable.test.ts — the regression can never ship again).
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
// into these stores. Since W-27 (D-7) the JOB RECORDS persist too: every
// non-demo job mutation (the submission AND each transition) write-throughs
// to the tradrl_jobs store, and every cold start REPLAYS the durable job
// records back into the fresh instance's API-owned job store (the frozen
// service's closure) through the REAL public job routes — the hydration
// seam below — so the per-id GET /v1/jobs/:jobId (the frozen route,
// unchanged) and the jobs-list fold serve durable jobs on EVERY instance,
// never just the one that received the submission (the D-7 defect's both
// halves: the detail 404 loop and the boot-time empty list).
//
// WHAT STAYS API-OWNED (honest limitation): the boundary's job store and
// org-status snapshots live in the frozen service's closure with no
// injection surface — under the durable backing the job STORE's durable
// truth is the tradrl_jobs table (W-27: written on every mutation, read
// back through the hydration seam), while the ORG-STATUS SNAPSHOTS remain
// per-instance state (reset on cold starts; the boot world's R7 pass
// re-reports them — runtime/durable-world.ts). The DEMO project's own jobs
// stay per-instance by design (the boot world re-seeds them per instance;
// the write-through lane skips them — a fresh instance would otherwise
// accumulate one seeded pair per cold start in the durable table).
//
// FW-33-A (Round B blocker 1 — the launched-desk record durability wave):
// the DERIVED records of the durable surfaces now ride write-through +
// re-read lanes of their own:
//   - a PROMOTED DECISION (the host promote route's mint, runtime/
//     job-promote.ts) write-throughs into tradrl_outcomes through the
//     outcome lane (recordOutcome below — the same putOutcome store path
//     the boot-world fixtures ride, queued onto the SAME pending drain;
//     idempotent on (tenant, outcome id)); it queues at MINT time (the
//     registry's bound lane) and again at SERVE time (the derived-rows
//     wrapper's backstop, riding the querying request's own drain), so a
//     fresh instance's boot projection reads it and a warm instance's
//     staleness heal re-reads it (runtime/durable-world.ts).
//   - the STALENESS HEAL (FW-31-B) now re-reads the outcome/post-mortem/
//     knowledge surfaces too (three more CONSTANT tenant-wide reads per
//     bounded interval — the W-30 round-trip law holds) and, when the
//     fresh truth carries records the serving projection lacks, commits a
//     QUIET re-projection (reprojectQuietly below: no serving degradation
//     at any point — the W-25D mid-instance law); the derived streams
//     (the FW-MI-B folds) re-fold from the fresh truth automatically.
//   - HONEST LIMITATION (never fabricated, the teaching note): the LIVE
//     gateway rows of the recording execution gateway (POST
//     /v1/execution/requests routed on THIS instance) remain per-instance
//     — no durable submissions table exists (adding one is a schema change
//     outside this wave's surface); the DERIVED blotter rows (the launched
//     desk's evidence stream) remain re-derivable everywhere, and the
//     promotion registry's records are re-minted idempotently on
//     re-promotion where a write never confirmed.
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
  JobSubmissionPort,
  JobRecord,
  OutcomeLearningPort,
  OutcomeRecordMirror,
  PortFailure,
  PortResult,
  PostMortemRecordMirror,
  ProjectRecord,
  ServedKnowledge,
  TransitionProjectResponse,
} from '../../../services/api/src/index';
import { canonicalJson, isJobRecord } from '../../../services/api/src/index';
import { fakeJobSubmission } from '../../../services/api/src/fixtures';
import { DEMO_PROJECT_ID, demoSeedJobPrimingLatch, launchWorldOfSpec, withDerivedGoalHorizonLabel, OUTCOME_DURABLE_LANE_FIELD, type OutcomeDurableWriteLane, type OutcomeLearningPortWithDurableLane } from './demo';
import { NeonFirmMemoryStore, NeonJobStore, NeonOutcomeLearningStore, NeonProjectStore, ownerSessionOf, type GoalSetRecord, type NeonStoreDeps, type SessionProjectRow } from '../../adapters/neon/stores';
import { executeNeonStatement, type NeonConfig } from '../../adapters/neon/client';
import { NEON_DDL_RECORDS } from '../../adapters/neon/schema';
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

/**
 * One hydrated goal set — the create-project input's goal + constraint set,
 * verbatim (what main already carries); since W-28 (D-8) optionally the
 * LAUNCH WORLD SPECIFICATION the kickoff job's spec carried (merged into the
 * same opaque goal-set payload — no schema change).
 */
export interface HydratedGoalSet {
  readonly goal: unknown;
  readonly constraintSet: unknown;
  /** The launch world specification, when the goal-set row carries one (W-28, D-8). */
  readonly world?: unknown;
}

/**
 * The boot projection's report — the observable hydration surface (the
 * order is the report's structure: registry -> events -> knowledge ->
 * outcomes -> post-mortems -> jobs; the counts are the completeness pin).
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
  /** Durable job records hydrated (W-27, D-7 — the reconstructed projects' rows of tradrl_jobs). */
  readonly jobs: number;
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
 * The serving projection's membership snapshot (FW-33-A — the staleness
 * probe's comparison base). Every set is keyed by the record's own
 * content-addressed identity (the id the durable rows carry).
 */
export interface ProjectionMembership {
  /** The registry project ids the projection has SEEN (reconstructed OR skipped — a skipped row never asks for a refresh it cannot use). */
  readonly registryProjectIds: ReadonlySet<string>;
  /** The outcome ids the projection serves (the tenant-wide boot read's rows of the reconstructed projects). */
  readonly outcomeIds: ReadonlySet<string>;
  /** The post-mortem ids the projection serves. */
  readonly postMortemIds: ReadonlySet<string>;
  /** The knowledge ids the projection serves. */
  readonly knowledgeIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// THE DDL RUNBOOK (W-28, lane B): the host-owned internal route pair the
// Lead uses to heal production (and any future database) with a single
// authenticated call — apply EVERY DDL record in `NEON_DDL_RECORDS` (in the
// listed order) and report schema truth (information_schema only — L12: NO
// tenant data ever crosses). The runbook is host-owned (deploy/vercel/
// runtime/routes.ts); it rides the SAME Neon SQL-over-HTTP client the
// durable stores compose over (deploy/adapters/neon/client.ts — no new
// dependency, no re-implementation of the wire format). DDL is idempotent
// by construction (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
// EXISTS`); a second apply is safe. The honest distinction between "applied"
// and "already-present" is NOT measurable with the wire response shape (a
// `CREATE TABLE IF NOT EXISTS` that changes nothing still returns the same
// command tag), so the apply surface reports `"ok"` for both — never a
// fabricated distinction. The verify surface queries
// `information_schema.tables` (schema metadata, parameterized — every
// dynamic value is a $n bind parameter) for the table names in
// `NEON_DDL_RECORDS` and reports each table's existence + a coverage
// summary. The 7th table (`tradrl_jobs`, the W-27 lane) is the production
// gap this runbook exists to heal.
// ---------------------------------------------------------------------------

/**
 * One DDL apply result, per table. The honest result is `"ok"` for both
 * applied and already-present (the wire response does not distinguish them —
 * the honesty law forbids fabricating a distinction); `"failed"` carries the
 * Neon failure code ONLY (no SQL error text — it can embed the endpoint).
 */
export interface DdlApplyTableResult {
  /** The table this result describes (e.g. `tradrl_jobs`). */
  readonly table: string;
  /** The honest result: `"ok"` for both applied and already-present (the wire does not distinguish them); `"failed"` carries the failure code. */
  readonly result: 'ok' | 'failed';
  /** The Neon failure code, ONLY when `result === "failed"` (the table name + the code are safe; raw SQL error text is NOT — it can embed the endpoint). */
  readonly code?: string;
}

/** The DDL apply verdict: every table's per-record result, or the typed failure that stopped the apply. */
export type DdlApplyResult =
  | { readonly ok: true; readonly tables: readonly DdlApplyTableResult[] }
  | { readonly ok: false; readonly error: StoreFailure };

/** One DDL verify result, per table. */
export interface DdlVerifyTableResult {
  /** The table this result describes (e.g. `tradrl_jobs`). */
  readonly table: string;
  /** Whether the table exists in the durable store's information_schema (schema metadata — L12: NO tenant data queried). */
  readonly exists: boolean;
}

/** The DDL verify verdict: each table's existence + the coverage summary, or the typed failure of the information_schema read. */
export type DdlVerifyResult =
  | { readonly ok: true; readonly tables: readonly DdlVerifyTableResult[]; readonly coverage: string }
  | { readonly ok: false; readonly error: StoreFailure };

/** The durable backing's runbook surface (W-28, lane B). */
export interface DurableRunbook {
  /**
   * Apply EVERY record in `NEON_DDL_RECORDS` (in the listed order) via the
   * existing Neon SQL-over-HTTP client the durable stores already compose
   * over. DDL is idempotent by construction; a second apply is safe. The
   * apply STOPS on the first failure (the precedent of `drain()` — the
   * ordering law) and returns the typed failure of the failed record (the
   * host serves the typed 503 listing the failed table + the failure code
   * ONLY — scrubbed of any secret-shaped material). The honest per-table
   * result is `"ok"` for both applied and already-present (the wire does
   * not distinguish them); the honesty law forbids fabricating a
   * distinction.
   */
  applyDdl(): Promise<DdlApplyResult>;
  /**
   * Report schema truth: for each table named in `NEON_DDL_RECORDS`,
   * whether it exists. The query is `SELECT table_name FROM
   * information_schema.tables WHERE table_name IN ($1..$n)` — schema
   * metadata, parameterized (L12: NO tenant data ever crosses; every
   * dynamic value is a $n bind parameter). Returns each table's existence
   * + a coverage summary (`"7/7 tables present"` style) or the typed
   * failure of the read.
   */
  verifyDdl(): Promise<DdlVerifyResult>;
}

/**
 * The durable backing handle (what compose.ts carries for the router): the
 * sync ports the composition root is injected with + the projection
 * lifecycle the host drives.
 */
export interface DurableBackingHandle {
  /**
   * The SYNC in-memory ports (hydrated from the durable stores — the seam's
   * whole point). Since W-27 (D-7) the set includes the job-submission
   * port: a hydration-aware wrapper over the frozen service's own
   * `fakeJobSubmission` engine that serves the projection's durable job
   * records verbatim while a hydration bracket is open (the boot world
   * replays each durable job through the REAL public job route, so the
   * frozen pipeline's own store — the store the per-id GET
   * /v1/jobs/:jobId and the jobs-list fold read — carries the durable
   * record with its exact jobId), and mints fresh records otherwise
   * (the pre-W-27 law, byte-identical).
   */
  readonly ports: {
    readonly controlPlane: ControlPlanePort;
    readonly firmMemory: FirmMemoryPort;
    readonly outcomeLearning: OutcomeLearningPort;
    readonly jobSubmission: JobSubmissionPort;
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
  /**
   * THE DURABLE JOBS READ (W-27, D-7): the projection's job records for
   * one project — the rows tradrl_jobs holds for the credential tenant
   * (L12 by construction: only this tenant's rows hydrate). The typed
   * degraded state while the projection is down (never a silent empty).
   * The boot world's hydration driver reads this to replay each durable
   * job into the fresh instance's API-owned job store.
   */
  jobsOf(projectId: string): { readonly ok: true; readonly value: readonly JobRecord[] } | { readonly ok: false; readonly error: StoreFailure };
  /**
   * THE JOB WRITE-THROUGH LANE (W-27, D-7): queue the durable job writes
   * for the given records — each rides the drain like every control-plane
   * write (the ordering law: the host drains before the response is
   * served; a failed write is the typed 503 + the re-projection). Records
   * of a foreign tenant are refused (L12 — never queued); a record whose
   * payload is byte-identical to the projection's row is SKIPPED (the
   * idempotent no-op — the hydration replays never re-write what they
   * hydrated).
   */
  recordJobs(records: readonly JobRecord[]): void;
  /**
   * Open the job-hydration bracket (W-27, D-7): the port's `submitJob`
   * serves these records verbatim, in order, until `endJobHydration`
   * closes the bracket. The boot world primes the queue with exactly the
   * records it will replay (missing from the instance's job store) — the
   * alignment is by construction; the bracket keeps any other submission
   * from consuming a preloaded record.
   */
  beginJobHydration(records: readonly JobRecord[]): void;
  /** Close the hydration bracket (the port mints fresh records again; any unconsumed preload is dropped). */
  endJobHydration(): void;
  /** The last COMPLETED projection's report (null before the first completion — the order/completeness surface). */
  lastProjection(): ProjectionReport | null;
  /** The typed failure of the last failed projection (null when none). */
  lastFailure(): StoreFailure | null;
  /**
   * THE DDL RUNBOOK SURFACE (W-28, lane B): apply EVERY DDL record in
   * `NEON_DDL_RECORDS` (idempotent by construction) and report schema
   * truth (information_schema only — L12: NO tenant data). The host-owned
   * internal routes (`POST /internal/deploy/ddl/apply` +
   * `GET /internal/deploy/ddl/verify`) ride this surface — the SAME Neon
   * SQL-over-HTTP client the durable stores compose over, no new
   * dependency. The production gap this runbook exists to heal: the 7th
   * table (`tradrl_jobs`, the W-27 lane) was added to the DDL records but
   * the runbook step was never executed on the production database
   * (deploy/README.md §neon).
   */
  readonly runbook: DurableRunbook;
  /**
   * THE SESSION-OWNERSHIP STAMP (FW-MI-A, MI-D1): record which console
   * session owns a just-created project. The host (api/router.ts) calls
   * this AFTER the boundary confirmed a create-project (POST /v1/projects
   * answered 2xx) and BEFORE the drain, with the session header the
   * console sent on the create — the stamp merges the additive
   * `ownerSession` field into the project's goal-set row payload (the
   * SAME opaque-column precedent as W-28's `world`) and queues the durable
   * write onto the SAME drain the create's own writes ride (the ordering
   * law: a failed stamp write is the typed 503 + the re-projection — the
   * create is unconfirmed, exactly like a failed registry write). The
   * merge source is the live goal-set overlay (the create just set it),
   * falling back to a fresh store read (an idempotent REPLAY after a cold
   * start — the port never re-ran); a read failure there skips the stamp
   * (best-effort, disclosed — the common path is exact). IDEMPOTENT: a row
   * already carrying the same owner queues nothing. A foreign tenant is
   * refused (L12 — the stamp keys on the seam's credential tenant).
   */
  stampSessionOwner(tenant: string, projectId: string, session: string): Promise<{ readonly stamped: boolean }>;
  /**
   * THE SESSION-LISTING READ (FW-MI-A, MI-D1): the tenant's project rows
   * LEFT JOINed with their goal-set rows (NeonProjectStore's
   * projectSessionRowsOf — one round trip). FRESH BY CONSTRUCTION: the
   * durable tables, never this instance's boot projection, so a project
   * created on ANOTHER serverless instance is visible the moment its
   * write drained (the MI-D8 staleness root cause — a warm instance's
   * projection never re-read the registry). A degraded Neon read is the
   * typed failure (the caller serves the R46 503 — a session view is
   * never a stale or partial one).
   */
  sessionProjectRows(): Promise<StoreResult<readonly SessionProjectRow[]>>;
  /**
   * THE FRESH TENANT-WIDE JOBS READ (FW-31-B, the P02 stall heal): a FRESH
   * read of tradrl_jobs for the credential tenant — the durable tables,
   * NEVER this instance's boot projection — returning every well-formed
   * job record of the tenant (L12 by construction: the store statement
   * scopes to the seam's tenant). The per-instance staleness heal
   * (runtime/durable-world.ts) reads this at a bounded interval: the
   * records this instance's API-owned job store LACKS (a launch's kickoff
   * job submitted on ANOTHER warm instance) replay back through the REAL
   * public job routes, so the frozen per-id GET /v1/jobs/:jobId and the
   * host-owned jobs list serve them on EVERY instance — the P02 root
   * cause (the boot-time hydration was the only cross-instance bridge; a
   * warm instance that booted before the launch answered the poll's 404s
   * forever). A degraded read is the typed failure (the heal skips —
   * never a crash, retried on a later interval).
   */
  freshJobRecordsOfTenant(): Promise<StoreResult<readonly JobRecord[]>>;
  /**
   * THE ORG-BIND INSTANT READ (FW-34-A — the notification-state drift fix,
   * Round C register item 4): the durable COMPILE instant of one project —
   * the latest `organization-bound` event's own `at` from the durable
   * event log, as this instance's projection replay captured it. The
   * durable activation's org-status snapshot pass (R7 at boot, the
   * staleness heal's org half at its interval) reports the re-hydrated
   * watch snapshot AT THIS INSTANT — never the boot/heal instant — so the
   * snapshot is byte-identical on every instance that reports it and the
   * console's notice fold derives a STABLE content-addressed id from it:
   * an "Organization compiled" notice never re-notifies as NEW unread
   * after a reload/restart (the pre-fix re-report stamped the session
   * instant, minting a fresh notice id per cold start and defeating the
   * persisted read marks), and the notice's availability instant is the
   * compile EVENT time (never the session-start instant — L4's own law).
   * The typed degraded state while the projection is down (R46); `null`
   * when the projection carries no bind event for the project (unbound,
   * or a bind this projection predates — the caller SKIPS the report
   * rather than fabricating a churned instant; the next interval, after
   * the quiet re-projection lands, reports the stable identity).
   */
  organizationBoundAtOf(projectId: string): { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly error: StoreFailure };
  /**
   * THE OUTCOME WRITE-THROUGH LANE (FW-33-A, Round B blocker 1): queue the
   * durable putOutcome write for one outcome record onto the SAME pending
   * drain every control-plane write rides — a promoted decision minted by
   * the host promote route (runtime/job-promote.ts) becomes durable TRUTH,
   * not per-instance state (the same putOutcome lane the boot-world
   * fixtures ride). IDEMPOTENT by construction: a record whose exact
   * payload the serving projection (or an already-queued write) already
   * carries queues nothing (the recordJobs pattern); a foreign tenant's
   * record is refused (L12 — never queued). The port-level twin of this
   * surface is attached to `ports.outcomeLearning` under
   * OUTCOME_DURABLE_LANE_FIELD (the ports-with-extra-surfaces precedent)
   * so the composition's derived-rows wrapper chain carries the lane
   * end-to-end and the promote route's mint can write through at mint
   * time + at serve time (the wrapper's own backstop).
   */
  recordOutcome(record: OutcomeRecordMirror): void;
  /**
   * THE STALENESS PROBE (FW-33-A): the serving projection's membership
   * snapshot — the registry project ids it has SEEN (reconstructed or
   * skipped: a skipped row never asks for a heal it cannot use), and the
   * outcome/post-mortem/knowledge ids it serves. The staleness heal
   * (runtime/durable-world.ts) compares its FRESH tenant-wide reads
   * against this set at its bounded interval: any record the durable
   * truth carries that the projection lacks (a promotion minted on
   * ANOTHER instance, a launch this instance's projection predates) is
   * the heal's refresh trigger. Null while the projection is degraded
   * or in flight (R46 — the heal skips, never a stale probe).
   */
  projectionMembership(): ProjectionMembership | null;
  /**
   * THE QUIET RE-PROJECTION (FW-33-A): re-read the durable truth (the boot
   * projection's SAME seven batched tenant-wide reads — the W-30 law) and
   * swap the serving projection in ATOMICALLY — with NO serving
   * degradation at any point: the current projection keeps serving while
   * the fresh one builds, and the swap lands only if the seam stays clean
   * through the reads (a failed write's dirty flag, an in-flight drain, a
   * queued pending lane — any of them discards the refresh; the next
   * interval retries). A failed read keeps the current projection serving
   * (the W-25D mid-instance law: never a crash, never a degraded read).
   * Returns whether a fresh projection was committed. The staleness heal
   * drives this when its probe finds the truth moved; the derived streams
   * (the FW-MI-B folds over goalOf + the control-plane listing) re-fold
   * from the fresh truth automatically — they read the projection.
   */
  reprojectQuietly(): Promise<boolean>;
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
 * Group tenant-wide rows by their owning project, preserving row order
 * within each group (the W-30 fold): the tenant-wide statements order
 * (project, ordinal) — so each group's rows are exactly the per-project
 * read's own order, and the group KEYS are the row's project COLUMN (the
 * authoritative scope — the same column the per-project statements filtered
 * on).
 */
function groupByProject<T extends { readonly project: string }>(rows: readonly T[]): Map<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.project);
    if (group === undefined) groups.set(row.project, [row]);
    else group.push(row);
  }
  return groups;
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
  // Capture the non-null neon deps for the closures below (the runbook
  // surface's applyDdl/verifyDdl) — TypeScript's flow analysis loses the
  // narrowing inside the closures without this local capture (the
  // `neonDeps` const is non-null here, but the closure widens it back to
  // `NeonStoreDeps | null` without the capture).
  const runbookNeonDeps: NeonStoreDeps = neonDeps;
  const firmMemoryStore = new NeonFirmMemoryStore(neonDeps);
  const outcomeStore = new NeonOutcomeLearningStore(neonDeps);
  const projectStore = new NeonProjectStore(neonDeps);
  const jobStore = new NeonJobStore(neonDeps);

  // The mutable projection state. `current` swaps ATOMICALLY at the end of
  // a successful projection (the event loop makes the swap synchronous);
  // `state` gates every port call — a stale (failed-write) projection is
  // never served, even though `current` still holds it.
  type Phase = 'idle' | 'projecting' | 'ready' | 'failed';
  /** One committed serving projection — the shape `current` holds. */
  type ServingProjection = {
    readonly controlPlane: ControlPlane;
    readonly knowledge: readonly ServedKnowledgeMirror[];
    readonly outcomes: readonly unknown[];
    readonly postMortems: readonly unknown[];
    readonly goalSets: ReadonlyMap<string, GoalSetRecord>;
    readonly jobs: ReadonlyMap<string, readonly JobRecord[]>;
    /** FW-34-A: each project's LATEST `organization-bound` event instant (the durable compile instant — the notification-identity fix's own anchor). */
    readonly organizationBoundAt: ReadonlyMap<string, number>;
    readonly report: ProjectionReport;
  };
  let phase: Phase = 'idle';
  let liveGoalSets: Map<string, GoalSetRecord> = new Map();
  let current: ServingProjection | null = null;
  let failure: StoreFailure | null = null;
  let report: ProjectionReport | null = null;
  let inFlight: Promise<void> | null = null;
  /**
   * FW-33-A: a drain is in flight — the QUIET re-projection's swap guard
   * (a fresh projection built while a request's writes are mid-drain may
   * lack those writes; the swap discards, the next interval retries).
   */
  let draining = false;
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
  // THE BOOT-TIME PROJECTION (W-30: seven batched tenant-wide reads ->
  // in-memory group-by fold -> atomic swap; registry -> goal sets via the
  // projects+goals JOIN -> events -> knowledge -> outcomes -> post-mortems
  // -> jobs)
  // -------------------------------------------------------------------------

  async function project(): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: StoreFailure }> {
    const built = await buildProjection();
    if (!built.ok) return built;
    commitProjection(built.value);
    return { ok: true };
  }

  /** One fully-built (not yet committed) projection — FW-33-A's split: the build reads the truth, the commit swaps it in. */
  async function buildProjection(): Promise<{ readonly ok: true; readonly value: ServingProjection } | { readonly ok: false; readonly error: StoreFailure }> {
    const controlPlane = createControlPlane(); // the REAL T007 service — a FRESH instance per projection (the universal recovery)
    const knowledge: ServedKnowledgeMirror[] = [];
    const outcomes: unknown[] = [];
    const postMortems: unknown[] = [];
    const goalSets = new Map<string, GoalSetRecord>();
    const jobs = new Map<string, readonly JobRecord[]>();
    const organizationBoundAt = new Map<string, number>();
    const skipped: { readonly project: string; readonly reason: string }[] = [];
    let events = 0;
    let jobCount = 0;

    // THE W-30 BATCHED READS (PROD-504): SEVEN round trips in TOTAL —
    // CONSTANT w.r.t. project count (the pre-fix seam issued ≈6 queries PER
    // PROJECT: at 25 durable projects ≈151 sequential SQL-over-HTTP fetches
    // before authn on every cold start, past the platform's function
    // duration cap — the production 504). Any failed read fails the WHOLE
    // projection (the atomic-swap law — a partial projection would be a
    // silent divergence); the group-by folds below reproduce the per-project
    // reads' order EXACTLY (each statement orders (project, ordinal)).

    // 1. THE REGISTRY (creation order — the D-5 core; the statement is
    //    unchanged from the per-project era).
    const registry = await projectStore.projectRecordsOf(deps.tenant);
    if (!registry.ok) return { ok: false, error: registry.error };

    // 2. THE GOAL SETS — tenant-wide over the EXISTING projects+goals JOIN
    //    (FW-MI-A's session-listing read: ONE round trip carries every
    //    project's goal-set payload beside its project row; the fold keys
    //    the goal sets by project id). A project with NO goal row folds to
    //    a lookup miss — the same skip the per-project `goalSetOf` null
    //    produced; a goal payload that is not a `{goal, constraintSet}`
    //    record is skipped AND REPORTED (the seam's own law — a record that
    //    cannot reconstruct is skipped, never a crash).
    const sessionRows = await projectStore.projectSessionRowsOf(deps.tenant);
    if (!sessionRows.ok) return { ok: false, error: sessionRows.error };
    const goalSetByProject = new Map<string, GoalSetRecord>();
    for (const row of sessionRows.value) {
      const record = row.project;
      if (!isRecord(record) || !isNonEmptyString(record.id)) continue; // a malformed project payload never keys a goal set (the registry read reports its own skip)
      if (row.goalSet !== null) goalSetByProject.set(record.id, row.goalSet);
    }

    // 3. THE EVENT LOGS — tenant-wide, (project_id, ordinal) order: the
    //    fold groups the rows by project and each group's ordinal order is
    //    the per-project replay order, preserved exactly.
    const eventRows = await projectStore.projectEventsOfTenant(deps.tenant);
    if (!eventRows.ok) return { ok: false, error: eventRows.error };
    const eventsByProject = groupByProject(eventRows.value);

    // 4. THE KNOWLEDGE — the tenant-wide BOOT read (the store refuses any
    //    non-boot options shape loudly, so the filter semantics can never
    //    silently diverge from the per-project boot read it replaces).
    const knowledgeRows = await firmMemoryStore.queryKnowledgeOfTenant({ tenant: deps.tenant }, { at: HYDRATION_AT, retention: null });
    if (!knowledgeRows.ok) return { ok: false, error: knowledgeRows.error };
    const knowledgeByProject = groupByProject(knowledgeRows.value);

    // 5. THE OUTCOMES + POST-MORTEMS — tenant-wide, (project, ordinal)
    //    order (one round trip each).
    const outcomeRows = await outcomeStore.queryOutcomesOfTenant(deps.tenant);
    if (!outcomeRows.ok) return { ok: false, error: outcomeRows.error };
    const outcomesByProject = groupByProject(outcomeRows.value);
    const postMortemRows = await outcomeStore.queryPostMortemsOfTenant(deps.tenant);
    if (!postMortemRows.ok) return { ok: false, error: postMortemRows.error };
    const postMortemsByProject = groupByProject(postMortemRows.value);

    // 6. THE DURABLE JOBS — tenant-wide, (project, submission) order
    //    (W-27, D-7): the tradrl_jobs rows the write-through lane persisted,
    //    read into the projection for the hydration driver (the boot world
    //    replays them through the REAL public job routes) and for the
    //    host-side jobs read.
    const jobRows = await jobStore.jobRecordsOfTenant(deps.tenant);
    if (!jobRows.ok) return { ok: false, error: jobRows.error };
    const jobsByProject = groupByProject(jobRows.value);

    // THE IN-MEMORY FOLD — registry creation order, per-project replay
    // order, exactly the pre-fix semantics (zero further round trips).
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
      // THE GOAL SET (the create-project input's goal + constraint set — the
      // seam persists them at createProject time; the tenant-wide JOIN fold
      // carries them, one round trip for the whole registry).
      const goalSet = goalSetByProject.get(id) ?? null;
      if (goalSet === null) {
        skipped.push({ project: id, reason: 'no durable goal set (the record cannot reconstruct through the real control plane)' });
        continue;
      }
      if (!isRecord(goalSet) || !('goal' in goalSet) || !('constraintSet' in goalSet)) {
        skipped.push({ project: id, reason: 'the stored goal set lacks goal/constraintSet (the record cannot reconstruct through the real control plane)' });
        continue;
      }
      try {
        controlPlane.createProject({
          id: id as never,
          tenantId: deps.tenant as never,
          name,
          executionMode: executionMode as never,
          goal: goalSet.goal as GoalStatement,
          constraintSet: goalSet.constraintSet as ConstraintSetStatement,
          at: createdAt as never,
        });
      } catch (cause) {
        skipped.push({ project: id, reason: cause instanceof ControlDomainError ? cause.code : 'the record failed reconstruction under the current domain law' });
        continue;
      }
      goalSets.set(id, goalSet);
      reconstructed.push({ id });

      // THE EVENT LOG replay (ordinal order — the tenant-wide read's own
      // (project, ordinal) ordering, folded per project): lifecycle events
      // replay through the real reducer; organization bindings through the
      // real binder.
      for (const entry of eventsByProject.get(id) ?? []) {
        try {
          if (entry.event === ORGANIZATION_BOUND_EVENT) {
            const detail = entry.detail;
            if (!isRecord(detail) || !isNonEmptyString(detail.organizationRef)) {
              skipped.push({ project: id, reason: `event ${ORGANIZATION_BOUND_EVENT}: the detail lacks organizationRef` });
              continue;
            }
            controlPlane.bindOrganization({ tenantId: deps.tenant as never, projectId: id as never, organizationRef: detail.organizationRef as never, at: entry.at as never });
            // FW-34-A (the notification-state drift fix): capture the bind
            // event's OWN instant — the durable compile instant. The R7
            // snapshot pass and the heal's org half report the re-hydrated
            // watch snapshot AT THIS INSTANT (never the boot/heal instant),
            // so the snapshot is byte-identical across instances and the
            // console's notice fold derives a STABLE content-addressed id
            // from it (the same compile event never re-notifies as new
            // unread on a restart, and the notice's availability instant is
            // the compile EVENT time, not the session start).
            organizationBoundAt.set(id, entry.at);
          } else {
            controlPlane.transition({ tenantId: deps.tenant as never, projectId: id as never, event: entry.event as never, at: entry.at as never });
          }
          events += 1;
        } catch (cause) {
          skipped.push({ project: id, reason: `event ${entry.event}: ${cause instanceof ControlDomainError ? cause.code : 'rejected'}` });
        }
      }
    }

    // THE KNOWLEDGE + THE OUTCOMES/POST-MORTEMS of every reconstructed
    // project (reconstruction order — the arrays concatenate exactly as the
    // per-project loops did; the tenant-wide rows' group orders are the
    // per-project reads' own).
    for (const { id } of reconstructed) {
      for (const row of knowledgeByProject.get(id) ?? []) knowledge.push(row.envelope);
    }
    for (const { id } of reconstructed) {
      for (const row of outcomesByProject.get(id) ?? []) outcomes.push(row.record);
      for (const row of postMortemsByProject.get(id) ?? []) postMortems.push(row.record);
    }

    // THE DURABLE JOBS of every reconstructed project (W-27, D-7): a
    // malformed payload row is skipped fail-closed (the store's own decode
    // law + the isJobRecord filter — the pre-fix law, unchanged).
    for (const { id } of reconstructed) {
      const records = (jobsByProject.get(id) ?? []).map((row) => row.record).filter((record): record is JobRecord => isJobRecord(record));
      jobs.set(id, Object.freeze([...records]));
      jobCount += records.length;
    }

    // THE BUILD'S RESULT (FW-33-A: the caller commits — the boot lane
    // unconditionally on success, the quiet refresh only while the seam
    // stayed clean through the reads).
    return {
      ok: true,
      value: {
        controlPlane,
        knowledge: Object.freeze(knowledge),
        outcomes: Object.freeze(outcomes),
        postMortems: Object.freeze(postMortems),
        goalSets,
        jobs,
        organizationBoundAt,
        report: { projects: reconstructed.length, events, knowledge: knowledge.length, outcomes: outcomes.length, postMortems: postMortems.length, jobs: jobCount, skipped: Object.freeze([...skipped]) },
      },
    };
  }

  /**
   * THE COMMIT (FW-33-A's split, the old atomic swap): the projection
   * becomes the serving state; the live goal-set overlay follows it. The
   * swap itself is synchronous (the event loop's own atomicity — every
   * port call either sees the whole old projection or the whole new one).
   */
  function commitProjection(projection: ServingProjection): void {
    current = projection;
    // The live overlay IS the projection's own map (the pre-FW-33-A aliasing,
    // preserved: createProject's write-through extends the committed map in
    // place — the read type is readonly, the write side keeps its handle).
    liveGoalSets = projection.goalSets as Map<string, GoalSetRecord>;
    report = projection.report;
    failure = null;
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

  /**
   * THE STALENESS PROBE'S COMPARISON BASE (FW-33-A): the serving
   * projection's membership — the registry ids it has SEEN (reconstructed
   * or skipped: a row it already skipped can never reconstruct better, so
   * it never asks for a refresh) and the outcome/post-mortem/knowledge ids
   * it serves. Null while degraded/pending/dirty (the heal skips — never a
   * stale probe).
   */
  function projectionMembership(): ProjectionMembership | null {
    if (phase !== 'ready' || current === null || dirty) return null;
    const registryProjectIds = new Set<string>(current.goalSets.keys());
    for (const skip of current.report.skipped) registryProjectIds.add(skip.project); // the SEEN set — a skipped row is not a refresh trigger
    const outcomeIds = new Set<string>();
    for (const record of current.outcomes) {
      if (isRecord(record) && isNonEmptyString(record.outcomeId)) outcomeIds.add(record.outcomeId);
    }
    const postMortemIds = new Set<string>();
    for (const record of current.postMortems) {
      if (isRecord(record) && isNonEmptyString(record.postMortemId)) postMortemIds.add(record.postMortemId);
    }
    const knowledgeIds = new Set<string>();
    for (const envelope of current.knowledge) {
      const record = (envelope as { readonly record?: unknown }).record;
      if (isRecord(record) && isNonEmptyString(record.knowledgeId)) knowledgeIds.add(record.knowledgeId);
    }
    return { registryProjectIds, outcomeIds, postMortemIds, knowledgeIds };
  }

  /**
   * THE QUIET RE-PROJECTION (FW-33-A — the staleness heal's refresh): build
   * a fresh projection (the SAME seven batched tenant-wide reads) while the
   * CURRENT projection keeps serving — the boot lane's phase transitions
   * ('projecting' -> the ports degrade) are NOT ridden here; the swap lands
   * only if the seam stayed clean through the reads. The guards, in order:
   *   - a seam that is not ready/idle (a failed write's dirty flag, an
   *     in-flight attempt or drain, a queued pending lane) never starts
   *     (those lanes own the seam's transitions) — and a seam that BECAME
   *     unclean while the reads ran DISCARDS the build (W-26C: a projection
   *     whose reads predate a failed write must never serve; a build that
   *     raced a pending drain may lack its writes);
   *   - a failed read keeps the current projection serving (the W-25D
   *     mid-instance law — never a crash, never a degraded read).
   */
  let quietRefreshInFlight = false;
  async function reprojectQuietly(): Promise<boolean> {
    if (quietRefreshInFlight) return false; // one quiet refresh at a time (the heal's own serial cadence)
    if (dirty || phase !== 'ready' || inFlight !== null || draining || pending.length > 0) return false;
    quietRefreshInFlight = true;
    try {
      const built = await buildProjection();
      if (!built.ok) return false; // the current projection keeps serving (the mid-instance law)
      if (dirty || phase !== 'ready' || inFlight !== null || draining || pending.length > 0) return false; // the seam moved under the reads — discard, the next interval retries
      commitProjection(built.value);
      return true;
    } catch {
      return false; // unreachable by construction (the build is typed, never throws) — R46 regardless
    } finally {
      quietRefreshInFlight = false;
    }
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
      // FW-38-A (Round G register G-1 — the goal-capture seam): the goal
      // record is BORN here with the SPAN-DERIVED horizon label
      // (withDerivedGoalHorizonLabel) — the create input's free-text
      // annotation is NOT trusted off the wire (the console wizard's draft
      // stamps its 'one day' default and never updates it when the horizon
      // end moves, so 30/45/60/90-day spans served "horizon label: one day"
      // on the Goal card and in the export's goal record while the same
      // launch's deliverable said "(span 90 days)" — 9/9 Round G personas).
      // The derived goal is the ONE truth the seam carries: the inner
      // control-plane call, the live overlay, and the durable row all hold
      // the same record (never a capture that disagrees with its store).
      const goal = withDerivedGoalHorizonLabel(input.goal as GoalStatement);
      const result = adapt(() => current!.controlPlane.createProject({
        id: input.id as never,
        tenantId: input.tenantId as never,
        name: input.name,
        executionMode: input.executionMode as never,
        goal,
        constraintSet: input.constraintSet as ConstraintSetStatement,
        at: input.at as never,
      }));
      if (!result.ok) return result;
      const record = result.value;
      const projectId = input.id as string;
      const goalSet: GoalSetRecord = { goal, constraintSet: input.constraintSet };
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

  const outcomeLearningPort: OutcomeLearningPortWithDurableLane = {
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
    // FW-33-A (Round B blocker 1): the port carries the OUTCOME WRITE LANE
    // as its documented extra surface (the ports-with-extra-surfaces
    // precedent — demoExecutionGateway's `recorded`): the composition's
    // derived-rows wrapper chain propagates it (demo.ts's
    // outcomeLearningWithProjectEvidence), so the promoted-decisions wrapper
    // composed above it (job-promote.ts) can write the host route's minted
    // records through the same putOutcome lane the boot-world fixtures
    // ride — a promoted decision becomes durable TRUTH, never per-instance
    // state. The handle-level twin is `recordOutcome` below.
    [OUTCOME_DURABLE_LANE_FIELD]: { recordOutcome } satisfies OutcomeDurableWriteLane,
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
  // THE HYDRATION-AWARE JOB-SUBMISSION PORT + THE JOB WRITE-THROUGH LANE
  // (W-27, D-7 — the durable jobs surface)
  // -------------------------------------------------------------------------

  /**
   * The hydration preload: while the bracket is open, `submitJob` serves
   * these records verbatim (FIFO — the boot world primes exactly the
   * records it replays, so the alignment is by construction); the boot
   * world's driver is SYNCHRONOUS inside the bracket, so nothing else can
   * consume a preloaded record. Empty (the permanent state outside the
   * bracket) => the inner fixture engine mints fresh records, the
   * pre-W-27 law byte-identical.
   */
  let hydrationQueue: JobRecord[] = [];

  const innerJobSubmission = fakeJobSubmission();

  // FW-31-B: the DEMO-SEED PRIMING LATCH — the same per-instance identity law
  // the demo arm's own job port carries (demoSeedJobPrimingLatch, runtime/
  // demo.ts): the boot world's per-instance demo-job re-seed (D-053's
  // disclosed limitation) serves the DETERMINISTIC seeded records (stable
  // id + demo-epoch submittedAt), so the re-seed is idempotent IN IDENTITY —
  // the demo scope's job list never rotates across serverless instances
  // again (Round A blocker 3's re-seed half: C10's "job list rotated
  // 1dee5b04/18a43c88@04:33 ↔ 48db6d85/91eeb12f@04:24"). A lookalike spec
  // after the seed's own first submission falls through to the fixture
  // engine — the latch is the seed's identity law, never an interception.
  const demoSeedPriming = demoSeedJobPrimingLatch();

  const jobSubmissionPort: JobSubmissionPort = {
    submitJob(input): PortResult<JobRecord> {
      if (hydrationQueue.length > 0) {
        // The hydration replay: the durable record serves VERBATIM (its
        // exact jobId, status, result and timestamps) — the frozen
        // pipeline's handler stores the port's return into the API-owned
        // job store, which is the whole point (the store the per-id GET
        // and the list fold read now carries the durable record). The
        // replay's spec is the seam's own `{ hydrated: true }` marker —
        // never a console-launch spec, so no world capture rides this
        // path (the world persisted at the ORIGINAL submission).
        return { ok: true, value: hydrationQueue.shift() as JobRecord };
      }
      // FW-31-B: the deterministic demo-seed identity FIRST (the seed's
      // spec is never a console-launch spec, so the priming and the world
      // capture below never collide; the demo project's goal set stays
      // world-less by design either way).
      const seeded = demoSeedPriming.prime(input);
      if (seeded !== null) return { ok: true, value: seeded };
      // THE LAUNCH WORLD CAPTURE (D-8, W-28): a console-launch kickoff
      // spec carries the launch's world specification — the only
      // console->host carrier the frozen contracts leave room for (the
      // create-project parser keeps exactly its own six fields). The
      // world MERGES into the project's goal-set row: the live overlay
      // serves it immediately (goalOf) and the durable write rides the
      // drain like every control-plane write (the ordering law). The
      // capture is structural (launchWorldOfSpec validates every field;
      // a foreign or malformed spec captures nothing — R46), skips the
      // DEMO project (its goal set stays world-less by design — the demo
      // scope's teaching empty state is correct), requires a goal set on
      // record for the project (the console's flow always creates the
      // project first; an unknown project's world is skipped, never a
      // crash), and is IDEMPOTENT — a goal set already carrying the same
      // world (byte-identical, the W-27 recordJobs pattern) queues
      // nothing.
      const world = launchWorldOfSpec(input.spec);
      if (world !== null) {
        const projectId = input.project as string;
        if (projectId !== DEMO_PROJECT_ID) {
          const existing = liveGoalSets.get(projectId) ?? null;
          if (existing !== null) {
            const merged: GoalSetRecord = { ...existing, world };
            if (canonicalJson((existing.world ?? null) as never) !== canonicalJson(world as never)) {
              liveGoalSets.set(projectId, merged);
              pending.push({ label: 'goalset.world.put', run: () => projectStore.putGoalSet(deps.tenant, projectId, merged) });
            }
          }
        }
      }
      return innerJobSubmission.submitJob(input);
    },
  };

  function beginJobHydration(records: readonly JobRecord[]): void {
    hydrationQueue = [...records];
  }

  function endJobHydration(): void {
    hydrationQueue = [];
  }

  /** The projection's durable payload of one job id (canonical JSON — the recordJobs skip's comparison key). */
  function projectedJobPayload(jobId: string): string | null {
    for (const records of current?.jobs.values() ?? []) {
      const found = records.find((record) => record.jobId === jobId);
      if (found !== undefined) return canonicalJson(found as never);
    }
    return null;
  }

  function recordJobs(records: readonly JobRecord[]): void {
    for (const record of records) {
      // L12 by construction: only the credential tenant's job records ever
      // queue (the pipeline injects the tenant; the store would refuse a
      // foreign row — this guard keeps it out of the drain entirely).
      if (record.tenant !== deps.tenant) continue;
      // The idempotent no-op: the projection already holds this exact
      // payload (the hydration replays re-store their own durable records)
      // — never re-write what did not change.
      if (projectedJobPayload(record.jobId) === canonicalJson(record as never)) continue;
      const job = record;
      pending.push({ label: 'job.put', run: () => jobStore.putJobRecord(deps.tenant, job) });
    }
  }

  // -------------------------------------------------------------------------
  // THE OUTCOME WRITE-THROUGH LANE (FW-33-A, Round B blocker 1 — the same
  // discipline the job lane (W-27) brought to tradrl_jobs, brought to
  // tradrl_outcomes: a promoted decision minted by the host promote route
  // rides the drain the moment it mints (and again the moment it serves,
  // as the wrapper's backstop), so the record becomes durable TRUTH — a
  // fresh instance's boot projection reads it, a warm instance's staleness
  // heal re-reads it. The lane never fabricates: it only ever queues
  // records the composition's own registry minted (L12 + idempotent).
  // -------------------------------------------------------------------------

  /** The outcome payloads already queued onto the drain (the idempotent no-op's second skip). */
  const pendingOutcomePayloads = new Set<string>();

  /** The projection's durable payload of one outcome id (canonical JSON — the recordOutcome skip's comparison key). */
  function projectedOutcomePayload(outcomeId: string): string | null {
    for (const record of current?.outcomes ?? []) {
      if (isRecord(record) && record.outcomeId === outcomeId) return canonicalJson(record as never);
    }
    return null;
  }

  function recordOutcome(record: OutcomeRecordMirror): void {
    // L12 by construction: only the credential tenant's outcome records
    // ever queue (the promote route's authorized tenant IS the seam's
    // tenant; a foreign row is refused before the drain entirely).
    if (record.tenant !== deps.tenant) return;
    const payload = canonicalJson(record as never);
    // The idempotent no-op, first skip: the projection already holds this
    // exact payload (the write-through landed + a later projection read it
    // back) — never re-write what did not change.
    if (projectedOutcomePayload(record.outcomeId) === payload) return;
    // The idempotent no-op, second skip: an identical write is already
    // queued (the mint-time queue + the serve-time backstop racing one
    // drain) — the pending set clears as the write runs, so a FAILED write
    // stays retryable on a later mint or serve.
    if (pendingOutcomePayloads.has(payload)) return;
    pendingOutcomePayloads.add(payload);
    const outcome = record;
    pending.push({
      label: 'outcome.put',
      run: async () => {
        const written = await outcomeStore.putOutcome(deps.tenant, outcome);
        pendingOutcomePayloads.delete(payload); // failed or confirmed — either way the write left the lane
        return written;
      },
    });
  }

  function jobsOf(projectId: string): { readonly ok: true; readonly value: readonly JobRecord[] } | { readonly ok: false; readonly error: StoreFailure } {
    if (phase !== 'ready' || current === null || dirty) {
      const degradedFailure: StoreFailure = failure !== null
        ? failure
        : { code: 'durable_projection_pending', message: 'the durable projection is in flight; the jobs read degrades (R46)' };
      return { ok: false, error: degradedFailure };
    }
    return { ok: true, value: current.jobs.get(projectId) ?? Object.freeze([]) };
  }

  // -------------------------------------------------------------------------
  // THE DRAIN (the ordering law's second half — the host owns the async lane)
  // -------------------------------------------------------------------------

  async function drain(): Promise<DrainResult> {
    const writes = pending.splice(0, pending.length);
    draining = true; // FW-33-A: the quiet refresh's swap guard (a build that raced this drain is discarded)
    try {
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
    } finally {
      draining = false;
    }
  }

  function goalOf(projectId: string): { readonly ok: true; readonly value: GoalSetRecord | null } | { readonly ok: false; readonly error: StoreFailure } {
    if (phase !== 'ready' || current === null || dirty) {
      const degradedFailure: StoreFailure = failure !== null
        ? failure
        : { code: 'durable_projection_pending', message: 'the durable projection is in flight; the goal read degrades (R46)' };
      return { ok: false, error: degradedFailure };
    }
    // FW-38-A (G-1 — the serve-side healing half): a goal-set row persisted
    // BEFORE this wave (carrying the console's stale 'one day' annotation on
    // a multi-day horizon) serves the SAME span-derived label as a fresh
    // capture — one law, every record, never a contradictory annotation on
    // the wire. Every durable consumer of the goal statement (the goal
    // routes, the risk-utilization fold, the evidence source, the deliverable
    // source) reads through this seam, so they all serve the derived label.
    const record = liveGoalSets.get(projectId) ?? null;
    return record === null ? { ok: true, value: null } : { ok: true, value: { ...record, goal: withDerivedGoalHorizonLabel(record.goal) } };
  }

  // -------------------------------------------------------------------------
  // THE DDL RUNBOOK (W-28, lane B): apply EVERY DDL record + verify schema
  // truth, over the SAME Neon SQL-over-HTTP client the durable stores
  // compose over. The runbook is host-owned — the host route serves it
  // before the boundary wrap; it never reads tenant data (information_schema
  // only — L12); it never re-implements the wire format (zero-dep law).
  // -------------------------------------------------------------------------

  // The fetch the runbook issues its statements over (the seam's injected
  // fetch — fakes in tests, the platform fetch in production; never ambient).
  // The same fallback law the Neon stores apply (deps.fetchLike ?? platform
  // fetch resolved lazily — tests never hit the network).
  const runbookFetchLike: FetchLike = runbookNeonDeps.fetchLike ?? ((input: string, init?: { method?: string; headers?: Readonly<Record<string, string>>; body?: string }) => {
    const fetchGlobal = (globalThis as { fetch?: unknown }).fetch;
    if (typeof fetchGlobal !== 'function') {
      return Promise.reject(new Error('no fetch implementation is available in this runtime'));
    }
    return (fetchGlobal as FetchLike)(input, init);
  });

  async function applyDdl(): Promise<DdlApplyResult> {
    // Apply EVERY record in `NEON_DDL_RECORDS` IN THE LISTED ORDER, each via
    // the existing Neon SQL-over-HTTP client the durable stores compose over.
    // DDL is idempotent by construction (`CREATE TABLE IF NOT EXISTS` / `CREATE
    // INDEX IF NOT EXISTS`), so applying twice is safe. The apply STOPS on the
    // first failure (the precedent of `drain()` — the ordering law) and
    // returns the typed failure of the failed record (the host serves the
    // typed 503 listing the failed table + the failure code ONLY — scrubbed
    // of any secret-shaped material: the table name + the neon failure code
    // are safe; raw SQL error text is NOT).
    const tables: DdlApplyTableResult[] = [];
    for (const record of NEON_DDL_RECORDS) {
      // The DDL is a schema-level statement (no bind parameters, no tenant
      // scope — L12 by construction: it touches NO tenant data). The Neon
      // SQL-over-HTTP client sends the whole record's DDL string as one
      // query (the live proxy accepts multi-statement queries when no
      // params are bound — the same wire path every adapter read/write
      // rides, never re-implemented).
      const executed = await executeNeonStatement(runbookNeonDeps.config, record.ddl, [], runbookFetchLike);
      if (!executed.ok) {
        // The host serves the typed 503 listing the failed table + the
        // neon failure code ONLY (the scrubbing law — the sweep precedent).
        return {
          ok: false,
          error: { code: executed.error.code, message: `the DDL apply failed for ${record.table} (${executed.error.code}) — the boundary degrades this route (R46)` },
        };
      }
      // HONESTY LAW: the wire response does not distinguish "applied" from
      // "already-present" (a `CREATE TABLE IF NOT EXISTS` that changes
      // nothing still returns the same command tag). The honest per-table
      // result is `"ok"` for both — never a fabricated distinction. The PR
      // body discloses this honestly.
      tables.push({ table: record.table, result: 'ok' });
    }
    return { ok: true, tables: Object.freeze(tables) as readonly DdlApplyTableResult[] };
  }

  async function verifyDdl(): Promise<DdlVerifyResult> {
    // Query `information_schema.tables` for the table names in
    // `NEON_DDL_RECORDS` (schema metadata, parameterized — L12: NO tenant
    // data ever crosses; every dynamic value is a $n bind parameter). The
    // query is `SELECT table_name FROM information_schema.tables WHERE
    // table_name IN ($1..$n)` so the surface stays parameterized end-to-end
    // (no value is SQL-interpolated — the L12 law in shared infrastructure).
    const tableNames = NEON_DDL_RECORDS.map((record) => record.table);
    const placeholders = tableNames.map((_, index) => `$${index + 1}`).join(', ');
    const query = `SELECT table_name FROM information_schema.tables WHERE table_name IN (${placeholders})`;
    const executed = await executeNeonStatement(runbookNeonDeps.config, query, tableNames, runbookFetchLike);
    if (!executed.ok) {
      // Same scrubbing law: the neon failure code ONLY.
      return { ok: false, error: { code: executed.error.code, message: `the DDL verify read failed (${executed.error.code}) — the boundary degrades this route (R46)` } };
    }
    // Decode the SELECT response (each row is `[table_name]` in array mode).
    const present = new Set<string>();
    if (executed.value.kind === 'select') {
      for (const row of executed.value.rows) {
        const value = row[0];
        if (typeof value === 'string') present.add(value);
      }
    }
    const tables: DdlVerifyTableResult[] = NEON_DDL_RECORDS.map((record) => ({ table: record.table, exists: present.has(record.table) }));
    const presentCount = tables.filter((entry) => entry.exists).length;
    const coverage = `${presentCount}/${tables.length} tables present`;
    return { ok: true, tables: Object.freeze(tables) as readonly DdlVerifyTableResult[], coverage };
  }

  const runbook: DurableRunbook = { applyDdl, verifyDdl };



  // -------------------------------------------------------------------------
  // THE SESSION-SCOPE SURFACES (FW-MI-A, MI-D1 — the ownership stamp + the
  // fresh session-listing read)
  // -------------------------------------------------------------------------

  /**
   * THE SESSION-OWNERSHIP STAMP: merge the owning console session into the
   * project's goal-set row (the additive `ownerSession` field — the W-28
   * `world` precedent) and queue the durable write onto the SAME drain the
   * create's own writes ride. See the handle interface for the full law.
   */
  async function stampSessionOwner(tenant: string, projectId: string, session: string): Promise<{ readonly stamped: boolean }> {
    if (tenant !== deps.tenant) return { stamped: false }; // L12 — the stamp keys on the seam's credential tenant, never a request value
    // The merge source: the live overlay first (the common path — the create
    // port just set it), else a fresh store read (the idempotent-replay
    // after a cold start edge; a failed read there skips the stamp —
    // best-effort, disclosed, never a thrown failure on the response path).
    let existing: GoalSetRecord | null = liveGoalSets.get(projectId) ?? null;
    if (existing === null) {
      const read = await projectStore.goalSetOf(deps.tenant, projectId);
      if (!read.ok) return { stamped: false };
      existing = read.value;
    }
    if (existing === null) return { stamped: false }; // no goal set on record — the project cannot reconstruct either; nothing to stamp
    if (ownerSessionOf(existing) === session) return { stamped: true }; // idempotent — the durable truth already carries this owner
    const merged: GoalSetRecord = { ...existing, ownerSession: session };
    liveGoalSets.set(projectId, merged);
    pending.push({ label: 'goalset.session.put', run: () => projectStore.putGoalSet(deps.tenant, projectId, merged) });
    return { stamped: true };
  }

  /** THE SESSION-LISTING READ: the fresh JOIN over the durable tables (projectSessionRowsOf — never the boot projection). */
  async function sessionProjectRows(): Promise<StoreResult<readonly SessionProjectRow[]>> {
    return projectStore.projectSessionRowsOf(deps.tenant);
  }

  /** THE FRESH TENANT-WIDE JOBS READ (FW-31-B): the durable tables, never the projection — the staleness heal's data source. */
  async function freshJobRecordsOfTenant(): Promise<StoreResult<readonly JobRecord[]>> {
    const rows = await jobStore.jobRecordsOfTenant(deps.tenant);
    if (!rows.ok) return rows;
    return { ok: true, value: Object.freeze(rows.value.map((row) => row.record).filter((record): record is JobRecord => isJobRecord(record))) };
  }

  /**
   * THE ORG-BIND INSTANT READ (FW-34-A — the notification-state drift fix):
   * the durable compile instant of one project — the LATEST
   * `organization-bound` event's own `at` from the durable event log, as
   * the projection's replay captured it (the same replay that re-binds the
   * org). The R7 snapshot pass (runtime/durable-world.ts) and the heal's
   * org half report the re-hydrated watch snapshot AT THIS INSTANT, so the
   * snapshot is byte-identical across instances: the console's notice fold
   * derives a STABLE content-addressed notice id from it (a 23-minute-old
   * compile event never re-notifies as new unread on a restart) and the
   * notice's availability instant is the compile EVENT time (never the
   * session-start instant the pre-fix boot re-report stamped). The typed
   * degraded state while the projection is down (R46); `null` when the
   * projection carries no bind event for the project (an unbound project,
   * or a bind this projection has not seen yet — the caller skips, never
   * fabricates an instant).
   */
  function organizationBoundAtOf(projectId: string): { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly error: StoreFailure } {
    if (phase !== 'ready' || current === null || dirty) {
      const degradedFailure: StoreFailure = failure !== null
        ? failure
        : { code: 'durable_projection_pending', message: 'the durable projection is in flight; the org-bind instant read degrades (R46)' };
      return { ok: false, error: degradedFailure };
    }
    return { ok: true, value: current.organizationBoundAt.get(projectId) ?? null };
  }

  return {
    ports: { controlPlane: controlPlanePort, firmMemory: firmMemoryPort, outcomeLearning: outcomeLearningPort, jobSubmission: jobSubmissionPort },
    settled,
    reproject,
    drain,
    goalOf,
    jobsOf,
    recordJobs,
    beginJobHydration,
    endJobHydration,
    stampSessionOwner,
    sessionProjectRows,
    freshJobRecordsOfTenant,
    organizationBoundAtOf,
    recordOutcome,
    projectionMembership,
    reprojectQuietly,
    lastProjection: () => report,
    lastFailure: () => failure,
    runbook,
  };
}

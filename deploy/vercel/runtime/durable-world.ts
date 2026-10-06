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
  type ApiService,
  type TenantId,
} from '../../../services/api/src/index';
import { fixtureKnowledge } from '../../../services/api/src/fixtures';
import {
  DEMO_PROJECT_ID,
  demoMachineryTick,
  demoOrgStatusSnapshot,
  demoOutcomeRecord,
  demoPostMortemRecord,
  seedDemoJobs,
  seedDemoWorld,
} from './demo';
import { HYDRATION_AT, type DurableBackingHandle } from './durable';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, type NeonStoreDeps } from '../../adapters/neon/stores';

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
   * (R46 — never a crash).
   */
  function reportMissingOrgStatusSnapshots(at: number): void {
    if (seed.internalToken === null) return; // the private plane stays closed — the watch store stays honestly empty
    const listed = durable.ports.controlPlane.projectsOf(tenantId);
    if (!listed.ok) return; // R46: a degraded projection skips the pass — never a crash
    const known = new Set(service.orgStatusSnapshots().map((snapshot) => `${snapshot.organizationRef as string}/${snapshot.project as string}`));
    for (const project of listed.value) {
      const organizationRef = project.lifecycle.organizationRef;
      if (organizationRef === null) continue; // unbound — the tick's compile pass owns those
      if (known.has(`${organizationRef as string}/${project.id as string}`)) continue; // already reported on this instance
      const snapshot = demoOrgStatusSnapshot(seed.tenant, project.id as string, organizationRef as string, at);
      if (snapshot === null) continue; // unreachable (the fixture builder is the canonical shape) — skip, never a crash
      service.handle({
        method: 'POST',
        path: '/internal/organizations/status',
        headers: { authorization: `Bearer ${seed.internalToken}` },
        body: { snapshot },
      });
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
    reportMissingOrgStatusSnapshots(bootAt);
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

  // The machinery tick (R2): the SAME law over the seam's hydrated control plane.
  const internalToken = seed.internalToken;
  const tick = internalToken === null
    ? null
    : (at: number) => {
        // The context's control plane is the seam's HYDRATED port — the
        // compile pass's projectsOf read works unchanged (R2's law).
        demoMachineryTick(service, { ports: { controlPlane: durable.ports.controlPlane }, tenant: seed.tenant, developerToken: seed.developerToken, internalToken }, at);
      };

  return { tick, ensureBootWorld };
}

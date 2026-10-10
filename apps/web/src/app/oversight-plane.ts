// @tradrl/web-console — THE OVERSIGHT READ PLANE (FW-37-B's cadence,
// extracted + extended by FW-38-B — the payload-budget extraction
// pattern core/export-flow.ts established: console.ts rides a 160 KiB
// single-file line and this wave's additions cross it, so the whole
// per-desk cadence moves to its own module with INJECTED seams).
//
// THE CADENCE (Round F register F-2 — every multi-desk persona's #1
// ask): one bundle per SESSION-OWN desk (core/tenant.ts's
// sessionOwnDesksOf — the session's own launched projects plus the
// shared demo desk; another session's desks NEVER enter, the L12
// workspace boundary the switcher/palette ride), each collected through
// the SAME frozen routes every section rides (the standing
// risk-utilization read, the execution blotter, the decision stream)
// and dispatched as the cross-desk `oversight-read` event the fold
// renders. Degrades SILENTLY per desk, exactly like the goal/utilization
// reads: a desk without records on the host is the host's answer (the
// fold renders the honest "no read on record" row — never a fabricated
// number, never a degradation note for a route the host never promised
// that desk).
//
// FW-38-B (Round G register G-3 + G-4):
//   G-3 — the bundle now carries the desk's OWN organization-status
//   snapshot (the same frozen route the Organization section rides,
//   paired with THIS desk's project id — the reducer's own-desk gate
//   refuses a crossed snapshot), so the oversight row's pill can render
//   the ORG operating status instead of the project-record lifecycle
//   "draft". Optional + nullable: a desk with no organization ref yet
//   and a backing that answers nothing both fold to the honest "not
//   compiled" absence.
//   G-4 (L1) — the RETURN-TO-LIVE RECOVERY. The pre-fix plane had NO
//   recovery cadence: it ran at boot and on scope changes only, so a
//   transiently failed re-read (L1's reproduction: the refresh that
//   raced a just-launched desk — the utilization route answered nothing
//   while the goal-set capture was still landing) REPLACED a good
//   bundle with the honest-absence zeros and the degradation PERSISTED
//   in LIVE until a project switch happened to re-run the whole bundle.
//   The fix is the cadence gap, not the host: returning the Time
//   Machine to LIVE now re-reads exactly the DEGRADED desks (a bundle
//   with no utilization read or an empty blotter), a bounded,
//   user-triggered recovery — the healthy desks are never re-read, and
//   the plane never loops on its own.
//
// Spec anchors: R36 (project-centric UX), L12 (the session-own wall),
// L20 (the console renders; a degraded read is the host's answer, never
// a console failure).

import type { ConsoleClient } from '../api/client';
import type { GatewaySubmissionRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, RiskUtilizationRead } from '../api/contracts';
import type { OversightDeskRead } from '../core/oversight';
import { DEMO_PROJECT_ID, sessionOwnDesksOf } from '../core/tenant';
import type { WorkspaceEvent } from '../core/workspace';

/** The injected seams the plane rides (the export-flow.ts pattern — no closure state of its own). */
export interface OversightPlaneSeams {
  /** The frozen-route client (structurally picked — the plane never touches the other families). */
  readonly client: Pick<ConsoleClient, 'risk' | 'execution' | 'outcomes' | 'organizations'>;
  /** The workspace event sink (the reducer's own ingest gates apply). */
  readonly dispatch: (event: WorkspaceEvent) => void;
  /** The injected instant source (never a wall clock). */
  readonly nowMs: () => number;
  /** The tenant's project directory as currently on record (the session-own listing derives from it). */
  readonly directory: () => readonly ProjectRecord[];
  /** The oversight plane's bundles as currently on record (the recovery's degraded-desk check). */
  readonly bundles: () => readonly OversightDeskRead[];
}

/** Read ONE desk's bundle (each read degrades silently — the host's answer for that desk, never a crash of the plane). */
async function readDeskBundle(seams: OversightPlaneSeams, desk: ProjectRecord): Promise<OversightDeskRead> {
  const deskId = desk.id;
  let utilization: RiskUtilizationRead | null = null;
  try {
    utilization = await seams.client.risk.utilization(deskId);
  } catch {
    utilization = null; // the host's honest answer for this desk — the fold names the absence
  }
  let submissions: readonly GatewaySubmissionRecord[] = [];
  try {
    submissions = [...(await seams.client.execution.submissions(deskId)).items];
  } catch {
    submissions = [];
  }
  let decisions: readonly OutcomeRecord[] = [];
  try {
    decisions = [...(await seams.client.outcomes.query({ project: deskId, at: seams.nowMs() })).items];
  } catch {
    decisions = [];
  }
  // FW-38-B (G-3): the desk's OWN org-status snapshot — read only when
  // the directory row carries an organization ref; the snapshot pairs
  // THIS desk's project id (the reducer's own-desk gate refuses a
  // crossed one). No ref yet (pre-compile) or a route that answers
  // nothing folds to null — the honest "not compiled", never a
  // fabricated status.
  let orgStatus: OrgStatusSnapshot | null = null;
  const organizationRef = desk.lifecycle.organizationRef;
  if (organizationRef !== null) {
    try {
      orgStatus = await seams.client.organizations.status(organizationRef, deskId);
    } catch {
      orgStatus = null;
    }
  }
  return { projectId: deskId, utilization, submissions, decisions, orgStatus, readAt: seams.nowMs() };
}

/**
 * THE OVERSIGHT READ CADENCE — one bundle per session-own desk, run at
 * boot and on every scope-change refetch (the bundle's own position).
 */
export async function readOversightPlane(seams: OversightPlaneSeams): Promise<void> {
  for (const desk of sessionOwnDesksOf(seams.directory(), DEMO_PROJECT_ID)) {
    try {
      const bundle = await readDeskBundle(seams, desk);
      seams.dispatch({ kind: 'oversight-read', at: seams.nowMs(), read: bundle });
    } catch {
      // a desk whose bundle could not compose at all keeps its prior
      // bundle (or its honest absence) — the plane degrades per desk,
      // never crashes the bundle.
    }
  }
}

/**
 * FW-38-B (Round G register G-4 — L1's durability defect): THE
 * RETURN-TO-LIVE RECOVERY. The pre-fix plane degraded to honest-absence
 * zeros after a transiently failed re-read and PERSISTED in LIVE until
 * a project switch; returning the Time Machine to LIVE now re-reads
 * exactly the DEGRADED desks — a bundle with no utilization read or an
 * empty blotter (L1's D1 lost its counts entirely, D2 its budget rows).
 * Bounded and user-triggered: healthy desks are never re-read and the
 * recovery never loops on its own (the pin: scrub -> return to LIVE ->
 * the reads recover without a project switch).
 */
export async function recoverOversightPlane(seams: OversightPlaneSeams): Promise<void> {
  for (const desk of sessionOwnDesksOf(seams.directory(), DEMO_PROJECT_ID)) {
    const existing = seams.bundles().find((bundle) => bundle.projectId === desk.id) ?? null;
    if (existing !== null && existing.utilization !== null && existing.submissions.length > 0) continue; // healthy — nothing to recover
    try {
      const bundle = await readDeskBundle(seams, desk);
      seams.dispatch({ kind: 'oversight-read', at: seams.nowMs(), read: bundle });
    } catch {
      // still degraded — the honest absence stays the truth on record; never a crash of the recovery
    }
  }
}

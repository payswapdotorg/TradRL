// @tradrl/web-console — the tenant context (L12 at the interface).
//
// THE LAW (Work Order T042): "Tenant/project scoping on every record
// (L12)" and "the console carries the tenant context on every read;
// a cross-tenant render is a typed error". The workspace is opened
// for exactly one tenant scope; every API read the loaders issue is
// scoped to it, and every record entering the workspace state passes
// `assertTenantScope` — a record from another tenant is the typed
// CrossTenantRenderError BEFORE it can reach a render path.
//
// Spec anchors: L12, SECURITY.md "Isolate data, projects,
// trajectories, memory, artifacts, credentials and usage".

import { CrossTenantRenderError } from './errors';
import type { ProjectRecord } from '../api/contracts';

/** The workspace's scope: one tenant, one project (the console is project-centric — R36). */
export interface WorkspaceScope {
  readonly tenantId: string;
  readonly projectId: string;
}

/**
 * THE LAUNCHPAD PROJECT ID (D-12, W-29 wave 2 — moved to the core scope
 * module so the render layer can gate the per-scope affordances without
 * importing the app layer): the workspace's pre-launch placeholder —
 * the shipped shell boots here ('' as the env project id) until the
 * primary flow's launch adopts a real project. Reads against it are a
 * category error (no project exists); app/console.ts's read cadence
 * skips it and every per-project affordance stays away.
 */
export const LAUNCHPAD_PROJECT_ID = '(launchpad)';

/**
 * FW-34-B (Round C register §3.8 — the shared-tenant wall): the shared
 * DEMO project's id (the workspace's teaching desk — the runtime's own
 * constant mirrored by name and value: deploy/vercel/runtime/demo.ts's
 * DEMO_PROJECT_ID, the same-name-same-shape law the console session
 * header rides). The default desk listing ALWAYS includes it (every
 * session's teaching desk), whatever the session-scope marker says.
 */
export const DEMO_PROJECT_ID = 'prj-demo-console';

/** True when a project id is the shared demo project (the workspace's teaching desk). */
export function isDemoProject(projectId: string): boolean {
  return projectId === DEMO_PROJECT_ID;
}

/**
 * FW-34-B (Round C register §3.8 — the shared-tenant wall, M1): true
 * when a directory row belongs to THIS session's own desks — the
 * host's additive 'session-owned' marker on GET /v1/projects
 * (deploy/vercel/runtime/session-routes.ts's CONSOLE_SESSION_SCOPE_FIELD).
 * The UNMARKED fallback is the listing's own honest law: a backing
 * that predates the marker (or a direct SDK read) serves none, and
 * every unmarked row reads as the session's own — the switcher and
 * the palette stay full, never silently empty.
 */
export function isSessionOwnDesk(project: ProjectRecord): boolean {
  return project.consoleSessionScope !== 'tenant-available';
}

/**
 * FW-34-B (§3.8): the session's own desks of a directory — the
 * session-owned rows, the UNMARKED rows (the honest fallback), and the
 * shared demo project (every session's teaching desk, whatever its
 * marker says). This is the DEFAULT listing law the switcher, the
 * palette and the boot-restore all ride; the whole registry stays one
 * explicit disclosure away (never lost — the FW-31-B durability win).
 *
 * FW-36-B (Round E register §3.2 — the session-desks membership arm):
 * the CLAIMED desks (this browser's posture record — the desks it
 * adopted through a switch, a palette jump or the recovery card) fold
 * in beside the host's own session-owned rows. A browser that
 * re-adopted its desk after a storage discard keeps it in its OWN
 * default listing, never behind the other-sessions wall: the host's
 * marker still says tenant-available (the owning session id is the
 * host's truth), and the client's own claim is the honest complement —
 * "the desks this browser chose". Absent claims (the default) keep
 * the listing law byte-identical.
 */
export function sessionOwnDesksOf(directory: readonly ProjectRecord[], demoProjectId: string, claimedDeskIds: readonly string[] = []): readonly ProjectRecord[] {
  if (claimedDeskIds.length === 0) {
    return directory.filter((project) => project.id === demoProjectId || isSessionOwnDesk(project));
  }
  return directory.filter((project) => project.id === demoProjectId || isSessionOwnDesk(project) || claimedDeskIds.includes(project.id));
}

/**
 * FW-34-B (§3.8): the desks the default listing hides — OTHER console
 * sessions' desks in this shared workspace (the explicit disclosure's
 * own count, never a silent wall). FW-36-B: a CLAIMED desk (this
 * browser's posture record) is NOT hidden — the claim IS the browser's
 * own listing law.
 */
export function otherSessionsDesksOf(directory: readonly ProjectRecord[], demoProjectId: string, claimedDeskIds: readonly string[] = []): readonly ProjectRecord[] {
  if (claimedDeskIds.length === 0) {
    return directory.filter((project) => project.id !== demoProjectId && !isSessionOwnDesk(project));
  }
  return directory.filter((project) => project.id !== demoProjectId && !isSessionOwnDesk(project) && !claimedDeskIds.includes(project.id));
}

/** True when a project id is the pre-launch launchpad placeholder (no project exists yet — the primary flow starts here). */
export function isLaunchpadScope(projectId: string): boolean {
  return projectId === LAUNCHPAD_PROJECT_ID;
}

/** Guard: a well-formed scope. */
export function isWorkspaceScope(v: unknown): v is WorkspaceScope {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as Record<string, unknown>;
  return typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0
    && typeof candidate.projectId === 'string' && candidate.projectId.length > 0;
}

/** The tenant field every API record carries (the mirrored records name it `tenantId` or `tenant`). */
export function tenantOfRecord(record: { readonly tenantId?: unknown; readonly tenant?: unknown }): string {
  if (typeof record.tenantId === 'string') return record.tenantId;
  if (typeof record.tenant === 'string') return record.tenant;
  return '';
}

/** The project field every project-scoped API record carries. */
export function projectOfRecord(record: { readonly projectId?: unknown; readonly project?: unknown; readonly lifecycle?: { readonly projectId?: unknown } }): string {
  if (typeof record.projectId === 'string') return record.projectId;
  if (typeof record.project === 'string') return record.project;
  if (typeof record.lifecycle === 'object' && record.lifecycle !== null && typeof record.lifecycle.projectId === 'string') return record.lifecycle.projectId;
  return '';
}

/**
 * THE TENANT GATE: assert that a record entering the workspace (or a
 * render path) belongs to the workspace's tenant scope. A violation
 * is the typed CrossTenantRenderError — cross-tenant data can never
 * render, not even once, not even degraded.
 */
export function assertTenantScope(scope: WorkspaceScope, record: { readonly tenantId?: unknown; readonly tenant?: unknown }): void {
  const tenant = tenantOfRecord(record);
  if (tenant !== scope.tenantId) {
    throw new CrossTenantRenderError(
      `a record of tenant ${JSON.stringify(tenant)} entered the workspace of tenant ${JSON.stringify(scope.tenantId)} — cross-tenant renders are a typed error (L12)`,
      scope.tenantId,
      tenant,
    );
  }
}

/**
 * The full scope gate (tenant + project): project-scoped records
 * must additionally match the workspace's project. A foreign
 * project's record is as much a cross-tenant render as a foreign
 * tenant's.
 */
export function assertProjectScope(scope: WorkspaceScope, record: { readonly tenantId?: unknown; readonly tenant?: unknown; readonly projectId?: unknown; readonly project?: unknown; readonly lifecycle?: { readonly projectId?: unknown } }): void {
  assertTenantScope(scope, record);
  const project = projectOfRecord(record);
  if (project !== '' && project !== scope.projectId) {
    throw new CrossTenantRenderError(
      `a record of project ${JSON.stringify(project)} entered the workspace of project ${JSON.stringify(scope.projectId)} (tenant ${JSON.stringify(scope.tenantId)}) — cross-scope renders are a typed error (L12)`,
      scope.tenantId,
      tenantOfRecord(record),
    );
  }
}

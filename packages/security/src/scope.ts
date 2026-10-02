// @tradrl/security — the tenancy scope primitives (the L12 substrate).
//
// THE LAW (spec/ARCHITECTURE-LOCK.md L12 — VERBATIM: "Tenant isolation:
// customer data, memory, trajectories and credentials are isolated.";
// spec/SECURITY.md Tenant isolation — VERBATIM: "Isolate data, projects,
// trajectories, memory, artifacts, credentials and usage. Do not reuse
// customer data for another tenant by default."; PROJECT-STATE invariant 8:
// "Tenant data is isolated.") — enforced HERE, in code (L20):
//
//   1. EVERY record this package (and the enforcement service) shapes
//      carries its tenant+project scope — the {@link ScopedRecord}
//      wrapper. A record without a scope is inexpressible at the type
//      level and rejected by the guards.
//   2. Cross-tenant access is a TYPED ERROR ({@link crossTenantAccess}),
//      never a filter and never a silent empty result: a scope asking for
//      another tenant's record receives `cross_tenant_access`, so the
//      violation is observable, auditable and testable.
//   3. Scope comparison is PURE and TOTAL: two scopes are the same scope
//      iff both components match exactly. There is no wildcard, no "all
//      tenants", no scope hierarchy — isolation has no escape hatch in
//      this substrate.
//
// Zero runtime dependencies; pure data and pure functions. No ambient
// clock. All records deeply frozen.

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import type { ProjectId, TenantId } from './ids';
import { isProjectId, isTenantId } from './ids';
import { errorOf, type SecurityError } from './errors';

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

/**
 * The tenant+project scope EVERY record carries (L12/L15). Structural
 * mirror of T040's grant/audit scope fields (`tenant` + `project`) so a
 * REAL T040 AuthorityGrantRecord's scope IS a Scope here (the interop trip
 * wire proves it).
 */
export interface Scope {
  /** The tenant scope — the isolation root (L12). */
  readonly tenant: TenantId;
  /** The project continuity root (L15). */
  readonly project: ProjectId;
}

/** Guard: `Scope`. */
export function isScope(v: unknown): v is Scope {
  if (!isRecord(v)) return false;
  return isTenantId(v.tenant) && isProjectId(v.project);
}

/** Validate an untrusted scope: both components required, non-empty. */
export function validateScope(v: unknown, path = 'scope'): { readonly ok: true; readonly value: Scope } | { readonly ok: false; readonly errors: readonly SecurityError[] } {
  if (!isRecord(v)) {
    return { ok: false, errors: [errorOf('invalid_type', `${path} must be an object with tenant and project`, path)] };
  }
  const errors: SecurityError[] = [];
  if (v.tenant === undefined) {
    errors.push(errorOf('missing_field', `${path}.tenant is required (L12)`, `${path}.tenant`));
  } else if (!isTenantId(v.tenant)) {
    errors.push(errorOf('invalid_field', `${path}.tenant must be a non-empty tenant scope (L12)`, `${path}.tenant`));
  }
  if (v.project === undefined) {
    errors.push(errorOf('missing_field', `${path}.project is required (L12/L15)`, `${path}.project`));
  } else if (!isProjectId(v.project)) {
    errors.push(errorOf('invalid_field', `${path}.project must be a non-empty project scope (L12/L15)`, `${path}.project`));
  }
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };
  return { ok: true, value: deepFreeze({ tenant: v.tenant as TenantId, project: v.project as ProjectId }) };
}

// ---------------------------------------------------------------------------
// The scoped-record wrapper
// ---------------------------------------------------------------------------

/**
 * The base every T044 record extends: the payload plus its scope. Every
 * record carries its tenant+project scope — a record without a scope is
 * inexpressible in this substrate.
 */
export interface ScopedRecord {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: a record carries a structurally valid scope (the payload is the caller's concern). */
export function isScopedRecord(v: unknown): v is ScopedRecord {
  return isScope(v);
}

/** The scope OF a scoped record (the projection onto `Scope`). */
export function scopeOf(record: ScopedRecord): Scope {
  return deepFreeze({ tenant: record.tenant, project: record.project });
}

/** The deterministic scope key: `tenant/project` (registry index form; stable across processes). */
export function scopeKey(scope: Scope): string {
  return `${scope.tenant}/${scope.project}`;
}

/**
 * `true` iff both components match exactly. PURE and TOTAL; there is no
 * wildcard scope and no hierarchy — isolation has no escape hatch.
 */
export function sameScope(a: Scope, b: Scope): boolean {
  return a.tenant === b.tenant && a.project === b.project;
}

// ---------------------------------------------------------------------------
// The typed cross-tenant error (L12 — the named error of the charter)
// ---------------------------------------------------------------------------

/**
 * Construct the typed `cross_tenant_access` error: a scope attempted to
 * reach a record outside its isolation boundary. The message names the
 * ACTING scope and the record's OWN scope (ids only — never payload data:
 * the violation is observable without disclosing the protected content).
 */
export function crossTenantAccess(action: string, actor: Scope, record: Scope, path?: string): SecurityError {
  return errorOf(
    'cross_tenant_access',
    `${action} by ${actor.tenant}/${actor.project} targets a record of ${record.tenant}/${record.project} — tenant data, memory, trajectories, artifacts, credentials and usage are isolated (L12); cross-tenant access is refused`,
    path,
  );
}

/**
 * The scope-enforcement predicate every registry read runs: `ok` iff the
 * record's scope IS the requesting scope; otherwise the typed
 * `cross_tenant_access` error (never a filter — the caller must fail
 * loudly, not silently drop the record).
 */
export function requireSameScope(action: string, actor: Scope, record: ScopedRecord): { readonly ok: true; readonly value: Scope } | { readonly ok: false; readonly errors: readonly [SecurityError] } {
  const recordScope = scopeOf(record);
  if (!sameScope(actor, recordScope)) {
    return { ok: false, errors: [crossTenantAccess(action, actor, recordScope)] };
  }
  return { ok: true, value: recordScope };
}

/** `true` iff a non-empty payload id is present (registry record ids are opaque non-empty strings). */
export function isRecordId(v: unknown): v is string {
  return isNonEmptyString(v);
}

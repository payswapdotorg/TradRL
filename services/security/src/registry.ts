/**
 * @tradrl/security-service — the tenant isolation registry (the L12
 * enforcement plane).
 *
 * THE LAW (spec/SECURITY.md Tenant isolation — VERBATIM: "Isolate data,
 * projects, trajectories, memory, artifacts, credentials and usage. Do
 * not reuse customer data for another tenant by default.";
 * spec/ARCHITECTURE-LOCK.md L12; PROJECT-STATE invariant 8).
 *
 * THE MODEL: one registry hosts many tenants; every surface is a
 * per-scope, append-only record list. Enforcement rules, ALL in code:
 *
 *   1. REGISTRATION FIRST: writes into an unregistered scope are the
 *      typed `tenant_missing` error.
 *   2. THE TYPED ERROR, NOT A FILTER: `getScopedRecord` with a foreign
 *      scope returns the typed `cross_tenant_access` error naming both
 *      scopes — never a silent miss, never a filtered list.
 *   3. LISTING IS SCOPE-PURE: `listScopedRecords` returns ONLY the
 *      requesting scope's records — other tenants' records are not
 *      merely hidden, they are not in the index the query walks.
 *   4. APPEND-ONLY: there is no removal or update API anywhere in this
 *      module; records are facts.
 *   5. THE OPACITY WIRE: every record put is trip-wired — a payload
 *      carrying credential MATERIAL is the typed
 *      `credential_value_present` error (values live ONLY behind the
 *      secrets boundary).
 *
 * The registry snapshot (`registrySnapshot`) is a JSON-serializable,
 * deep-frozen view — the integration tests byte-scan it for planted
 * secrets and other tenants' payloads.
 *
 * Determinism: insertion order everywhere; content-addressed
 * registration ids; injected instants only (no ambient clock). The
 * registry consumes @tradrl/security via RELATIVE SOURCE IMPORTS (the
 * execution-gateway precedent — the frozen lockfile forbids a workspace
 * edge).
 */

import {
  canonicalJson,
  credentialValueViolations,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  mintTenantRegistrationId,
  type JsonValue,
  type ProjectId,
  type Scope,
  type ScopedRecord,
  type TenantId,
  type TimestampMs,
} from '../../../packages/security/src/index';

// ---------------------------------------------------------------------------
// The surfaces (SECURITY.md's isolation list, closed)
// ---------------------------------------------------------------------------

/**
 * The tenant-isolated surfaces — exactly the seven SECURITY.md names:
 * data, projects, trajectories, memory, artifacts, credentials, usage.
 */
export type IsolationSurface = 'data' | 'projects' | 'trajectories' | 'memory' | 'artifacts' | 'credentials' | 'usage';

/** Runtime-checkable list of isolation surfaces. */
export const ISOLATION_SURFACES: readonly IsolationSurface[] = [
  'data',
  'projects',
  'trajectories',
  'memory',
  'artifacts',
  'credentials',
  'usage',
] as const;

/** `true` iff the value is on the closed surface list. */
export function isIsolationSurface(v: unknown): v is IsolationSurface {
  return isNonEmptyString(v) && (ISOLATION_SURFACES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The registry record and the registry
// ---------------------------------------------------------------------------

/** One tenant-scoped record on one surface: the id, the opaque payload, the instant. */
export interface ScopedRegistryRecord extends ScopedRecord {
  /** The record's opaque id (unique per scope+surface; non-empty). */
  readonly record_id: string;
  /** The surface the record lives on. */
  readonly surface: IsolationSurface;
  /** The opaque, JSON-safe payload (trip-wired: NO credential material). */
  readonly payload: JsonValue;
  /** The write instant (epoch ms; injected). */
  readonly asOf: TimestampMs;
}

/** One registered project under a registered tenant. */
export interface RegisteredProject {
  readonly project: ProjectId;
  readonly registeredAt: TimestampMs;
}

/** One registered tenant. */
export interface RegisteredTenant {
  readonly tenant: TenantId;
  readonly registrationId: string;
  readonly registeredAt: TimestampMs;
  readonly projects: readonly RegisteredProject[];
}

/** The registry's JSON-serializable snapshot (the safe-to-ship view). */
export interface TenantIsolationRegistrySnapshot {
  readonly kind: 'tradrl/tenant-isolation-registry/v1';
  readonly tenants: readonly RegisteredTenant[];
  readonly records: readonly ScopedRegistryRecord[];
}

/**
 * The tenant isolation registry. An opaque value; ALL state lives in a
 * module-private WeakMap so a stray `JSON.stringify(registry)` can never
 * walk it (the snapshot is the ONLY sanctioned serialization — and it is
 * built field-by-field from validated data).
 */
export interface TenantIsolationRegistry {
  readonly kind: 'tradrl/tenant-isolation-registry/v1';
}

interface RegistryState {
  readonly tenants: Map<string, RegisteredTenant>;
  readonly projectIndex: Set<string>;
  /** scopeKey -> surface -> records (insertion order). */
  readonly byScope: Map<string, Map<IsolationSurface, ScopedRegistryRecord[]>>;
  /** (scopeKey, surface, record_id) -> record. */
  readonly byId: Map<string, ScopedRegistryRecord>;
}

const REGISTRY_STATES = new WeakMap<TenantIsolationRegistry, RegistryState>();

// ---------------------------------------------------------------------------
// Construction and registration
// ---------------------------------------------------------------------------

/** Create an empty tenant isolation registry. */
export function createTenantIsolationRegistry(): TenantIsolationRegistry {
  const registry: TenantIsolationRegistry = { kind: 'tradrl/tenant-isolation-registry/v1' };
  REGISTRY_STATES.set(registry, {
    tenants: new Map(),
    projectIndex: new Set(),
    byScope: new Map(),
    byId: new Map(),
  });
  return Object.freeze(registry);
}

function stateOf(registry: TenantIsolationRegistry): RegistryState {
  const state = REGISTRY_STATES.get(registry);
  if (state === undefined) throw new Error('tenant isolation registry: unknown registry instance (create one with createTenantIsolationRegistry)');
  return state;
}

/** Register a tenant. Re-registration is the typed `tenant_already_registered` (idempotence guard). */
export function registerTenant(
  registry: TenantIsolationRegistry,
  tenant: TenantId,
  at: TimestampMs,
): { readonly ok: true; readonly value: RegisteredTenant } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(registry);
  if (!isNonEmptyString(tenant)) return { ok: false, errors: [{ code: 'invalid_field', message: 'tenant must be a non-empty tenant scope (L12)' }] };
  if (!isTimestampMs(at)) return { ok: false, errors: [{ code: 'invalid_field', message: 'at must be an epoch-ms instant (no ambient clock)' }] };
  if (state.tenants.has(tenant)) {
    return { ok: false, errors: [{ code: 'tenant_already_registered', message: `tenant ${tenant} is already registered — registries are append-only` }] };
  }
  const registered: RegisteredTenant = deepFreeze({
    tenant,
    registrationId: mintTenantRegistrationId(fnv1a32Hex(canonicalJson({ tenant, at, records: 0 }))),
    registeredAt: at,
    projects: [],
  });
  state.tenants.set(tenant, registered);
  return { ok: true, value: registered };
}

/** Register a project under a registered tenant. The tenant must exist first (`tenant_missing` otherwise). */
export function registerProject(
  registry: TenantIsolationRegistry,
  scope: Scope,
  at: TimestampMs,
): { readonly ok: true; readonly value: RegisteredTenant } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(registry);
  if (!isRecord(scope) || !isNonEmptyString(scope.tenant) || !isNonEmptyString(scope.project)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'scope must be { tenant, project } (L12)' }] };
  }
  const existing = state.tenants.get(scope.tenant);
  if (existing === undefined) {
    return { ok: false, errors: [{ code: 'tenant_missing', message: `tenant ${scope.tenant} is not registered — register the tenant before its projects (L12)` }] };
  }
  const key = `${scope.tenant}/${scope.project}`;
  if (state.projectIndex.has(key)) {
    return { ok: false, errors: [{ code: 'tenant_already_registered', message: `project ${key} is already registered — registries are append-only` }] };
  }
  const updated: RegisteredTenant = deepFreeze({
    ...existing,
    projects: [...existing.projects, deepFreeze({ project: scope.project, registeredAt: at })],
  });
  state.tenants.set(scope.tenant, updated);
  state.projectIndex.add(key);
  state.byScope.set(key, new Map());
  return { ok: true, value: updated };
}

// ---------------------------------------------------------------------------
// Writes (registration-first, trip-wired, append-only)
// ---------------------------------------------------------------------------

/**
 * Append one scoped record to a surface. Laws: the scope must be
 * registered (`tenant_missing`); the surface must be on the closed list;
 * the payload must be trip-wire-clean (`credential_value_present` — a
 * committed/serialized secret is a typed error); the record id must be
 * unique per scope+surface. There is NO removal or update.
 */
export function putScopedRecord(
  registry: TenantIsolationRegistry,
  surface: IsolationSurface,
  record: { readonly tenant: TenantId; readonly project: ProjectId; readonly record_id: string; readonly payload: JsonValue; readonly asOf: TimestampMs },
): { readonly ok: true; readonly value: ScopedRegistryRecord } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] } {
  const state = stateOf(registry);
  if (!isIsolationSurface(surface)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `surface must be one of ${ISOLATION_SURFACES.join(' | ')}` }] };
  }
  // THE OPACITY WIRE (the write gate): a committed/serialized secret is a
  // typed error — this is the boundary SECURITY.md mandates.
  const violations = credentialValueViolations(record);
  if (violations.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'credential_value_present',
          message: `the record embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — a committed/serialized secret is a typed error; values live only behind the secrets injection boundary (spec/SECURITY.md: "Never commit provider credentials. Inject them through secure runtime boundaries.")`,
        },
      ],
    };
  }
  if (!isNonEmptyString(record.tenant) || !isNonEmptyString(record.project)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'the record must carry its tenant+project scope (L12)' }] };
  }
  const key = `${record.tenant}/${record.project}`;
  if (!state.projectIndex.has(key)) {
    return { ok: false, errors: [{ code: 'tenant_missing', message: `scope ${key} is not registered — registration precedes writes (L12)` }] };
  }
  if (!isNonEmptyString(record.record_id)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'record_id must be a non-empty opaque id' }] };
  }
  if (!isTimestampMs(record.asOf)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'asOf must be an epoch-ms instant (no ambient clock)' }] };
  }
  const idKey = `${key}|${surface}|${record.record_id}`;
  if (state.byId.has(idKey)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `record ${record.record_id} already exists on ${surface} for ${key} — the registry is append-only` }] };
  }
  const stored: ScopedRegistryRecord = deepFreeze({
    tenant: record.tenant,
    project: record.project,
    record_id: record.record_id,
    surface,
    payload: record.payload,
    asOf: record.asOf,
  });
  let surfaces = state.byScope.get(key);
  if (surfaces === undefined) {
    surfaces = new Map();
    state.byScope.set(key, surfaces);
  }
  let list = surfaces.get(surface);
  if (list === undefined) {
    list = [];
    surfaces.set(surface, list);
  }
  list.push(stored);
  state.byId.set(idKey, stored);
  return { ok: true, value: stored };
}

// ---------------------------------------------------------------------------
// Reads (the typed cross-tenant error; scope-pure listing)
// ---------------------------------------------------------------------------

/**
 * Get one record by id from a surface, AS a scope. THE LAW: if the record
 * exists but belongs to ANOTHER tenant, the typed `cross_tenant_access`
 * error naming both scopes — cross-tenant access is observable, never a
 * silent miss. Unknown records are `unknown_record`.
 */
export function getScopedRecord(
  registry: TenantIsolationRegistry,
  surface: IsolationSurface,
  scope: Scope,
  recordId: string,
): { readonly ok: true; readonly value: ScopedRegistryRecord } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(registry);
  if (!isIsolationSurface(surface)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `surface must be one of ${ISOLATION_SURFACES.join(' | ')}` }] };
  }
  // FIRST: the requesting scope's OWN index (record ids are unique per
  // scope+surface — a same-id record of another tenant is not ours).
  const own = state.byScope.get(`${scope.tenant}/${scope.project}`)?.get(surface) ?? [];
  const ownHit = own.find((record) => record.record_id === recordId);
  if (ownHit !== undefined) return { ok: true, value: ownHit };
  // SECOND: the cross-tenant probe — if the record exists under ANOTHER
  // scope, the typed `cross_tenant_access` error naming both scopes
  // (cross-tenant access is observable, never a silent miss).
  for (const [key, surfaces] of state.byScope.entries()) {
    if (key === `${scope.tenant}/${scope.project}`) continue;
    const foreign = surfaces.get(surface)?.find((record) => record.record_id === recordId);
    if (foreign !== undefined) {
      return {
        ok: false,
        errors: [
          {
            code: 'cross_tenant_access',
            message: `get ${surface}/${recordId} by ${scope.tenant}/${scope.project} targets a record of ${foreign.tenant}/${foreign.project} — tenant data, memory, trajectories, artifacts, credentials and usage are isolated (L12); cross-tenant access is refused`,
          },
        ],
      };
    }
  }
  return { ok: false, errors: [{ code: 'unknown_record', message: `record ${recordId} is unknown on surface ${surface}` }] };
}

/**
 * List a surface's records FOR a scope — ONLY that scope's records (the
 * query walks the scope's own index; other tenants' records are not
 * hidden, they are structurally absent). Insertion order.
 */
export function listScopedRecords(
  registry: TenantIsolationRegistry,
  surface: IsolationSurface,
  scope: Scope,
): readonly ScopedRegistryRecord[] {
  const state = stateOf(registry);
  const surfaces = state.byScope.get(`${scope.tenant}/${scope.project}`);
  if (surfaces === undefined) return [];
  return Object.freeze([...(surfaces.get(surface) ?? [])]);
}

/** The registered tenants (insertion order; the snapshot-safe view). */
export function registeredTenants(registry: TenantIsolationRegistry): readonly RegisteredTenant[] {
  return Object.freeze([...stateOf(registry).tenants.values()]);
}

/** `true` iff the tenant is registered. */
export function isTenantRegistered(registry: TenantIsolationRegistry, tenant: TenantId): boolean {
  return stateOf(registry).tenants.has(tenant);
}

/** `true` iff the scope (tenant+project) is registered. */
export function isScopeRegistered(registry: TenantIsolationRegistry, scope: Scope): boolean {
  return stateOf(registry).projectIndex.has(`${scope.tenant}/${scope.project}`);
}

/**
 * The registry's JSON-serializable snapshot — built field-by-field from
 * validated data (the ONLY sanctioned serialization). Deeply frozen.
 */
export function registrySnapshot(registry: TenantIsolationRegistry): TenantIsolationRegistrySnapshot {
  const state = stateOf(registry);
  const records: ScopedRegistryRecord[] = [];
  for (const surfaces of state.byScope.values()) {
    for (const surface of ISOLATION_SURFACES) {
      const list = surfaces.get(surface);
      if (list !== undefined) records.push(...list);
    }
  }
  return deepFreeze({
    kind: 'tradrl/tenant-isolation-registry/v1',
    tenants: [...state.tenants.values()],
    records,
  });
}

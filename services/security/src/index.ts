/**
 * @tradrl/security-service — the security ENFORCEMENT service (Work
 * Order T044): the L12/L20 plane where the @tradrl/security contracts
 * are enforced.
 *
 * Spec anchors — spec/SECURITY.md (the T044 charter): trust zones,
 * untrusted workloads, secrets, tenant isolation, LLM security, audit;
 * spec/ARCHITECTURE-LOCK.md L12, L20; spec/REQUIREMENTS.md R25
 * (tenant-isolated Firm Brain substrate), R42 (export/import without
 * customer leakage); PROJECT-STATE invariant 8.
 *
 * Public API:
 *   - `TenantIsolationRegistry` — the seven tenant-isolated surfaces
 *     (data, projects, trajectories, memory, artifacts, credentials,
 *     usage): registration-first writes, scope-pure listing, and the
 *     typed `cross_tenant_access` error on foreign reads (L12 — never a
 *     filter). Append-only; every write trip-wired (a committed/
 *     serialized secret is the typed `credential_value_present`).
 *   - `SecretsVault` — the secrets injection boundary: values enter ONLY
 *     via `depositSecretValue` (fingerprint-verified) and leave ONLY via
 *     `resolveCredential` (the owning scope, the latest active version);
 *     state lives in module-private WeakMaps unreachable from any JSON
 *     walk. Rotation keeps the envelope id stable; revocation is an
 *     append-only tombstone.
 *   - `admitEpisode` — the untrusted workload isolation policy: a T005
 *     episode is admissible ONLY under a valid, scope-matching
 *     isolation descriptor (`isolation_violation` otherwise).
 *   - `UsageLedger` — the usage-accounting hooks (scoped events,
 *     content-addressed ids, per-scope counters, typed hooks).
 *   - `exportTenantScope` / `validateExportBundle` — the R42 exporter:
 *     bundles carry ONLY the exporting scope's records and value-free
 *     envelopes; a foreign record inside a bundle is the typed
 *     `export_scope_violation`.
 *   - `SecurityServiceContext` — the composition root: every
 *     security-consequential act is enforced, usage-accounted and
 *     audited into the acting scope's chain-verified
 *     `SecurityAuditTrail` (denials included).
 *
 * The service consumes @tradrl/security via RELATIVE SOURCE IMPORTS
 * (the execution-gateway precedent — the frozen lockfile forbids a
 * workspace edge). Zero runtime dependencies. No ambient clock. The
 * T005/T019/T040 shapes the service reasons about are the package's
 * STRUCTURAL MIRRORS (D-003/D-004); the interop trip wires live in
 * tests/security/.
 */

// The tenant isolation registry (L12 — the seven surfaces)
export type { IsolationSurface, ScopedRegistryRecord, RegisteredProject, RegisteredTenant, TenantIsolationRegistry, TenantIsolationRegistrySnapshot } from './registry';
export {
  ISOLATION_SURFACES,
  isIsolationSurface,
  createTenantIsolationRegistry,
  registerTenant,
  registerProject,
  putScopedRecord,
  getScopedRecord,
  listScopedRecords,
  registeredTenants,
  isTenantRegistered,
  isScopeRegistered,
  registrySnapshot,
} from './registry';

// The secrets injection boundary
export type { SecretsVault, CredentialResolution, CredentialResolutionRefusal } from './secrets';
export {
  createSecretsVault,
  registerCredentialEnvelope,
  adoptCredentialEnvelope,
  depositSecretValue,
  resolveCredential,
  rotateSecret,
  revokeCredential,
  vaultEnvelopes,
  vaultEnvelopeChain,
  isDeposited,
} from './secrets';

// The untrusted workload isolation policy (T005 episode admission)
export type { EpisodeAdmission, EpisodeAdmissionRefusal } from './isolation-policy';
export { admitEpisode, runtimeMaySeeEnvelopeRefs, runtimeEgressAllowed } from './isolation-policy';

// The usage-accounting hooks
export type { UsageKind, UsageEvent, ScopeUsage, UsageHook, UsageLedger } from './usage';
export { USAGE_KINDS, isUsageKind, createUsageLedger, onUsage, recordUsage, usageFor, usageEventsFor } from './usage';

// The R42 exporter
export type { ExportSurfaceRecords, TenantExportBundle } from './exporter';
export { exportTenantScope, validateExportBundle, exportContentTree } from './exporter';

// The composition root
export type { SecurityServiceContext } from './context';
export {
  createSecurityContext,
  contextRegisterTenant,
  contextRegisterProject,
  contextPutRecord,
  contextGetRecord,
  contextListRecords,
  contextRegisterEnvelope,
  contextDepositSecret,
  contextResolveCredential,
  contextRotateSecret,
  contextRevokeCredential,
  contextAdmitEpisode,
  contextExportScope,
  contextAuditTrail,
  contextVerifyAllTrails,
  contextRegistrySnapshot,
  contextEnvelopes,
  contextUsage,
  contextOnUsage,
  contextSnapshot,
  contextIsTenantRegistered,
} from './context';

/** Service identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/security-service',
  owner: 'T044',
  status: 'implemented',
  concepts: [
    'TenantIsolationRegistry',
    'cross_tenant_access (typed error)',
    'SecretsVault',
    'credential injection boundary',
    'admitEpisode (isolation descriptor required)',
    'UsageLedger',
    'exportTenantScope (R42)',
    'SecurityServiceContext',
  ],
} as const;

/**
 * @tradrl/security-service — the R42 tenant-scope exporter.
 *
 * THE LAW (spec/REQUIREMENTS.md R42: export/import without customer
 * leakage; spec/SECURITY.md Tenant isolation: "Do not reuse customer
 * data for another tenant by default."; the T044 Work Order: "export
 * excludes other-tenant data (R42)").
 *
 * THE MODEL: `exportTenantScope` builds a content-addressed
 * {@link TenantExportBundle} for ONE scope from the registry, the vault
 * and the usage ledger. The bundle carries:
 *
 *   - the scope's records from EVERY isolation surface (only the
 *     scope's own index is walked — other tenants' records are
 *     structurally absent, then PROVEN absent by validation);
 *   - the scope's credential ENVELOPES (value-free by construction;
 *     secret material never crosses the export boundary — the opacity
 *     trip wire runs over the whole bundle);
 *   - the scope's usage accounting.
 *
 * `validateExportBundle` re-proves the bundle after the fact: every
 * record carries the exporting scope (a foreign record inside a bundle
 * is the typed `export_scope_violation`), and no credential material is
 * present (`credential_value_present`). Determinism: identical inputs
 * produce byte-identical bundles (content-addressed bundle ids).
 */

import {
  canonicalJson,
  credentialValueViolations,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isTimestampMs,
  mintExportBundleId,
  type CredentialEnvelope,
  type ExportBundleId,
  type Scope,
  type TimestampMs,
} from '../../../packages/security/src/index';
import {
  ISOLATION_SURFACES,
  listScopedRecords,
  isScopeRegistered,
  type IsolationSurface,
  type ScopedRegistryRecord,
  type TenantIsolationRegistry,
} from './registry';
import { vaultEnvelopes, type SecretsVault } from './secrets';
import { usageFor, type ScopeUsage, type UsageLedger } from './usage';

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/** The bundle's records block: one surface at a time, insertion order. */
export interface ExportSurfaceRecords {
  readonly surface: IsolationSurface;
  readonly records: readonly ScopedRegistryRecord[];
}

/** The tenant export bundle — the R42 artifact (scope-pure, secret-free). */
export interface TenantExportBundle {
  /** Content-addressed identity: `xexp:` + digest of the canonical content. */
  readonly bundleId: ExportBundleId;
  readonly tenant: Scope['tenant'];
  readonly project: Scope['project'];
  readonly exportedAt: TimestampMs;
  readonly records: readonly ExportSurfaceRecords[];
  /** The scope's credential envelopes (value-free; secrets never cross the export boundary). */
  readonly credentialEnvelopes: readonly CredentialEnvelope[];
  /** The scope's usage accounting. */
  readonly usage: ScopeUsage;
}

/** The canonical JSON tree of a bundle's CONTENT (everything except `bundleId`). */
export function exportContentTree(bundle: Omit<TenantExportBundle, 'bundleId'>): unknown {
  return {
    tenant: bundle.tenant,
    project: bundle.project,
    exportedAt: bundle.exportedAt,
    records: bundle.records.map((surface) => ({
      surface: surface.surface,
      records: surface.records.map((record) => ({
        record_id: record.record_id,
        surface: record.surface,
        payload: record.payload,
        asOf: record.asOf,
        tenant: record.tenant,
        project: record.project,
      })),
    })),
    credentialEnvelopes: bundle.credentialEnvelopes.map((envelope) => JSON.parse(canonicalEnvelope(envelope))),
    usage: { ...bundle.usage },
  };
}

function canonicalEnvelope(envelope: CredentialEnvelope): string {
  return JSON.stringify({
    envelopeId: envelope.envelopeId,
    version: envelope.version,
    supersedes: envelope.supersedes,
    tenant: envelope.tenant,
    project: envelope.project,
    venue: envelope.venue,
    kind: envelope.kind,
    fingerprint: envelope.fingerprint,
    status: envelope.status,
    asOf: envelope.asOf,
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export ONE tenant/project scope — the R42 artifact. Only the scope's
 * own records are walked (structural exclusion), the envelopes are
 * value-free by construction, and the bundle is content-addressed.
 * An unregistered scope is the typed `tenant_missing` error.
 */
export function exportTenantScope(
  registry: TenantIsolationRegistry,
  vault: SecretsVault,
  ledger: UsageLedger,
  scope: Scope,
  at: TimestampMs,
): { readonly ok: true; readonly value: TenantExportBundle } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  if (!isNonEmptyString(scope?.tenant) || !isNonEmptyString(scope?.project)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'exportTenantScope requires a { tenant, project } scope (L12)' }] };
  }
  if (!isTimestampMs(at)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'at must be an epoch-ms instant (no ambient clock)' }] };
  }
  if (!isScopeRegistered(registry, scope)) {
    return { ok: false, errors: [{ code: 'tenant_missing', message: `scope ${scope.tenant}/${scope.project} is not registered — exports are for registered scopes only (L12)` }] };
  }
  const records: ExportSurfaceRecords[] = ISOLATION_SURFACES.map((surface) => ({
    surface,
    records: listScopedRecords(registry, surface, scope),
  }));
  const envelopes = vaultEnvelopes(vault).filter((envelope) => envelope.tenant === scope.tenant && envelope.project === scope.project);
  const usage = usageFor(ledger, scope);
  if (!usage.ok) {
    return { ok: false, errors: usage.errors };
  }
  const content: Omit<TenantExportBundle, 'bundleId'> = {
    tenant: scope.tenant,
    project: scope.project,
    exportedAt: at,
    records,
    credentialEnvelopes: envelopes,
    usage: usage.value,
  };
  const bundleId = mintExportBundleId(fnv1a32Hex(canonicalJson(exportContentTree(content) as never)));
  const bundle: TenantExportBundle = deepFreeze({ ...content, bundleId });
  // Belt and braces: the freshly built bundle must satisfy its own laws.
  const validated = validateExportBundle(bundle, scope);
  if (!validated.ok) return validated;
  return { ok: true, value: bundle };
}

// ---------------------------------------------------------------------------
// Validation (the R42 proof)
// ---------------------------------------------------------------------------

/**
 * Prove a bundle is lawful: (1) every record carries the exporting scope
 * — a foreign record is the typed `export_scope_violation` (R42: export
 * without customer leakage); (2) NO credential material anywhere (the
 * opacity trip wire — `credential_value_present`); (3) the bundle id is
 * content-addressed over the canonical content.
 */
export function validateExportBundle(
  bundle: TenantExportBundle,
  expectedScope: Scope,
): { readonly ok: true; readonly value: TenantExportBundle } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] } {
  // THE OPACITY WIRE — first, always.
  const violations = credentialValueViolations(bundle);
  if (violations.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'credential_value_present',
          message: `the export bundle embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — secrets never cross the export boundary (spec/SECURITY.md: "Never commit provider credentials.")`,
        },
      ],
    };
  }
  if (bundle.tenant !== expectedScope.tenant || bundle.project !== expectedScope.project) {
    return {
      ok: false,
      errors: [{ code: 'export_scope_violation', message: `the bundle claims scope ${bundle.tenant}/${bundle.project} but was validated for ${expectedScope.tenant}/${expectedScope.project}` }],
    };
  }
  // R42 — every record in the bundle MUST carry the exporting scope.
  for (const surfaceBlock of bundle.records) {
    for (const record of surfaceBlock.records) {
      if (record.tenant !== bundle.tenant || record.project !== bundle.project) {
        return {
          ok: false,
          errors: [
            {
              code: 'export_scope_violation',
              message: `export bundle for ${bundle.tenant}/${bundle.project} contains a record of ${record.tenant}/${record.project} (${surfaceBlock.surface}/${record.record_id}) — exports exclude other-tenant data (R42)`,
              path: `${surfaceBlock.surface}/${record.record_id}`,
            },
          ],
        };
      }
    }
  }
  for (const envelope of bundle.credentialEnvelopes) {
    if (envelope.tenant !== bundle.tenant || envelope.project !== bundle.project) {
      return {
        ok: false,
        errors: [{ code: 'export_scope_violation', message: `export bundle for ${bundle.tenant}/${bundle.project} contains a credential envelope of ${envelope.tenant}/${envelope.project} — exports exclude other-tenant data (R42)` }],
      };
    }
  }
  if (bundle.usage.tenant !== bundle.tenant || bundle.usage.project !== bundle.project) {
    return {
      ok: false,
      errors: [{ code: 'export_scope_violation', message: 'the usage accounting in the bundle belongs to another scope (R42)' }],
    };
  }
  // The content-address law.
  const expectedId = mintExportBundleId(fnv1a32Hex(canonicalJson(exportContentTree(bundle) as never)));
  if (bundle.bundleId !== expectedId) {
    return {
      ok: false,
      errors: [{ code: 'invalid_field', message: `the bundle id does not match its content (expected ${expectedId}) — the id is content-addressed, a mismatch is a forged bundle`, path: 'bundleId' }],
    };
  }
  return { ok: true, value: deepFreeze(bundle) };
}

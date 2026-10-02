// @tradrl/security — the workload isolation contracts.
//
// THE LAW (spec/SECURITY.md Untrusted workloads — VERBATIM: "User-
// provided executable or research workloads are untrusted and require
// isolation."; spec/SECURITY.md Trust zones: "... agent runtime ->
// isolated research/environment workers ..."; the T044 Work Order:
// "untrusted workload isolation policy (T005 episode admission requires
// an isolation descriptor)").
//
// THE MODEL: an untrusted research workload (a T005 episode — the
// isolated workload unit) is admissible ONLY when it carries a
// {@link WorkloadIsolationDescriptor} declaring its sandbox: network
// egress, filesystem access, credential access and resource bounds.
// The {@link EpisodeAdmissionRecord} binds the descriptor to the
// episode's derived id (T005's `ep-` identity, mirrored in
// spec-mirror.ts) — the durable, scope-carrying proof that THIS workload
// runs under THIS descriptor.
//
// DEFAULT-DENY: `egress: 'none'` requires an EMPTY network allowlist (a
// descriptor declaring no egress but listing hosts is inexpressible);
// `credentialAccess: 'none'` is the floor (a workload may see envelope
// REFERENCES at most, never values — the secrets boundary owns values).
//
// Determinism: the descriptor id is content-addressed (`iso:` + digest);
// the admission id is content-addressed (`eadm:` + digest). Identical
// declarations produce byte-identical records. No ambient clock (`asOf`
// injected). The opacity trip wire runs over every guard and validator.

import { deepFreeze, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, canonicalJson, fnv1a32Hex, type JsonValue, type TimestampMs } from './primitives';
import type { EpisodeAdmissionId, IsolationDescriptorId, ProjectId, TenantId } from './ids';
import { isEpisodeAdmissionId, isIsolationDescriptorId, isProjectId, isTenantId, mintEpisodeAdmissionId, mintIsolationDescriptorId } from './ids';
import type { SecurityResult, SecurityError } from './errors';
import { fail, invalidField, invalidType, missingField, ok } from './errors';
import { credentialValueViolations } from './credentials';
import type { ScopedRecord } from './scope';
import { type EpisodeId } from './ids';
import { isEpisodeId } from './ids';
import { deriveEpisodeId, isEnvironmentSpec, type EnvironmentSpec } from './spec-mirror';

// ---------------------------------------------------------------------------
// The isolation descriptor
// ---------------------------------------------------------------------------

/** The kind of untrusted workload the descriptor admits. */
export type WorkloadKind = 'research' | 'episode';

/** Runtime-checkable list of workload kinds. */
export const WORKLOAD_KINDS: readonly WorkloadKind[] = ['research', 'episode'];

/** Guard: `WorkloadKind`. */
export function isWorkloadKind(v: unknown): v is WorkloadKind {
  return typeof v === 'string' && (WORKLOAD_KINDS as readonly string[]).includes(v);
}

/** The network egress policy of the sandbox (DEFAULT-DENY: 'none' requires an empty allowlist). */
export type EgressPolicy = 'none' | 'allowlist';

/** Runtime-checkable list of egress policies. */
export const EGRESS_POLICIES: readonly EgressPolicy[] = ['none', 'allowlist'];

/** Guard: `EgressPolicy`. */
export function isEgressPolicy(v: unknown): v is EgressPolicy {
  return typeof v === 'string' && (EGRESS_POLICIES as readonly string[]).includes(v);
}

/** The filesystem policy of the sandbox. */
export type FilesystemPolicy = 'none' | 'scratch';

/** Runtime-checkable list of filesystem policies. */
export const FILESYSTEM_POLICIES: readonly FilesystemPolicy[] = ['none', 'scratch'];

/** Guard: `FilesystemPolicy`. */
export function isFilesystemPolicy(v: unknown): v is FilesystemPolicy {
  return typeof v === 'string' && (FILESYSTEM_POLICIES as readonly string[]).includes(v);
}

/** The credential-access policy of the sandbox (the floor is 'none'; 'envelope_refs_only' never yields values). */
export type CredentialAccessPolicy = 'none' | 'envelope_refs_only';

/** Runtime-checkable list of credential-access policies. */
export const CREDENTIAL_ACCESS_POLICIES: readonly CredentialAccessPolicy[] = ['none', 'envelope_refs_only'];

/** Guard: `CredentialAccessPolicy`. */
export function isCredentialAccessPolicy(v: unknown): v is CredentialAccessPolicy {
  return typeof v === 'string' && (CREDENTIAL_ACCESS_POLICIES as readonly string[]).includes(v);
}

/**
 * The workload isolation descriptor: the sandbox declaration every
 * untrusted workload MUST carry to be admissible. Content-addressed
 * (`iso:` + digest), scoped (L12), immutable, deeply frozen.
 */
export interface WorkloadIsolationDescriptor extends ScopedRecord {
  /** Content-addressed identity: `iso:` + digest of the canonical content. */
  readonly descriptorId: IsolationDescriptorId;
  /** The workload kind this descriptor admits ('episode' binds T005 episodes). */
  readonly workloadKind: WorkloadKind;
  /** The network egress policy. */
  readonly egress: EgressPolicy;
  /** The egress allowlist (host descriptors; MUST be empty iff egress === 'none'; unique, non-empty entries). */
  readonly networkAllowlist: readonly string[];
  /** The filesystem policy. */
  readonly filesystem: FilesystemPolicy;
  /** The credential-access policy (never values — the secrets boundary owns values). */
  readonly credentialAccess: CredentialAccessPolicy;
  /** The step budget of the workload (null = unbounded; a positive integer when set). */
  readonly maxSteps: number | null;
  /** The declaration instant (epoch ms; injected). */
  readonly asOf: TimestampMs;
}

/** Guard: `WorkloadIsolationDescriptor` (the default-deny and opacity laws included). */
export function isWorkloadIsolationDescriptor(v: unknown): v is WorkloadIsolationDescriptor {
  if (!isRecord(v)) return false;
  if (!isIsolationDescriptorId(v.descriptorId)) return false;
  if (!isMemberOf(WORKLOAD_KINDS, v.workloadKind)) return false;
  if (!isMemberOf(EGRESS_POLICIES, v.egress)) return false;
  if (!Array.isArray(v.networkAllowlist) || !v.networkAllowlist.every((x) => isNonEmptyString(x))) return false;
  if (new Set(v.networkAllowlist).size !== v.networkAllowlist.length) return false;
  if (v.egress === 'none' && v.networkAllowlist.length > 0) return false;
  if (!isMemberOf(FILESYSTEM_POLICIES, v.filesystem)) return false;
  if (!isMemberOf(CREDENTIAL_ACCESS_POLICIES, v.credentialAccess)) return false;
  if (v.maxSteps !== null && !isPositiveSafeInteger(v.maxSteps)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/** The descriptor's canonical JSON tree (everything except the content-addressed `descriptorId`). */
export function descriptorContentTree(descriptor: Omit<WorkloadIsolationDescriptor, 'descriptorId'>): JsonValue {
  return {
    workloadKind: descriptor.workloadKind,
    egress: descriptor.egress,
    networkAllowlist: [...descriptor.networkAllowlist],
    filesystem: descriptor.filesystem,
    credentialAccess: descriptor.credentialAccess,
    maxSteps: descriptor.maxSteps,
    tenant: descriptor.tenant,
    project: descriptor.project,
    asOf: descriptor.asOf,
  };
}

/** The canonical JSON of a validated descriptor's content (byte-deterministic, L9). */
export function canonicalDescriptorJson(descriptor: WorkloadIsolationDescriptor): string {
  return canonicalJson(descriptorContentTree(descriptor));
}

/** Collect-all validation of an untrusted isolation descriptor (opacity trip wire FIRST, then the default-deny laws, then content addressing). */
export function validateWorkloadIsolationDescriptor(value: unknown, path = 'descriptor'): SecurityResult<WorkloadIsolationDescriptor> {
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — descriptors declare sandbox policy, never secrets`,
    );
  }
  if (!isRecord(value)) return fail('invalid_type', `${path} must be an object`, path);
  const errors: SecurityError[] = [];
  if (value.descriptorId === undefined) errors.push(missingField(`${path}.descriptorId`));
  else if (!isIsolationDescriptorId(value.descriptorId)) errors.push(invalidField(`${path}.descriptorId`, "must be an opaque 'iso:'-prefixed descriptor id"));
  if (value.workloadKind === undefined) errors.push(missingField(`${path}.workloadKind`));
  else if (!isMemberOf(WORKLOAD_KINDS, value.workloadKind)) {
    errors.push(invalidField(`${path}.workloadKind`, `must be one of ${WORKLOAD_KINDS.join(' | ')}`));
  }
  if (value.egress === undefined) errors.push(missingField(`${path}.egress`));
  else if (!isMemberOf(EGRESS_POLICIES, value.egress)) {
    errors.push(invalidField(`${path}.egress`, `must be one of ${EGRESS_POLICIES.join(' | ')}`));
  }
  if (value.networkAllowlist === undefined) errors.push(missingField(`${path}.networkAllowlist`));
  else if (!Array.isArray(value.networkAllowlist) || !value.networkAllowlist.every((x) => isNonEmptyString(x)) || new Set(value.networkAllowlist).size !== value.networkAllowlist.length) {
    errors.push(invalidField(`${path}.networkAllowlist`, 'must be a list of unique non-empty host descriptors'));
  }
  if (value.filesystem === undefined) errors.push(missingField(`${path}.filesystem`));
  else if (!isMemberOf(FILESYSTEM_POLICIES, value.filesystem)) {
    errors.push(invalidField(`${path}.filesystem`, `must be one of ${FILESYSTEM_POLICIES.join(' | ')}`));
  }
  if (value.credentialAccess === undefined) errors.push(missingField(`${path}.credentialAccess`));
  else if (!isMemberOf(CREDENTIAL_ACCESS_POLICIES, value.credentialAccess)) {
    errors.push(invalidField(`${path}.credentialAccess`, `must be one of ${CREDENTIAL_ACCESS_POLICIES.join(' | ')}`));
  }
  if (value.maxSteps !== null && value.maxSteps !== undefined && !isPositiveSafeInteger(value.maxSteps)) {
    errors.push(invalidField(`${path}.maxSteps`, 'must be null or a positive safe integer'));
  }
  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms instant (no ambient clock)'));
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant scope (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project scope (L12/L15)'));
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };

  const descriptor = value as unknown as WorkloadIsolationDescriptor;

  // The DEFAULT-DENY law: no egress means NO allowlist (a contradictory
  // descriptor is inexpressible).
  if (descriptor.egress === 'none' && descriptor.networkAllowlist.length > 0) {
    return fail('invalid_field', `${path}.networkAllowlist must be empty when egress is 'none' (default-deny — a descriptor may not declare no egress while listing hosts)`, `${path}.networkAllowlist`);
  }
  // The content-address law: the id must match the content.
  const expectedId = mintIsolationDescriptorId(fnv1a32Hex(canonicalJson(descriptorContentTree(descriptor))));
  if (descriptor.descriptorId !== expectedId) {
    return fail('invalid_field', `${path}.descriptorId does not match the descriptor's content (expected ${expectedId}) — the id is content-addressed, a mismatch is a forged id`, `${path}.descriptorId`);
  }
  return ok(deepFreeze(descriptor));
}

/** Mint a NEW isolation descriptor (content-addressed id — the caller does not supply it). Pure and deterministic (L9). */
export function mintIsolationDescriptor(
  declaration: Omit<WorkloadIsolationDescriptor, 'descriptorId'>,
): SecurityResult<WorkloadIsolationDescriptor> {
  const violations = credentialValueViolations(declaration);
  if (violations.length > 0) {
    return fail('credential_value_present', `the descriptor declaration embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — descriptors declare sandbox policy, never secrets`);
  }
  if (declaration.egress === 'none' && declaration.networkAllowlist.length > 0) {
    return fail('invalid_field', "networkAllowlist must be empty when egress is 'none' (default-deny)", 'networkAllowlist');
  }
  const descriptorId = mintIsolationDescriptorId(fnv1a32Hex(canonicalJson(descriptorContentTree(declaration))));
  return validateWorkloadIsolationDescriptor({ ...declaration, descriptorId });
}

// ---------------------------------------------------------------------------
// The episode admission record
// ---------------------------------------------------------------------------

/**
 * The admission record: the durable proof that one T005 episode (the
 * untrusted research workload unit) was admitted under one isolation
 * descriptor. Binds the episode's derived id (T005's digest law,
 * mirrored), the spec digest, the descriptor id and the echoed sandbox
 * constraints. Content-addressed (`eadm:` + digest), scoped (L12),
 * append-only (admissions are facts — there is no un-admit; a refused
 * admission never produces a record, it produces the typed
 * `isolation_violation`).
 */
export interface EpisodeAdmissionRecord extends ScopedRecord {
  /** Content-addressed identity: `eadm:` + digest of the canonical content. */
  readonly admissionId: EpisodeAdmissionId;
  /** The admitted episode's derived id (`ep-` + digest — T005's law, mirrored). */
  readonly episodeId: EpisodeId;
  /** The digest of the episode's canonical spec (the L9 lineage anchor — the spec itself is bound by the runner, not copied here). */
  readonly specDigest: string;
  /** The isolation descriptor the episode was admitted under. */
  readonly descriptorId: IsolationDescriptorId;
  /** The workload kind (always 'episode' for episode admissions). */
  readonly workloadKind: WorkloadKind;
  /** The echoed sandbox constraints (the audit-facing echo of the descriptor's policy). */
  readonly constraints: {
    readonly egress: EgressPolicy;
    readonly filesystem: FilesystemPolicy;
    readonly credentialAccess: CredentialAccessPolicy;
    readonly maxSteps: number | null;
  };
  /** The admission instant (epoch ms; injected). */
  readonly admittedAt: TimestampMs;
  /** The admitting principal (the operator/service identity that vouched for the workload). */
  readonly admittedBy: string;
}

/** Guard: `EpisodeAdmissionRecord` (the opacity trip wire included). */
export function isEpisodeAdmissionRecord(v: unknown): v is EpisodeAdmissionRecord {
  if (!isRecord(v)) return false;
  if (!isEpisodeAdmissionId(v.admissionId)) return false;
  if (!isEpisodeId(v.episodeId)) return false;
  if (typeof v.specDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.specDigest)) return false;
  if (!isIsolationDescriptorId(v.descriptorId)) return false;
  if (!isMemberOf(WORKLOAD_KINDS, v.workloadKind)) return false;
  const constraints = v.constraints;
  if (!isRecord(constraints)) return false;
  if (!isMemberOf(EGRESS_POLICIES, constraints.egress)) return false;
  if (!isMemberOf(FILESYSTEM_POLICIES, constraints.filesystem)) return false;
  if (!isMemberOf(CREDENTIAL_ACCESS_POLICIES, constraints.credentialAccess)) return false;
  if (constraints.maxSteps !== null && !isPositiveSafeInteger(constraints.maxSteps)) return false;
  if (!isTimestampMs(v.admittedAt)) return false;
  if (!isNonEmptyString(v.admittedBy)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/** The admission record's canonical JSON tree (everything except the content-addressed `admissionId`). */
export function admissionContentTree(record: Omit<EpisodeAdmissionRecord, 'admissionId'>): JsonValue {
  return {
    episodeId: record.episodeId,
    specDigest: record.specDigest,
    descriptorId: record.descriptorId,
    workloadKind: record.workloadKind,
    constraints: {
      egress: record.constraints.egress,
      filesystem: record.constraints.filesystem,
      credentialAccess: record.constraints.credentialAccess,
      maxSteps: record.constraints.maxSteps,
    },
    tenant: record.tenant,
    project: record.project,
    admittedAt: record.admittedAt,
    admittedBy: record.admittedBy,
  };
}

/** The canonical JSON of a validated admission record's content (byte-deterministic, L9). */
export function canonicalAdmissionJson(record: EpisodeAdmissionRecord): string {
  return canonicalJson(admissionContentTree(record));
}

/**
 * Mint the admission record for one (spec, descriptor) pair — THE
 * CONSTRUCTOR (the enforcement service is the only caller; the record is
 * only ever minted AFTER the admission laws pass). Derives the episode id
 * from the spec via the mirrored T005 digest law; content-addresses the
 * admission id. Pure and deterministic.
 */
export function mintEpisodeAdmission(
  spec: EnvironmentSpec,
  descriptor: WorkloadIsolationDescriptor,
  admittedBy: string,
  admittedAt: TimestampMs,
): SecurityResult<EpisodeAdmissionRecord> {
  if (!isEnvironmentSpec(spec)) {
    return fail('invalid_type', 'mintEpisodeAdmission requires a structurally valid environment spec (T005 mirror)');
  }
  if (!isWorkloadIsolationDescriptor(descriptor)) {
    return fail('invalid_type', 'mintEpisodeAdmission requires a valid workload isolation descriptor');
  }
  if (!isNonEmptyString(admittedBy)) return fail('invalid_field', 'admittedBy must be a non-empty principal ref', 'admittedBy');
  if (!isTimestampMs(admittedAt)) return fail('invalid_field', 'admittedAt must be an epoch-ms instant (no ambient clock)', 'admittedAt');
  // L12: the descriptor's scope must be the admission's scope (the
  // workload runs under ITS OWN tenant's descriptor — never a borrowed one).
  const content: Omit<EpisodeAdmissionRecord, 'admissionId'> = {
    episodeId: deriveEpisodeId(spec),
    specDigest: fnv1a32Hex(canonicalJson(specDigestTree(spec))),
    descriptorId: descriptor.descriptorId,
    workloadKind: descriptor.workloadKind,
    constraints: {
      egress: descriptor.egress,
      filesystem: descriptor.filesystem,
      credentialAccess: descriptor.credentialAccess,
      maxSteps: descriptor.maxSteps,
    },
    tenant: descriptor.tenant,
    project: descriptor.project,
    admittedAt,
    admittedBy,
  };
  const admissionId = mintEpisodeAdmissionId(fnv1a32Hex(canonicalJson(admissionContentTree(content))));
  const record: EpisodeAdmissionRecord = deepFreeze({ ...content, admissionId });
  if (!isEpisodeAdmissionRecord(record)) {
    return fail('invalid_type', 'the minted admission record fails its own guard — the admission facts are malformed');
  }
  return ok(record);
}

/** The spec-digest tree (the L9 anchor: the digest of the canonical spec, as one canonical fold). */
function specDigestTree(spec: EnvironmentSpec): JsonValue {
  return { spec: canonicalSpecTree(spec) };
}

/** The canonical spec tree (mirrors spec-mirror's canonicalSpecJson content — kept as a tree here so the digest is one fold). */
function canonicalSpecTree(spec: EnvironmentSpec): JsonValue {
  return {
    profile: {
      environment_id: spec.profile.environment_id,
      fidelity: spec.profile.fidelity,
      clock: {
        now: spec.profile.clock.now,
        asOf: spec.profile.clock.asOf,
        playbackSpeed: spec.profile.clock.playbackSpeed,
        paused: spec.profile.clock.paused,
        fidelity: spec.profile.clock.fidelity,
        informationPolicy: spec.profile.clock.informationPolicy,
      },
      seed: spec.profile.seed,
      venue_scope: [...spec.profile.venue_scope],
      instrument_scope: [...spec.profile.instrument_scope],
      latency_policy: spec.profile.latency_policy,
      fee_policy: spec.profile.fee_policy,
    },
    world: { world_id: spec.world.world_id, kind: spec.world.kind },
    information_policy: spec.information_policy,
  };
}

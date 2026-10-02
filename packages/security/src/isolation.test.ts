/**
 * @tradrl/security — the isolation-contract tests.
 *
 * Pins: the descriptor's default-deny law (egress 'none' requires an
 * empty allowlist); content addressing and determinism; the opacity trip
 * wire; the episode admission record (derived episode id, spec digest,
 * echoed constraints, scope-carrying).
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalAdmissionJson,
  canonicalDescriptorJson,
  deriveEpisodeId,
  isEpisodeAdmissionRecord,
  isWorkloadIsolationDescriptor,
  mintEpisodeAdmission,
  mintIsolationDescriptor,
  validateWorkloadIsolationDescriptor,
  type EnvironmentSpec,
  type TimestampMs,
  type WorkloadIsolationDescriptor,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-iso' as Omit<WorkloadIsolationDescriptor, 'descriptorId'>['tenant'];
const PROJECT = 'project-iso' as Omit<WorkloadIsolationDescriptor, 'descriptorId'>['project'];

function descriptorDeclaration(overrides: Partial<Omit<WorkloadIsolationDescriptor, 'descriptorId'>> = {}): Omit<WorkloadIsolationDescriptor, 'descriptorId'> {
  return {
    workloadKind: 'episode',
    egress: 'none',
    networkAllowlist: [],
    filesystem: 'scratch',
    credentialAccess: 'envelope_refs_only',
    maxSteps: 10_000,
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
    ...overrides,
  };
}

function specFixture(seed: string = 'seed-42'): EnvironmentSpec {
  return {
    profile: {
      environment_id: 'env-research-1' as EnvironmentSpec['profile']['environment_id'],
      fidelity: 'exact_replay',
      clock: { now: T0, asOf: (T0 + 86_400_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      seed: seed as EnvironmentSpec['profile']['seed'],
      venue_scope: ['binance'] as unknown as EnvironmentSpec['profile']['venue_scope'],
      instrument_scope: ['BTC-USDT'] as unknown as EnvironmentSpec['profile']['instrument_scope'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-replay-btc' as EnvironmentSpec['world']['world_id'], kind: 'replay' },
    information_policy: 'point-in-time',
  };
}

describe('the isolation descriptor', () => {
  it('mints a content-addressed descriptor, deterministically', () => {
    const a = mintIsolationDescriptor(descriptorDeclaration());
    const b = mintIsolationDescriptor(descriptorDeclaration());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.descriptorId).toBe(b.value.descriptorId);
      expect(a.value.descriptorId.startsWith('iso:')).toBe(true);
      expect(canonicalDescriptorJson(a.value)).toBe(canonicalDescriptorJson(b.value));
      expect(isWorkloadIsolationDescriptor(a.value)).toBe(true);
      expect(Object.isFrozen(a.value)).toBe(true);
    }
  });

  it('DEFAULT-DENY: egress none with a non-empty allowlist is inexpressible', () => {
    const contradiction = descriptorDeclaration({ egress: 'none', networkAllowlist: ['api.vendor.com'] });
    const result = mintIsolationDescriptor(contradiction);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('invalid_field');
    expect(isWorkloadIsolationDescriptor({ ...contradiction, descriptorId: 'iso:0123abcd' })).toBe(false);
  });

  it('an allowlisted descriptor is fine and unique-hosts are enforced', () => {
    const okResult = mintIsolationDescriptor(descriptorDeclaration({ egress: 'allowlist', networkAllowlist: ['api.vendor.com', 'data.vendor.com'] }));
    expect(okResult.ok).toBe(true);
    const dup = mintIsolationDescriptor(descriptorDeclaration({ egress: 'allowlist', networkAllowlist: ['api.vendor.com', 'api.vendor.com'] }));
    expect(dup.ok).toBe(false);
  });

  it('the opacity trip wire refuses descriptors carrying secrets', () => {
    const result = mintIsolationDescriptor(descriptorDeclaration({ ...({ passphrase: 'x' } as unknown as Partial<Omit<WorkloadIsolationDescriptor, 'descriptorId'>>) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
  });

  it('a forged id fails the content-address law', () => {
    const minted = mintIsolationDescriptor(descriptorDeclaration());
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const forged = validateWorkloadIsolationDescriptor({ ...minted.value, descriptorId: 'iso:00000000' as WorkloadIsolationDescriptor['descriptorId'] });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors[0]!.code).toBe('invalid_field');
  });

  it('scope is part of the content: another tenant cannot reuse the same descriptor id', () => {
    const mine = mintIsolationDescriptor(descriptorDeclaration());
    const theirs = mintIsolationDescriptor(descriptorDeclaration({ tenant: 'tenant-other' as typeof TENANT }));
    expect(mine.ok && theirs.ok).toBe(true);
    if (mine.ok && theirs.ok) expect(mine.value.descriptorId).not.toBe(theirs.value.descriptorId);
  });
});

describe('the episode admission record', () => {
  it('binds the descriptor to the spec-derived episode id (deterministic, scoped, frozen)', () => {
    const descriptor = mintIsolationDescriptor(descriptorDeclaration());
    expect(descriptor.ok).toBe(true);
    if (!descriptor.ok) return;
    const spec = specFixture();
    const admission = mintEpisodeAdmission(spec, descriptor.value, 'operator:ada', (T0 + 5) as TimestampMs);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.value.episodeId).toBe(deriveEpisodeId(spec));
    expect(admission.value.episodeId.startsWith('ep-')).toBe(true);
    expect(admission.value.admissionId.startsWith('eadm:')).toBe(true);
    expect(admission.value.tenant).toBe(TENANT);
    expect(admission.value.project).toBe(PROJECT);
    expect(admission.value.constraints).toEqual({ egress: 'none', filesystem: 'scratch', credentialAccess: 'envelope_refs_only', maxSteps: 10_000 });
    expect(isEpisodeAdmissionRecord(admission.value)).toBe(true);
    expect(Object.isFrozen(admission.value)).toBe(true);

    const again = mintEpisodeAdmission(spec, descriptor.value, 'operator:ada', (T0 + 5) as TimestampMs);
    expect(again.ok).toBe(true);
    if (again.ok) expect(canonicalAdmissionJson(again.value)).toBe(canonicalAdmissionJson(admission.value));
  });

  it('a different spec or descriptor yields a different admission (content addressing)', () => {
    const descriptor = mintIsolationDescriptor(descriptorDeclaration());
    const otherDescriptor = mintIsolationDescriptor(descriptorDeclaration({ maxSteps: 20_000 }));
    expect(descriptor.ok && otherDescriptor.ok).toBe(true);
    if (!descriptor.ok || !otherDescriptor.ok) return;
    const a = mintEpisodeAdmission(specFixture(), descriptor.value, 'operator:ada', T0);
    const b = mintEpisodeAdmission(specFixture(), otherDescriptor.value, 'operator:ada', T0);
    const c = mintEpisodeAdmission({ ...specFixture(), world: { world_id: 'world-other' as EnvironmentSpec['world']['world_id'], kind: 'replay' } }, descriptor.value, 'operator:ada', T0);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.value.admissionId).not.toBe(b.value.admissionId);
      expect(a.value.admissionId).not.toBe(c.value.admissionId);
      expect(a.value.episodeId).not.toBe(c.value.episodeId);
    }
  });

  it('malformed specs are refused (the T005 mirror guard)', () => {
    const descriptor = mintIsolationDescriptor(descriptorDeclaration());
    expect(descriptor.ok).toBe(true);
    if (!descriptor.ok) return;
    const broken = { ...specFixture(), information_policy: 'full-information' } as unknown as EnvironmentSpec;
    const result = mintEpisodeAdmission(broken, descriptor.value, 'operator:ada', T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('invalid_type');
  });
});

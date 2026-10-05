/**
 * @tradrl/adapter-arena — the L17 optional-path outbound routing tests:
 * the pure translation of a platform capability request onto the
 * documented Arena wire frame, and every typed refusal (the validation
 * law, the catalog-envelope law, the enum translation defense).
 */

import { describe, expect, it } from 'vitest';

import {
  buildArenaCapabilityRequest,
  goalpostBytes,
  ARENA_REQUEST_CHANNEL,
  canonicalJson,
  arenaProtocolCodeOf,
  isArenaProtocolError,
  validateCapabilityRequest,
  type CapabilityRequest,
} from './index';
import {
  arenaRequestDraft,
  fixtureRequest,
  FIXTURE_GOALPOSTS,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  T0,
} from './test-fixtures';

describe('buildArenaCapabilityRequest (the optional-path translation)', () => {
  it('translates a valid platform request into the documented wire frame (fixed key order, goalposts VERBATIM)', () => {
    const routed = buildArenaCapabilityRequest({ request: arenaRequestDraft() });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    expect(routed.value.offerId).toBe('offer-liquidity-regime-analysis');
    expect(routed.value.request.requestId).toBe(fixtureRequest().requestId);
    // The documented frame: FIXED key order (byte-determinism).
    expect(Object.keys(routed.value.frame)).toEqual([
      'action',
      'requestRef',
      'capability',
      'brief',
      'deliverableType',
      'goalposts',
      'deadlineMs',
      'terms',
      'requestedAtMs',
      'gapRefs',
      'evidenceRefs',
    ]);
    expect(routed.value.frame.action).toBe('CAPABILITY_REQUEST');
    expect(routed.value.frame.deliverableType).toBe('ARTIFACT');
    expect(routed.value.frame.goalposts).toEqual([...FIXTURE_GOALPOSTS]);
    expect(routed.value.frame.deadlineMs).toBe(T0 + 86_400_000);
    expect(routed.value.frame.gapRefs).toEqual(['gap-liquidity-0042']);
    // The L12 scope rides NOWHERE in the wire frame.
    expect(JSON.stringify(routed.value.frame)).not.toContain(FIXTURE_TENANT);
    expect(JSON.stringify(routed.value.frame)).not.toContain(FIXTURE_PROJECT);
  });

  it('is byte-deterministic: the same request produces the same frame, byte-identically', () => {
    const first = buildArenaCapabilityRequest({ request: arenaRequestDraft() });
    const second = buildArenaCapabilityRequest({ request: arenaRequestDraft() });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(canonicalJson(first.value.frame)).toBe(canonicalJson(second.value.frame));
    }
  });

  it('refuses a request that fails the T045 validation law (never a blind cast)', () => {
    // A request with no evidence citation is invented, not requested.
    const invented = { ...arenaRequestDraft(), gapRefs: [], evidenceRefs: [] };
    const routed = buildArenaCapabilityRequest({ request: invented });
    expect(routed.ok).toBe(false);
    if (!routed.ok) {
      expect(routed.error.code).toBe('invalid_configuration');
      expect(routed.error.message).toContain('evidence_missing');
    }
    // A label-smuggled request is the L16a violation.
    const smuggled = { ...arenaRequestDraft(), profession: 'Senior Quantitative Analyst' };
    const refused = buildArenaCapabilityRequest({ request: smuggled });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('label_as_evidence');
    // Garbage is a typed refusal, never a crash.
    expect(buildArenaCapabilityRequest({ request: 42 }).ok).toBe(false);
    expect(buildArenaCapabilityRequest({ request: null }).ok).toBe(false);
  });

  it('refuses a request outside the declared catalog envelope (arena_catalog_mismatch — the fail-fast law)', () => {
    // A capability the catalog does not serve.
    const unknownCapability = buildArenaCapabilityRequest({ request: { ...arenaRequestDraft(), requestedCapability: 'exotic-derivatives-pricing' } });
    expect(unknownCapability.ok).toBe(false);
    if (!unknownCapability.ok) {
      expect(isArenaProtocolError(unknownCapability.error, 'arena_catalog_mismatch')).toBe(true);
      expect(arenaProtocolCodeOf(unknownCapability.error)).toBe('arena_catalog_mismatch');
    }
    // A deliverable kind the serving offer does not produce (ARTIFACT vs the stress-replay offer).
    const wrongKind = buildArenaCapabilityRequest({
      request: { ...arenaRequestDraft(), requestedCapability: 'microstructure-stress-replay' },
    });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) {
      expect(arenaProtocolCodeOf(wrongKind.error)).toBe('arena_catalog_mismatch');
      expect(wrongKind.error.message).toContain('"capability-artifact"');
    }
    // A verification kind the serving offer does not accept (the stress-replay offer takes no MEASUREMENT).
    // The deliverable kind is one that offer DOES produce (DEMONSTRATION), so
    // the refusal isolates the verification-regime axis exactly (the staged,
    // first-failure-wins refusal order is the module's documented law).
    const goalposts = [
      { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 900 },
    ];
    const wrongGoalposts = buildArenaCapabilityRequest({
      request: { ...arenaRequestDraft(), requestedCapability: 'microstructure-stress-replay', deliverableKind: 'demonstration', verification: goalposts },
    });
    expect(wrongGoalposts.ok).toBe(false);
    if (!wrongGoalposts.ok) {
      expect(arenaProtocolCodeOf(wrongGoalposts.error)).toBe('arena_catalog_mismatch');
      expect(wrongGoalposts.error.message).toContain('"measurement"');
      expect(wrongGoalposts.error.message).toContain('accepts the verification kind');
    }
  });

  it('goalpostBytes pins the frozen contract the guard compares every echo against', () => {
    const request: CapabilityRequest = fixtureRequest();
    expect(goalpostBytes(request)).toBe(canonicalJson(request.verification));
    // A different contract pins differently.
    const other = { ...request, verification: [...FIXTURE_GOALPOSTS].slice(0, 2) } as CapabilityRequest;
    expect(goalpostBytes(other)).not.toBe(goalpostBytes(request));
  });

  it('the request channel is the documented outbound channel (not a consumed stream)', () => {
    expect(ARENA_REQUEST_CHANNEL).toBe('arenaRequests');
  });
});

describe('the routed request is a REAL T045 envelope (the mirror validation round-trips)', () => {
  it('the frame\'s requestRef IS the content-addressed cpr: id the platform minted', () => {
    const routed = buildArenaCapabilityRequest({ request: arenaRequestDraft() });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const revalidated = validateCapabilityRequest(arenaRequestDraft());
    expect(revalidated.ok).toBe(true);
    if (revalidated.ok) {
      expect(routed.value.frame.requestRef).toBe(revalidated.value.requestId);
      expect(revalidated.value.requestId).toMatch(/^cpr:[0-9a-f]{16}$/);
    }
  });
});

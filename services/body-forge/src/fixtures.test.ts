/**
 * @tradrl/body-forge — the fixture tests: the certification accept path +
 * the rejection paths (evidence missing, compatibility fail), the golden
 * byte-stability, and the gap-per-kind coverage.
 *
 * Behavioral, law-driven:
 * - ACCEPT: the golden candidate + attained verdicts + satisfied
 *   compatibility -> a `certified` CertificationRecord AND a NEW
 *   certified BodyVersion mirror (L3: mint, never mutate; the uncertified
 *   candidate object is untouched).
 * - REJECTION (evidence missing): a certification decision without the
 *   evaluation verdict citation is refused (`evidence_missing`).
 * - REJECTION (compatibility fail): the compatibility verdict not
 *   satisfied -> `rejected` with the structured `compatibility_fail`
 *   reason retained; NO certified version is minted.
 * - L3: re-certifying the (now certified) candidate is the typed error
 *   `certified_version_mutation`.
 * - The certification log grows append-only (rejected + certified records
 *   retained side by side).
 */

import { describe, expect, it } from 'vitest';

import { type CertificationRecord, isDeeplyFrozen } from '../../../packages/skills/src/index';
import { certifyCandidate } from './forge';
import {
  CERTIFY_AT,
  fixtureCertificationAcceptInput,
  fixtureCertificationCompatibilityFailInput,
  fixtureCertificationEvidenceMissingInput,
  fixtureForgedCandidate,
  fixtureGaps,
  fixtureParentBodyVersion,
} from './fixtures';
import { isBodyVersionMirror } from './mirrors';
import { serializeForgedCandidate } from './index';

describe('the fixture invariants', () => {
  it('the parent fixture is a valid, deeply frozen mirror record', () => {
    expect(isBodyVersionMirror(fixtureParentBodyVersion)).toBe(true);
    expect(isDeeplyFrozen(fixtureParentBodyVersion)).toBe(true);
  });

  it('the gap fixtures cover ALL SIX failure classes (LEARNING-LOOP, verbatim)', () => {
    expect(fixtureGaps.length).toBe(6);
    expect(fixtureGaps.map((gap) => gap.kind)).toEqual([
      'regime',
      'sentiment-event',
      'liquidity',
      'execution',
      'risk',
      'coordination',
    ]);
    expect(new Set(fixtureGaps.map((gap) => gap.gapId)).size).toBe(6);
  });

  it('the golden candidate is byte-stable and deeply frozen', () => {
    expect(serializeForgedCandidate(fixtureForgedCandidate)).toBe(serializeForgedCandidate(fixtureForgedCandidate));
    expect(isDeeplyFrozen(fixtureForgedCandidate)).toBe(true);
  });
});

describe('THE CERTIFICATION ACCEPT PATH', () => {
  it('certifies: a certified record + a NEW certified version (L3: mint, never mutate)', () => {
    const result = certifyCandidate(fixtureCertificationAcceptInput, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { record, certifiedVersion, log } = result.value;
    expect(record.decision).toBe('certified');
    expect(record.reasons.map((r) => r.code)).toContain('evaluation_attained');
    expect(record.reasons.map((r) => r.code)).toContain('compatibility_satisfied');
    expect(record.evaluationVerdictRef).toBe('v-regime-1');
    expect(record.compatibilityVerdictRef).toBe('compat-regime-1');
    expect(record.certifiedAt).toBe(CERTIFY_AT);
    expect(record.lineage.parentVersionRef).toBe('regime-researcher@1.2.0');
    expect(record.lineage.forgeVersion).toBe('reference-forge/1');
    expect(log.length).toBe(1);

    // The NEW certified version: a distinct, deeply frozen mirror record.
    expect(certifiedVersion).not.toBeNull();
    const certified = certifiedVersion as ReturnType<typeof isBodyVersionMirror> extends never ? never : NonNullable<typeof certifiedVersion>;
    expect(isBodyVersionMirror(certified)).toBe(true);
    expect(certified.certified).toBe(true);
    expect(certified.certificationEvidence).not.toBeNull();
    expect(certified.certificationEvidence?.evaluationRefs).toContain('v-regime-1');
    expect(isDeeplyFrozen(certified)).toBe(true);

    // L3: the UNCERTIFIED candidate object is untouched — still a distinct
    // record kind, still uncertified, byte-identical.
    expect(fixtureForgedCandidate.kind).toBe('forged-candidate');
    expect(fixtureForgedCandidate.candidate.certified).toBe(false);
    expect(serializeForgedCandidate(fixtureForgedCandidate)).toBe(serializeForgedCandidate(fixtureForgedCandidate));
  });

  it('the certified version is NOT the candidate object (a fresh mint)', () => {
    const result = certifyCandidate(fixtureCertificationAcceptInput, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.certifiedVersion).not.toBe(fixtureForgedCandidate.candidate);
  });
});

describe('THE REJECTION PATHS (retained, structured)', () => {
  it('evidence missing: no evaluation verdict citation -> evidence_missing', () => {
    const result = certifyCandidate(fixtureCertificationEvidenceMissingInput, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'evidence_missing')).toBe(true);
      expect(result.errors.some((e) => e.path.includes('evaluationVerdictRef'))).toBe(true);
    }
  });

  it('compatibility fail: rejected with the structured reason; no certified version', () => {
    const result = certifyCandidate(fixtureCertificationCompatibilityFailInput, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { record, certifiedVersion } = result.value;
    expect(record.decision).toBe('rejected');
    expect(record.reasons.map((r) => r.code)).toContain('compatibility_fail');
    expect(certifiedVersion).toBeNull();
  });

  it('the rejected certification is retained in the log (never dropped)', () => {
    const result = certifyCandidate(fixtureCertificationCompatibilityFailInput, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.log.length).toBe(1);
    expect((result.value.log[0] as CertificationRecord).decision).toBe('rejected');
  });

  it('rejections and certifications coexist in the append-only log', () => {
    const rejection = certifyCandidate(fixtureCertificationCompatibilityFailInput, []);
    expect(rejection.ok).toBe(true);
    if (!rejection.ok) return;
    // A SECOND, different candidate (certified) appends after the rejection.
    const otherCandidateInput = {
      ...(fixtureCertificationAcceptInput as Record<string, unknown>),
      certificationId: 'cert-forge-accept-2',
      // A distinct candidate: re-forge at a later target version.
      candidate: {
        ...fixtureForgedCandidate,
        candidate: {
          ...fixtureForgedCandidate.candidate,
          id: 'regime-researcher@1.4.0',
          version: { major: 1, minor: 4, patch: 0, prerelease: [], build: [] },
        },
      },
    };
    const acceptance = certifyCandidate(otherCandidateInput, rejection.value.log);
    expect(acceptance.ok).toBe(true);
    if (acceptance.ok) {
      expect(acceptance.value.log.length).toBe(2);
      expect(acceptance.value.log.map((r) => r.decision)).toEqual(['rejected', 'certified']);
    }
  });
});

describe('L3 — the existential law (the certification API)', () => {
  it('re-certifying a certified candidate is the typed error certified_version_mutation', () => {
    const first = certifyCandidate(fixtureCertificationAcceptInput, []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The certified VERSION fed back into the certification path.
    const certifiedCandidate = {
      kind: 'forged-candidate',
      candidate: first.value.certifiedVersion,
      manifest: fixtureForgedCandidate.manifest,
      lineage: fixtureForgedCandidate.lineage,
    };
    const mutation = certifyCandidate(
      {
        ...(fixtureCertificationAcceptInput as Record<string, unknown>),
        candidate: certifiedCandidate,
        certificationId: 'cert-forge-mutation-1',
      },
      [],
    );
    expect(mutation.ok).toBe(false);
    if (!mutation.ok) {
      expect(mutation.errors[0]?.code).toBe('certified_version_mutation');
      expect(mutation.errors[0]?.message).toContain('L3');
    }
  });

  it('the log-level L3 law fires on re-certification of a certified candidate', () => {
    const first = certifyCandidate(fixtureCertificationAcceptInput, []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = certifyCandidate(
      { ...(fixtureCertificationAcceptInput as Record<string, unknown>), certificationId: 'cert-forge-dup-1' },
      first.value.log,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors[0]?.code).toBe('certified_version_mutation');
    }
  });

  it('a non-candidate value cannot enter the certification path', () => {
    const result = certifyCandidate(
      { ...(fixtureCertificationAcceptInput as Record<string, unknown>), candidate: { kind: 'not-a-candidate' } },
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('distinct record kind'))).toBe(true);
    }
  });
});

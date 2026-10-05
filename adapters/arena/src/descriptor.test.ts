/**
 * @tradrl/adapter-arena — the declared source descriptor + capability
 * catalog tests (behavioral: the declaration validates, is frozen,
 * carries the honest capability envelope, and the catalog speaks the
 * T017/T045 measured-evidence language — L16a).
 */

import { describe, expect, it } from 'vitest';

import {
  ARENA_SOURCE_DESCRIPTOR,
  ARENA_PROVIDER_ID,
  ARENA_ADAPTER,
  ARENA_CHANNELS,
  ARENA_CAPABILITY_KEYS,
  ARENA_CATALOG,
  ARENA_DELIVERABLE_KIND_MAP,
  ARENA_VERIFICATION_KIND_MAP,
  ARENA_DELIVERABLE_KINDS,
  ARENA_VERIFICATION_KINDS,
  arenaCatalogAccepts,
  validateSourceDescriptor,
  isSourceCategory,
  isMeasuredEvidenceMirror,
  labelKeyPaths,
  type ArenaCatalogOffer,
} from './index';

describe('ARENA_SOURCE_DESCRIPTOR (the declared capability card)', () => {
  it('declares the Arena identity in the HUMAN source family (spec/ADAPTERS.md "Human expertise")', () => {
    expect(ARENA_SOURCE_DESCRIPTOR.provider).toBe('arena');
    expect(ARENA_SOURCE_DESCRIPTOR.category).toBe('human');
    expect(isSourceCategory('human')).toBe(true);
    expect(Object.isFrozen(ARENA_SOURCE_DESCRIPTOR)).toBe(true);
  });

  it('declares the documented wire channels and the honest delayed latency class', () => {
    expect([...ARENA_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual(['arenaCatalog', 'arenaQuotes', 'arenaDeliveries']);
    expect(ARENA_CHANNELS).toEqual([...ARENA_SOURCE_DESCRIPTOR.capabilities.channels]);
    expect(ARENA_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('delayed');
  });

  it('declares the full deliverable and verification vocabularies (the ADAPTERS operation list)', () => {
    expect([...ARENA_SOURCE_DESCRIPTOR.capabilities.deliverable_kinds].sort()).toEqual([...ARENA_DELIVERABLE_KINDS].sort());
    expect(ARENA_DELIVERABLE_KINDS).toContain('capability-artifact');
    expect(ARENA_DELIVERABLE_KINDS).toContain('expert-evidence');
    expect(ARENA_DELIVERABLE_KINDS).toContain('demonstration');
    expect(ARENA_DELIVERABLE_KINDS).toContain('annotation');
    expect(ARENA_DELIVERABLE_KINDS).toContain('evaluation');
    expect([...ARENA_VERIFICATION_KINDS].sort()).toEqual(['benchmark', 'local-evaluation', 'measurement']);
  });

  it('the enum maps translate the FULL wire vocabulary onto the canonical vocabulary (total, invertible)', () => {
    expect(Object.keys(ARENA_DELIVERABLE_KIND_MAP).sort()).toEqual(['ANNOTATION', 'ARTIFACT', 'ASSESSMENT', 'DEMONSTRATION', 'EVIDENCE']);
    expect(new Set(Object.values(ARENA_DELIVERABLE_KIND_MAP))).toEqual(new Set(['expert-evidence', 'demonstration', 'annotation', 'evaluation', 'capability-artifact']));
    expect(Object.keys(ARENA_VERIFICATION_KIND_MAP).sort()).toEqual(['BENCHMARK', 'LOCAL_EVAL', 'MEASUREMENT']);
    expect(new Set(Object.values(ARENA_VERIFICATION_KIND_MAP))).toEqual(new Set(['benchmark', 'measurement', 'local-evaluation']));
  });

  it('validates through the mirrored validator (the declaration discipline)', () => {
    const validation = validateSourceDescriptor(ARENA_SOURCE_DESCRIPTOR);
    expect(validation.ok).toBe(true);
    const broken = validateSourceDescriptor({ provider: 'arena', category: 'maybe', capabilities: ARENA_SOURCE_DESCRIPTOR.capabilities });
    expect(broken.ok).toBe(false);
  });

  it('the concrete adapter identity is declared (the L9 lineage producer)', () => {
    expect(ARENA_ADAPTER.id).toBe('adapter-arena');
    expect(ARENA_ADAPTER.version).toBe('0.0.0');
  });
});

describe('ARENA_CATALOG (the declared capability catalog — the T045 language)', () => {
  it('declares one offer per declared capability contract, each with NON-EMPTY MEASURED evidence (L16a)', () => {
    expect(ARENA_CATALOG.length).toBe(ARENA_CAPABILITY_KEYS.length);
    for (const offer of ARENA_CATALOG as readonly ArenaCatalogOffer[]) {
      expect(ARENA_CAPABILITY_KEYS).toContain(offer.capability);
      expect(offer.evidence.length).toBeGreaterThan(0);
      for (const evidence of offer.evidence) {
        expect(isMeasuredEvidenceMirror(evidence)).toBe(true);
      }
      // The wire type codes are documented (they carry canonical translations).
      for (const code of offer.deliverableTypes) {
        expect(code in ARENA_DELIVERABLE_KIND_MAP).toBe(true);
      }
      for (const code of offer.verificationTypes) {
        expect(code in ARENA_VERIFICATION_KIND_MAP).toBe(true);
      }
    }
  });

  it('carries NO profession/role label anywhere (L16a — the label trip-wire over the whole catalog)', () => {
    expect(labelKeyPaths(ARENA_CATALOG)).toEqual([]);
    expect(labelKeyPaths(ARENA_SOURCE_DESCRIPTOR)).toEqual([]);
  });

  it('arenaCatalogAccepts reflects the declared verification vocabulary (the honest envelope)', () => {
    expect(arenaCatalogAccepts({ kind: 'benchmark', requirementRef: 'r', benchmarkId: 'b' })).toBe(true);
    expect(arenaCatalogAccepts({ kind: 'measurement', requirementRef: 'r', metric: 'p95-latency-ms', max: 100 })).toBe(true);
    expect(arenaCatalogAccepts({ kind: 'local-evaluation', requirementRef: 'r', evaluationRef: 'e' })).toBe(true);
  });
});

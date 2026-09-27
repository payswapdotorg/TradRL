import { describe, expect, it } from 'vitest';
import {
  type Possession,
  type PossessionDraft,
  POSSESSION_TRANSITIONS,
  canTransitionPossession,
  createPossession,
  isPossession,
  isPossessionStatus,
  transitionPossession,
  validatePossession,
} from './possession';
import { IllegalTransitionError } from './primitives';
import { exampleCertifiedBodyVersion, exampleIncompatibleSubstrate, examplePossession, exampleSubstrate } from './examples';

function validDraft(): PossessionDraft {
  return JSON.parse(JSON.stringify(examplePossession)) as PossessionDraft;
}

describe('createPossession', () => {
  it('creates a possession in state draft (single state-machine entry)', () => {
    const possession = createPossession(validDraft());
    expect(possession.status).toBe('draft');
    expect(isPossession(possession)).toBe(true);
    expect(Object.isFrozen(possession)).toBe(true);
  });

  it('rejects invalid fields with TypeErrors', () => {
    const cases: Array<[string, (d: PossessionDraft) => PossessionDraft]> = [
      ['id', (d) => ({ ...d, id: 'bad id' as PossessionDraft['id'] })],
      ['bodyVersionId', (d) => ({ ...d, bodyVersionId: 'no-at' as PossessionDraft['bodyVersionId'] })],
      ['substrateId', (d) => ({ ...d, substrateId: 'no-slash@1' as PossessionDraft['substrateId'] })],
      ['adapter', (d) => ({ ...d, adapter: { ...d.adapter, configRef: '' } })],
      ['runtimeProfile', (d) => ({ ...d, runtimeProfile: { ...d.runtimeProfile, timeoutMs: 0 } })],
      ['environmentProfile', (d) => ({ ...d, environmentProfile: { ...d.environmentProfile, fidelityMode: 'approximate' as never } })],
      ['policyBundleRef', (d) => ({ ...d, policyBundleRef: ' ' as PossessionDraft['policyBundleRef'] })],
      ['createdAt', (d) => ({ ...d, createdAt: 'now' as PossessionDraft['createdAt'] })],
    ];
    for (const [field, mutate] of cases) {
      try {
        createPossession(mutate(validDraft()));
        throw new Error(`expected createPossession to reject invalid ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect((error as TypeError).message).toContain(field.split('.')[0]);
      }
    }
  });
});

describe('validatePossession — the possession law', () => {
  it('accepts a compatible substrate possessing a certified body version', () => {
    const result = validatePossession(examplePossession, exampleCertifiedBodyVersion, exampleSubstrate);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.verdict?.satisfied).toBe(true);
  });

  it('an incompatible substrate cannot possess the body', () => {
    const draft = { ...validDraft(), substrateId: exampleIncompatibleSubstrate.id };
    const possession = createPossession(draft);
    const result = validatePossession(possession, exampleCertifiedBodyVersion, exampleIncompatibleSubstrate);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toEqual(['substrate-incompatible']);
    expect(result.verdict?.satisfied).toBe(false);
    expect(result.verdict?.violations.map((v) => v.code)).toEqual([
      'context-window',
      'output-tokens',
      'tool-use',
      'structured-output',
      'substitution-class',
    ]);
  });

  it('flags a body-version id mismatch', () => {
    const draft = { ...validDraft(), bodyVersionId: 'regime-researcher@9.9.9' as PossessionDraft['bodyVersionId'] };
    const possession = createPossession(draft);
    const result = validatePossession(possession, exampleCertifiedBodyVersion, exampleSubstrate);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toEqual(['body-version-mismatch']);
    expect(result.verdict).toBeNull();
  });

  it('flags a substrate id mismatch', () => {
    const other = exampleIncompatibleSubstrate;
    const possession = createPossession({ ...validDraft() });
    const result = validatePossession(possession, exampleCertifiedBodyVersion, other);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toEqual(['substrate-mismatch']);
    expect(result.verdict).toBeNull();
  });
});

describe('possession state machine', () => {
  it('declares the authoritative transition table', () => {
    expect(POSSESSION_TRANSITIONS.draft).toEqual(['validated', 'retired']);
    expect(POSSESSION_TRANSITIONS.validated).toEqual(['active', 'retired']);
    expect(POSSESSION_TRANSITIONS.active).toEqual(['suspended', 'retired']);
    expect(POSSESSION_TRANSITIONS.suspended).toEqual(['active', 'retired']);
    expect(POSSESSION_TRANSITIONS.retired).toEqual([]);
  });

  it('canTransitionPossession validates edges including unknown states', () => {
    expect(canTransitionPossession('draft', 'validated')).toBe(true);
    expect(canTransitionPossession('draft', 'active')).toBe(false);
    expect(canTransitionPossession('retired', 'draft')).toBe(false);
    expect(canTransitionPossession('active', 'active')).toBe(false);
    expect(isPossessionStatus('hibernating')).toBe(false);
  });

  it('walks the happy path draft -> validated -> active -> suspended -> active -> retired', () => {
    let possession: Possession = createPossession(validDraft());
    possession = transitionPossession(possession, 'validated');
    expect(possession.status).toBe('validated');
    possession = transitionPossession(possession, 'active');
    expect(possession.status).toBe('active');
    possession = transitionPossession(possession, 'suspended');
    expect(possession.status).toBe('suspended');
    possession = transitionPossession(possession, 'active');
    expect(possession.status).toBe('active');
    possession = transitionPossession(possession, 'retired');
    expect(possession.status).toBe('retired');
  });

  it('throws IllegalTransitionError on illegal edges', () => {
    const possession = createPossession(validDraft());
    expect(() => transitionPossession(possession, 'active')).toThrow(IllegalTransitionError);
    const retired = transitionPossession(possession, 'retired');
    expect(() => transitionPossession(retired, 'draft')).toThrow(IllegalTransitionError);
    expect(() => transitionPossession(retired, 'retired')).toThrow(IllegalTransitionError);
    expect(() => transitionPossession(possession, 'bogus' as never)).toThrow(TypeError);
  });

  it('transitions are copy-on-write: the source record is untouched', () => {
    const draft = createPossession(validDraft());
    const validated = transitionPossession(draft, 'validated');
    expect(draft.status).toBe('draft');
    expect(validated.status).toBe('validated');
    expect(validated.id).toBe(draft.id);
    expect(validated.createdAt).toBe(draft.createdAt);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(() => {
      (validated as { status: string }).status = 'active';
    }).toThrow(TypeError);
  });
});

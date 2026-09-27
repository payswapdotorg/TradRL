// Type-level contract tests.
//
// These assertions are verified by `pnpm typecheck` (tsc --noEmit): every
// `@ts-expect-error` marks a line that MUST fail to compile. If a guarantee
// regresses (the line starts compiling), the unused @ts-expect-error itself
// becomes a type error and the gate fails. The runtime lines underneath still
// execute safely in vitest.

import { describe, expect, it } from 'vitest';
import {
  type BodyId,
  type BodyVersionId,
  type ExecutionAuthorityMode,
  type EvaluationLayer,
  type PossessionId,
  type CertifiedBodyVersion,
  bodyId,
  bodyVersionId,
  possessionId,
} from './index';
import { exampleCertifiedBodyVersion } from './examples';

describe('type-level guarantees (verified by pnpm typecheck)', () => {
  it('certified versions are deeply readonly: field assignment does not compile', () => {
    const certified: CertifiedBodyVersion = exampleCertifiedBodyVersion;
    expect(() => {
      // @ts-expect-error — L3: certified records are deeply readonly
      certified.certificationEvidence = null as never;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — L3: certified records are deeply readonly
      certified.certified = false;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — L3: certified records are deeply readonly
      certified.composition.mission.summary = 'hacked';
    }).toThrow(TypeError);
  });

  it('readonly arrays cannot be mutated through the type system', () => {
    const certified: CertifiedBodyVersion = exampleCertifiedBodyVersion;
    expect(() => {
      // @ts-expect-error — readonly arrays have no push
      certified.composition.capabilities.push('x' as never);
    }).toThrow(TypeError);
  });

  it('plain strings are not branded ids', () => {
    // @ts-expect-error — brands require the factories
    const asBodyId: BodyId = 'regime-researcher';
    // @ts-expect-error — brands require the factories
    const asVersionId: BodyVersionId = 'regime-researcher@1.0.0';
    expect(asBodyId).toBe('regime-researcher');
    expect(asVersionId).toBe('regime-researcher@1.0.0');
  });

  it('branded ids of different kinds are not interchangeable', () => {
    const possessionIdentifier: PossessionId = possessionId('possession-1');
    // @ts-expect-error — PossessionId is not BodyVersionId
    const asVersionId: BodyVersionId = possessionIdentifier;
    const bodyIdentifier: BodyId = bodyId('regime-researcher');
    // @ts-expect-error — BodyId is not PossessionId
    const asPossessionId: PossessionId = bodyIdentifier;
    expect(asVersionId).toBe('possession-1');
    expect(asPossessionId).toBe('regime-researcher');
  });

  it('model-autonomous execution authority does not exist (L8/L20)', () => {
    // @ts-expect-error — ExecutionAuthorityMode has no 'model-autonomous' member
    const mode: ExecutionAuthorityMode = 'model-autonomous';
    expect(mode).toBe('model-autonomous'); // documents the impossible value
  });

  it('evaluation layers are a closed set', () => {
    // @ts-expect-error — EvaluationLayer is a closed union
    const layer: EvaluationLayer = ' vibes-check';
    expect(layer).toBe(' vibes-check');
  });

  it('canonical body-version ids typecheck through the factory', () => {
    const id: BodyVersionId = bodyVersionId('regime-researcher@2.0.0-rc.1');
    expect(id).toBe('regime-researcher@2.0.0-rc.1');
  });
});

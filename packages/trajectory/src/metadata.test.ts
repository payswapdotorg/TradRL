/**
 * @tradrl/trajectory — L9 lineage completeness of the metadata block.
 *
 * ARCHITECTURE-LOCK L9: every trajectory binds its full lineage. The negative
 * tests are the law's teeth: removing ANY mandatory lineage reference —
 * scalar or list entry — must fail the guard. Reproducibility that can be
 * silently dropped is not reproducibility.
 */

import { describe, expect, it } from 'vitest';

import { isTrajectoryMetadata, LINEAGE_LIST_FIELDS } from './index';
import type { TrajectoryMetadata } from './index';
import { validMetadata } from './fixtures';

function metaWith(patch: Partial<TrajectoryMetadata>): TrajectoryMetadata {
  return { ...validMetadata(), ...patch };
}

describe('TrajectoryMetadata (the L9 block)', () => {
  it('accepts the complete fixture', () => {
    expect(isTrajectoryMetadata(validMetadata())).toBe(true);
  });

  it('rejects the loss of every mandatory scalar lineage reference', () => {
    const scalarFields = [
      'episodeRef',
      'environmentConfigRef',
      'runtimeRef',
      'tenantRef',
      'projectRef',
    ] as const;
    for (const field of scalarFields) {
      const broken = { ...validMetadata() };
      delete (broken as Record<string, unknown>)[field];
      expect(isTrajectoryMetadata(broken), `missing ${field} must fail`).toBe(false);
      expect(isTrajectoryMetadata(metaWith({ [field]: '' } as Partial<TrajectoryMetadata>)), `empty ${field} must fail`).toBe(false);
    }
  });

  it('rejects empty or duplicated lineage lists (bodies, substrates, data)', () => {
    for (const field of LINEAGE_LIST_FIELDS) {
      expect(isTrajectoryMetadata(metaWith({ [field]: [] } as Partial<TrajectoryMetadata>)), `empty ${field} must fail`).toBe(false);
      expect(isTrajectoryMetadata(metaWith({ [field]: ['dup', 'dup'] } as Partial<TrajectoryMetadata>)), `duplicate ${field} must fail`).toBe(false);
      expect(isTrajectoryMetadata(metaWith({ [field]: ['ok', ''] } as Partial<TrajectoryMetadata>)), `empty entry in ${field} must fail`).toBe(false);
      expect(isTrajectoryMetadata(metaWith({ [field]: 'nope' } as unknown as Partial<TrajectoryMetadata>)), `non-array ${field} must fail`).toBe(false);
    }
  });

  it('rejects a missing or non-listed fidelity mode (L5 lineage)', () => {
    const noFidelity = { ...validMetadata() };
    delete (noFidelity as Record<string, unknown>).fidelity;
    expect(isTrajectoryMetadata(noFidelity)).toBe(false);
    expect(isTrajectoryMetadata(metaWith({ fidelity: 'imagined_replay' as never }))).toBe(false);
  });

  it('rejects non-object input without throwing', () => {
    for (const bad of [null, undefined, 42, 'meta', [], Number.NaN]) {
      expect(isTrajectoryMetadata(bad)).toBe(false);
    }
  });
});

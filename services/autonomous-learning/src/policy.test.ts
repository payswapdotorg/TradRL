/**
 * The improvement-policy suite: the validation laws (the six-focus
 * totality, the closed vocabularies, the coherence + annotation laws) and
 * the default policy's declared interpretation.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPROVEMENT_POLICY,
  ImprovementPolicy,
  VALIDATED_DEFAULT_POLICY,
  improvementPolicyDigest,
  validateImprovementPolicy,
} from './index';

/** The valid table (the default's shape, for mutation-based negative tests). */
function validTable(): Record<'strategy_revision' | 'model_recalibration' | 'data_pipeline' | 'risk_policy' | 'execution_quality' | 'none', { gapKind: string | null; knowledgeKind: string | null; commission: boolean }> {
  return {
    strategy_revision: { gapKind: 'regime', knowledgeKind: 'decision_pattern', commission: true },
    model_recalibration: { gapKind: 'regime', knowledgeKind: 'model_calibration', commission: true },
    data_pipeline: { gapKind: null, knowledgeKind: 'data_latency', commission: false },
    risk_policy: { gapKind: 'risk', knowledgeKind: 'decision_pattern', commission: true },
    execution_quality: { gapKind: 'execution', knowledgeKind: 'decision_pattern', commission: true },
    none: { gapKind: null, knowledgeKind: null, commission: false },
  };
}

describe('validateImprovementPolicy: the declaration laws', () => {
  it('the default policy validates and is deeply frozen', () => {
    const result = validateImprovementPolicy(DEFAULT_IMPROVEMENT_POLICY);
    expect(result.ok).toBe(true);
    expect(VALIDATED_DEFAULT_POLICY.version).toBe('improvement@1.0.0');
    expect(Object.isFrozen(VALIDATED_DEFAULT_POLICY.focusTable)).toBe(true);
  });

  it('a missing focus row is policy_invalid (the totality law — all six focuses)', () => {
    const table = validTable();
    delete (table as Record<string, unknown>).risk_policy;
    const result = validateImprovementPolicy({ version: 'improvement@2', focusTable: table, requiresHoldout: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('policy_invalid');
      expect(result.errors[0]?.path).toBe('focusTable.risk_policy');
    }
  });

  it('a foreign row is policy_invalid (the closed vocabulary)', () => {
    const table = validTable() as Record<string, unknown>;
    table.vibes = { gapKind: null, knowledgeKind: null, commission: false };
    const result = validateImprovementPolicy({ version: 'improvement@2', focusTable: table, requiresHoldout: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_invalid');
  });

  it('a commissioning row without a gap kind is policy_invalid (the coherence law)', () => {
    const table = validTable();
    table.execution_quality = { gapKind: null, knowledgeKind: 'decision_pattern', commission: true };
    const result = validateImprovementPolicy({ version: 'improvement@2', focusTable: table, requiresHoldout: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('policy_invalid');
      expect(result.errors[0]?.message).toContain('forge runs over gap records');
    }
  });

  it('a gap row without a knowledge kind is policy_invalid (the annotation law)', () => {
    const table = validTable();
    table.execution_quality = { gapKind: 'execution', knowledgeKind: null, commission: true };
    const result = validateImprovementPolicy({ version: 'improvement@2', focusTable: table, requiresHoldout: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('policy_invalid');
      expect(result.errors[0]?.message).toContain('knowledge annotation');
    }
  });

  it('a foreign gap kind is policy_invalid (the closed six-kind vocabulary)', () => {
    const table = validTable();
    table.execution_quality = { gapKind: 'vibes', knowledgeKind: 'decision_pattern', commission: true } as never;
    const result = validateImprovementPolicy({ version: 'improvement@2', focusTable: table, requiresHoldout: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_invalid');
  });

  it('a missing version or a non-boolean switch is policy_invalid', () => {
    const noVersion = validateImprovementPolicy({ focusTable: validTable(), requiresHoldout: true } as never);
    expect(noVersion.ok).toBe(false);
    if (!noVersion.ok) expect(noVersion.errors[0]?.code).toBe('policy_invalid');
    const badSwitch = validateImprovementPolicy({ version: 'improvement@2', focusTable: validTable(), requiresHoldout: 1 as never });
    expect(badSwitch.ok).toBe(false);
    if (!badSwitch.ok) expect(badSwitch.errors[0]?.code).toBe('policy_invalid');
    const notAnObject = validateImprovementPolicy('nope');
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) expect(notAnObject.errors[0]?.code).toBe('invalid_type');
  });

  it('the policy digest is deterministic and content-bound', () => {
    const first = improvementPolicyDigest(VALIDATED_DEFAULT_POLICY);
    const second = improvementPolicyDigest(validateImprovementPolicy(DEFAULT_IMPROVEMENT_POLICY).ok
      ? (validateImprovementPolicy(DEFAULT_IMPROVEMENT_POLICY) as { value: ImprovementPolicy }).value
      : VALIDATED_DEFAULT_POLICY);
    expect(first).toBe(second);
    const changed = { ...VALIDATED_DEFAULT_POLICY, requiresHoldout: false };
    expect(improvementPolicyDigest(changed)).not.toBe(first);
  });
});

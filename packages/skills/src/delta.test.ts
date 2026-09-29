/**
 * @tradrl/skills — SkillDelta tests.
 *
 * Behavioral, law-driven:
 * - THE BREAKING-CHANGE LAW: a delta removing a capability without the
 *   declared-breaking-change record is a typed error
 *   (`undeclared_breaking_change`).
 * - The evidence law on additions: an added capability with no skill
 *   artifacts is an invented capability (`evidence_missing`).
 * - Within-delta coherence (add+remove contradictions, duplicates).
 * - agent-body policy invariants (tools both allowed and forbidden).
 * - L12 tenant scope; deep freeze; serialization byte-determinism.
 */

import { describe, expect, it } from 'vitest';

import {
  type SkillDelta,
  createSkillDelta,
  deltaCoherenceProblems,
  isSkillChange,
  isSkillDelta,
  validateSkillDelta,
} from './delta';
import type { SkillError } from './errors';
import { canonicalJson, isDeeplyFrozen } from './primitives';

function expectCode(errors: readonly SkillError[], code: string): SkillError | undefined {
  return errors.find((e) => e.code === code);
}

/** A minimal VALID delta draft exercising all five change kinds. */
function validDraft(): Record<string, unknown> {
  return {
    deltaId: 'delta-1',
    skillRecordRef: 'skill-0123456a',
    changes: [
      {
        change: 'add-capability',
        capabilityId: 'microstructure-analysis',
        name: 'Microstructure analysis',
        description: 'Analyzes order-book microstructure from replay evidence.',
        category: 'research',
        critical: false,
        skillArtifactRefs: ['skill-artifact:0123456a'],
      },
      {
        change: 'refine-capability',
        capabilityId: 'regime-detection',
        description: 'Refined regime detection with liquidity awareness.',
        additionalSkillArtifactRefs: ['skill-artifact:abcdef01'],
      },
      {
        change: 'remove-capability',
        capabilityId: 'legacy-signal-reading',
        declaredBreakingChange: {
          rationale: 'Superseded by regime detection; drops a deprecated capability.',
          addressesGapIds: ['gap-2'],
        },
      },
      {
        change: 'amend-knowledge-tool-policy',
        allowTools: ['tool/orderbook-ladder'],
        forbidTools: ['tool/legacy-tick-reader'],
        allowKnowledgeSources: ['ks/news-v2'],
        forbidKnowledgeSources: ['ks/news-v1'],
        toolCallBudgetPerDecision: 6,
      },
      {
        change: 'amend-procedures',
        addProcedures: [
          {
            id: 'regime-shift-review',
            name: 'Regime shift review',
            trigger: 'event',
            steps: [
              {
                id: 'gather',
                description: 'Gather the latest observation refs.',
                toolRefs: ['tool/obs-reader'],
                approvalRequired: false,
              },
            ],
          },
        ],
        removeProcedureIds: ['legacy-signal-scan'],
      },
    ],
    tenantId: 'tenant-a',
    projectId: 'project-b',
  };
}

describe('the composable delta (happy path)', () => {
  it('creates a deeply frozen, guard-passing delta', () => {
    const delta = createSkillDelta(validDraft());
    expect(isSkillDelta(delta)).toBe(true);
    expect(isDeeplyFrozen(delta)).toBe(true);
    expect(delta.changes.length).toBe(5);
  });

  it('validateSkillDelta returns the narrowed value on success', () => {
    const result = validateSkillDelta(validDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tenantId).toBe('tenant-a');
    }
  });

  it('serialization is byte-stable (same draft, same bytes)', () => {
    const a = createSkillDelta(validDraft());
    const b = createSkillDelta(validDraft());
    expect(
      canonicalJson(JSON.parse(JSON.stringify(a)) as never),
    ).toBe(canonicalJson(JSON.parse(JSON.stringify(b)) as never));
  });

  it('an optional tool budget override may be absent or null', () => {
    const without = validDraft();
    (without.changes as Record<string, unknown>[])[3] = {
      change: 'amend-knowledge-tool-policy',
      allowTools: [],
      forbidTools: [],
      allowKnowledgeSources: [],
      forbidKnowledgeSources: [],
    };
    expect(validateSkillDelta(without).ok).toBe(true);
    const nullBudget = validDraft();
    ((nullBudget.changes as Record<string, unknown>[])[3] as Record<string, unknown>).toolCallBudgetPerDecision = null;
    expect(validateSkillDelta(nullBudget).ok).toBe(true);
  });
});

describe('THE BREAKING-CHANGE LAW (negative paths)', () => {
  it('a removal without the declared breaking change fails with undeclared_breaking_change', () => {
    const draft = validDraft();
    (draft.changes as Record<string, unknown>[])[2] = {
      change: 'remove-capability',
      capabilityId: 'legacy-signal-reading',
    };
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = expectCode(result.errors, 'undeclared_breaking_change');
      expect(violation).toBeDefined();
      expect(violation?.path).toContain('declaredBreakingChange');
    }
    expect(() => createSkillDelta(draft)).toThrow(/undeclared_breaking_change/);
  });

  it('a removal with a blank rationale is not a declaration', () => {
    const draft = validDraft();
    (draft.changes as Record<string, unknown>[])[2] = {
      change: 'remove-capability',
      capabilityId: 'legacy-signal-reading',
      declaredBreakingChange: { rationale: '   ', addressesGapIds: [] },
    };
    expect(validateSkillDelta(draft).ok).toBe(false);
  });

  it('the guard rejects an undeclared removal outright', () => {
    const removal = {
      change: 'remove-capability',
      capabilityId: 'legacy-signal-reading',
    };
    expect(isSkillChange(removal)).toBe(false);
  });
});

describe('the evidence law on additions (negative paths)', () => {
  it('an added capability with NO skill artifacts fails with evidence_missing', () => {
    const draft = validDraft();
    ((draft.changes as Record<string, unknown>[])[0] as Record<string, unknown>).skillArtifactRefs = [];
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'evidence_missing')).toBeDefined();
    }
  });
});

describe('within-delta coherence (negative paths)', () => {
  it('a capability cannot be added and removed in one delta', () => {
    const draft = validDraft();
    (draft.changes as Record<string, unknown>[])[2] = {
      change: 'remove-capability',
      capabilityId: 'microstructure-analysis',
      declaredBreakingChange: { rationale: 'contradiction test', addressesGapIds: [] },
    };
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('added and removed'))).toBe(true);
    }
  });

  it('duplicate capability additions are rejected', () => {
    const draft = validDraft();
    const changes = draft.changes as Record<string, unknown>[];
    changes.push({ ...changes[0] as Record<string, unknown> });
    expect(validateSkillDelta(draft).ok).toBe(false);
  });

  it('a capability cannot be refined and removed in one delta', () => {
    const delta = {
      deltaId: 'delta-x',
      skillRecordRef: 'skill-0123456a',
      changes: [
        {
          change: 'refine-capability',
          capabilityId: 'cap-a',
          description: 'refined',
          additionalSkillArtifactRefs: [],
        },
        {
          change: 'remove-capability',
          capabilityId: 'cap-a',
          declaredBreakingChange: { rationale: 'choose one', addressesGapIds: [] },
        },
      ],
      tenantId: 'tenant-a',
      projectId: 'project-b',
    } as unknown as SkillDelta;
    expect(deltaCoherenceProblems(delta).length).toBe(1);
    expect(isSkillDelta(delta)).toBe(false);
  });

  it('a procedure cannot be added and removed in one delta', () => {
    const draft = validDraft();
    const changes = draft.changes as Record<string, unknown>[];
    ((changes[4] as Record<string, unknown>).removeProcedureIds as string[]).push('regime-shift-review');
    expect(validateSkillDelta(draft).ok).toBe(false);
  });
});

describe('agent-body policy invariants (negative paths)', () => {
  it('tools both allowed and forbidden by one amendment are rejected', () => {
    const draft = validDraft();
    const amendment = (draft.changes as Record<string, unknown>[])[3] as Record<string, unknown>;
    amendment.forbidTools = ['tool/orderbook-ladder'];
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('both allowed and forbidden'))).toBe(true);
    }
  });

  it('knowledge sources both allowed and forbidden by one amendment are rejected', () => {
    const draft = validDraft();
    const amendment = (draft.changes as Record<string, unknown>[])[3] as Record<string, unknown>;
    amendment.forbidKnowledgeSources = ['ks/news-v2'];
    expect(validateSkillDelta(draft).ok).toBe(false);
  });

  it('a negative tool budget override is rejected', () => {
    const draft = validDraft();
    const amendment = (draft.changes as Record<string, unknown>[])[3] as Record<string, unknown>;
    amendment.toolCallBudgetPerDecision = -1;
    expect(validateSkillDelta(draft).ok).toBe(false);
  });

  it('procedures with no steps are rejected (agent-body law)', () => {
    const draft = validDraft();
    const changes = draft.changes as Record<string, unknown>[];
    ((changes[4] as Record<string, unknown>).addProcedures as Record<string, unknown>[])[0] = {
      id: 'regime-shift-review',
      name: 'Regime shift review',
      trigger: 'event',
      steps: [],
    };
    expect(validateSkillDelta(draft).ok).toBe(false);
  });
});

describe('L12 scope + structural totality (negative paths)', () => {
  it('a delta with no changes is rejected', () => {
    const draft = validDraft();
    (draft as Record<string, unknown>).changes = [];
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('NON-EMPTY'))).toBe(true);
    }
  });

  it('a delta missing its skill record citation is rejected (the evidence law travels with the delta)', () => {
    const draft = validDraft();
    delete (draft as Record<string, unknown>).skillRecordRef;
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('missing_field');
    }
  });

  it('a missing tenant fails with tenant_missing', () => {
    const draft = validDraft();
    delete (draft as Record<string, unknown>).tenantId;
    const result = validateSkillDelta(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'tenant_missing')).toBeDefined();
    }
  });

  it('non-object roots fail with invalid_type', () => {
    const result = validateSkillDelta('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_type');
    }
  });
});

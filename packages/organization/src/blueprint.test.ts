// @tradrl/organization — blueprint behavioral tests (T016).
//
// Laws under test:
// - SEVEN-AXIS COMPLETENESS (acceptance #9): a blueprint missing ANY axis
//   fails its guard and is the typed error `axis_missing`.
// - L16a: labels anywhere in the blueprint tree are `label_as_evidence`.
// - SAFETY (acceptance #6): authority embedding is `authority_in_blueprint`
//   (positive: opaque risk-policy refs are legal — they reference
//   independent gates, they do not grant anything).
// - Cross-axis coherence, kernel-topic reservation, immutability.

import { describe, expect, it } from 'vitest';
import {
  type OrganizationBlueprint,
  AUTHORITY_EMBEDDING_KEYS,
  ORGANIZATION_AXES,
  authorityKeyPaths,
  countTopologyWires,
  createOrganizationBlueprint,
  isOrganizationBlueprint,
  isOrganizationTopic,
  isTopicWire,
  topicName,
  validateOrganizationBlueprint,
} from './index';
import { fixtureBlueprint } from './fixtures';

describe('blueprint positive path: all seven axes, measured evidence, opaque policy refs', () => {
  it('the fixture blueprint passes its guard and full validation', () => {
    expect(isOrganizationBlueprint(fixtureBlueprint)).toBe(true);
    const result = validateOrganizationBlueprint(fixtureBlueprint);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentCount).toBe(2);
      expect(result.value.specializations).toHaveLength(2);
    }
  });

  it('the factory returns a deeply frozen blueprint', () => {
    const blueprint = createOrganizationBlueprint(fixtureBlueprint);
    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(Object.isFrozen(blueprint.topology)).toBe(true);
    expect(() => {
      (blueprint as unknown as { agentCount: number }).agentCount = 99;
    }).toThrow();
  });

  it('blueprints survive a JSON round-trip unchanged (INV-0.1)', () => {
    const roundTrip: unknown = JSON.parse(JSON.stringify(fixtureBlueprint));
    expect(isOrganizationBlueprint(roundTrip)).toBe(true);
    expect(roundTrip).toEqual(fixtureBlueprint);
  });

  it('the wire count excludes self-pairs (coordination cost input)', () => {
    const topology = { wires: [{ topic: 'org.x', publishers: ['a', 'b'], subscribers: ['a', 'b'] }] };
    expect(countTopologyWires(topology as never)).toBe(2); // a->b and b->a, never a->a
  });

  it('opaque risk-policy refs are LEGAL (independent gates, not grants)', () => {
    // The safety law forbids embedded authority, not opaque references to
    // the independent risk/authorization/execution gates.
    const result = validateOrganizationBlueprint(fixtureBlueprint);
    expect(result.ok).toBe(true);
    expect(authorityKeyPaths(fixtureBlueprint)).toHaveLength(0);
  });
});

describe('seven-axis completeness (acceptance #9 — negative paths)', () => {
  const AXES = [...ORGANIZATION_AXES] as const;

  it('the axis vocabulary is exactly the seven ARCHITECTURE.md axes', () => {
    expect(AXES).toEqual([
      'agentCount',
      'specializations',
      'assignments',
      'topology',
      'trainingAllocation',
      'decisionCadence',
      'adversarialPopulation',
    ]);
  });

  for (const axis of AXES) {
    it(`a blueprint missing "${axis}" fails its guard and names the axis (axis_missing)`, () => {
      const broken: Record<string, unknown> = { ...fixtureBlueprint };
      delete broken[axis];
      expect(isOrganizationBlueprint(broken)).toBe(false);
      const result = validateOrganizationBlueprint(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const axisError = result.errors.find((e) => e.code === 'axis_missing');
        expect(axisError).toBeDefined();
        expect(axisError?.path).toBe(axis);
      }
      expect(() => createOrganizationBlueprint(broken)).toThrow(new RegExp(`axis_missing.*${axis}`));
    });
  }

  it('a blueprint missing TWO axes reports both (collect-all)', () => {
    const broken: Record<string, unknown> = { ...fixtureBlueprint };
    delete broken.topology;
    delete broken.decisionCadence;
    const result = validateOrganizationBlueprint(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.errors.filter((e) => e.code === 'axis_missing').map((e) => e.path);
      expect(missing.sort()).toEqual(['decisionCadence', 'topology']);
    }
  });
});

describe('L16a: labels never enter blueprints (negative paths)', () => {
  it('a specialization carrying a role label is label_as_evidence', () => {
    const labeled = {
      ...fixtureBlueprint,
      specializations: [
        { ...fixtureBlueprint.specializations[0], role: 'mathematician' },
        fixtureBlueprint.specializations[1],
      ],
    };
    expect(isOrganizationBlueprint(labeled)).toBe(false);
    const result = validateOrganizationBlueprint(labeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence' && e.path.includes('role'))).toBe(true);
    }
  });

  it('an assignment citing a profession as justification is label_as_evidence', () => {
    const labeled = {
      ...fixtureBlueprint,
      assignments: [
        { ...fixtureBlueprint.assignments[0], profession: 'quant researcher' },
        fixtureBlueprint.assignments[1],
      ],
    };
    const result = validateOrganizationBlueprint(labeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });
});

describe('safety: authority embedding is a typed crime (acceptance #6)', () => {
  it('the authority-embedding key vocabulary is closed and guarded', () => {
    expect(AUTHORITY_EMBEDDING_KEYS).toContain('authorityToken');
    expect(AUTHORITY_EMBEDDING_KEYS).toContain('executionGrant');
    for (const key of AUTHORITY_EMBEDDING_KEYS) {
      expect(authorityKeyPaths({ [key]: 'x' })).toEqual([key]);
    }
  });

  it('a blueprint embedding an authority token fails (authority_in_blueprint)', () => {
    const embedding = {
      ...fixtureBlueprint,
      assignments: [
        { ...fixtureBlueprint.assignments[0], authorityToken: 'tok/atlas/exec-1' },
        fixtureBlueprint.assignments[1],
      ],
    };
    expect(isOrganizationBlueprint(embedding)).toBe(false);
    const result = validateOrganizationBlueprint(embedding);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.code === 'authority_in_blueprint');
      expect(error).toBeDefined();
      expect(error?.path).toContain('authorityToken');
    }
  });

  it('a blueprint granting execution fails (authority_in_blueprint)', () => {
    const granting = {
      ...fixtureBlueprint,
      adversarialPopulation: {
        ...fixtureBlueprint.adversarialPopulation,
        executionGrant: 'grant/atlas/live-execution',
      },
    };
    const result = validateOrganizationBlueprint(granting);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'authority_in_blueprint')).toBe(true);
    }
  });

  it('a blueprint carrying credentials/scopes fails (authority_in_blueprint)', () => {
    const leaking = {
      ...fixtureBlueprint,
      topology: { ...fixtureBlueprint.topology, credential: 'secret/atlas/broker' },
    };
    expect(isOrganizationBlueprint(leaking)).toBe(false);
    expect(validateOrganizationBlueprint(leaking).ok).toBe(false);
  });
});

describe('cross-axis coherence (negative paths)', () => {
  it('agentCount disagreeing with assignments is invalid', () => {
    const broken = { ...fixtureBlueprint, agentCount: 3 };
    const result = validateOrganizationBlueprint(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'agentCount')).toBe(true);
    }
  });

  it('specializations and assignments must agree one-for-one', () => {
    const broken = {
      ...fixtureBlueprint,
      assignments: [fixtureBlueprint.assignments[0]],
    };
    const result = validateOrganizationBlueprint(broken);
    expect(result.ok).toBe(false);
  });

  it('duplicate capability keys in specializations are invalid', () => {
    const broken = {
      ...fixtureBlueprint,
      specializations: [
        fixtureBlueprint.specializations[0],
        { ...fixtureBlueprint.specializations[1], capabilityKey: fixtureBlueprint.specializations[0].capabilityKey },
      ],
    };
    expect(validateOrganizationBlueprint(broken).ok).toBe(false);
  });

  it('training allocation must cover exactly the assignment slots', () => {
    const uncovered = {
      ...fixtureBlueprint,
      trainingAllocation: { entries: [fixtureBlueprint.trainingAllocation.entries[0]] },
    };
    expect(validateOrganizationBlueprint(uncovered).ok).toBe(false);
    const orphan = {
      ...fixtureBlueprint,
      trainingAllocation: {
        entries: [
          ...fixtureBlueprint.trainingAllocation.entries,
          { slotId: 'slot-9', method: 'bandits', computeUnits: 1 },
        ],
      },
    };
    expect(validateOrganizationBlueprint(orphan).ok).toBe(false);
  });

  it('decision cadence must cover exactly the assignment slots', () => {
    const uncovered = {
      ...fixtureBlueprint,
      decisionCadence: { entries: [fixtureBlueprint.decisionCadence.entries[1]] },
    };
    expect(validateOrganizationBlueprint(uncovered).ok).toBe(false);
  });

  it('topology wires must reference existing slots', () => {
    const broken = {
      ...fixtureBlueprint,
      topology: {
        wires: [
          { topic: 'org.x.coordination', publishers: ['slot-1', 'slot-ghost'], subscribers: ['slot-2'] },
        ],
      },
    };
    const result = validateOrganizationBlueprint(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'topology.wires' && e.message.includes('slot-ghost'))).toBe(true);
    }
  });

  it('the all-to-all coordination pattern is legal (self-pairs excluded from the wire MEASUREMENT)', () => {
    // Every slot publishing and subscribing one shared topic is the
    // natural coordination pattern; the declared coordination-cost
    // measurement (countTopologyWires) excludes self-pairs — that is the
    // law, not a topology prohibition.
    const allToAll = {
      ...fixtureBlueprint,
      topology: {
        wires: [{ topic: 'org.x.echo', publishers: ['slot-1'], subscribers: ['slot-1'] }],
      },
    };
    expect(validateOrganizationBlueprint(allToAll).ok).toBe(true);
    expect(
      countTopologyWires({ wires: [{ topic: topicName('org.x.echo'), publishers: ['slot-1'], subscribers: ['slot-1'] }] }),
    ).toBe(0);
  });

  it('adversarialRequired with an empty adversary set is invalid (L10 discipline)', () => {
    const broken = {
      ...fixtureBlueprint,
      adversarialPopulation: { adversarialRequired: true, adversaryRefs: [] },
    };
    expect(isOrganizationBlueprint(broken)).toBe(false);
    expect(validateOrganizationBlueprint(broken).ok).toBe(false);
  });
});

describe('kernel-topic reservation (agent-os envelope law)', () => {
  it('organization topics never use the kernel.* reserved namespace', () => {
    expect(isOrganizationTopic('kernel.request')).toBe(false);
    expect(isOrganizationTopic('kernel.delegate')).toBe(false);
    expect(isOrganizationTopic('org.atlas.coordination')).toBe(true);
    expect(isTopicWire({ topic: 'kernel.propose', publishers: ['slot-1'], subscribers: ['slot-2'] })).toBe(false);
  });

  it('a blueprint wired on a kernel topic is invalid', () => {
    const kernelWired = {
      ...fixtureBlueprint,
      topology: {
        wires: [{ topic: 'kernel.approve', publishers: ['slot-1'], subscribers: ['slot-2'] }],
      },
    };
    expect(validateOrganizationBlueprint(kernelWired).ok).toBe(false);
  });

  it('empty topologies are invalid (an organization communicates)', () => {
    const empty = { ...fixtureBlueprint, topology: { wires: [] } };
    expect(isOrganizationBlueprint(empty)).toBe(false);
  });
});

describe('structural boundary negatives', () => {
  it('assignments without capability-record citations are invalid', () => {
    const bare = {
      ...fixtureBlueprint,
      assignments: [
        { ...fixtureBlueprint.assignments[0], capabilityRecordRefs: [] },
        fixtureBlueprint.assignments[1],
      ],
    };
    expect(isOrganizationBlueprint(bare)).toBe(false);
  });

  it('non-canonical subject references are invalid (L2 discipline)', () => {
    const malformed = {
      ...fixtureBlueprint,
      assignments: [
        { ...fixtureBlueprint.assignments[0], subject: { kind: 'body', ref: 'x' } },
        fixtureBlueprint.assignments[1],
      ],
    };
    expect(isOrganizationBlueprint(malformed)).toBe(false);
  });

  it('unknown training methods are invalid (LEARNING-LOOP closed vocabulary)', () => {
    const broken = {
      ...fixtureBlueprint,
      trainingAllocation: {
        entries: [
          { ...fixtureBlueprint.trainingAllocation.entries[0], method: 'vibes-based' as never },
          fixtureBlueprint.trainingAllocation.entries[1],
        ],
      },
    };
    expect(validateOrganizationBlueprint(broken).ok).toBe(false);
  });

  it('non-root / non-object input is a typed invalid_type', () => {
    expect(validateOrganizationBlueprint(null).ok).toBe(false);
    expect(validateOrganizationBlueprint([]).ok).toBe(false);
    expect(validateOrganizationBlueprint('blueprint').ok).toBe(false);
    const result = validateOrganizationBlueprint({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.code === 'axis_missing')).toBe(true);
      expect(result.errors).toHaveLength(7);
    }
  });
});

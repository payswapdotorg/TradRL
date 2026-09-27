import { describe, expect, it } from 'vitest';
import {
  AGENT_INSTANCE_TRANSITIONS,
  type AgentInstance,
  type AgentInstanceDraft,
  canTransitionAgentInstance,
  createAgentInstance,
  detectManagementCycle,
  isAgentInstance,
  transitionAgentInstance,
  validateAgentInstance,
} from './instance';
import { IllegalTransitionError, agentInstanceId, bodyVersionId } from './primitives';
import { exampleAgentInstance, exampleCertifiedBodyVersion, examplePossession } from './examples';

function validDraft(): AgentInstanceDraft {
  return JSON.parse(JSON.stringify(exampleAgentInstance)) as AgentInstanceDraft;
}

describe('createAgentInstance', () => {
  it('creates an instance in state spawning (single lifecycle entry)', () => {
    const instance = createAgentInstance(validDraft());
    expect(instance.status).toBe('spawning');
    expect(isAgentInstance(instance)).toBe(true);
    expect(Object.isFrozen(instance)).toBe(true);
  });

  it('rejects invalid fields', () => {
    const cases: Array<[string, (d: AgentInstanceDraft) => AgentInstanceDraft]> = [
      ['id', (d) => ({ ...d, id: 'bad id' as AgentInstanceDraft['id'] })],
      ['possessionId', (d) => ({ ...d, possessionId: 'bad id' as AgentInstanceDraft['possessionId'] })],
      ['projectId', (d) => ({ ...d, projectId: '' as AgentInstanceDraft['projectId'] })],
      ['managerId', (d) => ({ ...d, managerId: 'bad id' as AgentInstanceDraft['managerId'] })],
      ['authority', (d) => ({ ...d, authority: { ...d.authority, maxDelegationDepth: -1 } })],
      ['runtimeStateRef', (d) => ({ ...d, runtimeStateRef: ' ' as AgentInstanceDraft['runtimeStateRef'] })],
      ['spawnedAt', (d) => ({ ...d, spawnedAt: 'now' as AgentInstanceDraft['spawnedAt'] })],
    ];
    for (const [field, mutate] of cases) {
      try {
        createAgentInstance(mutate(validDraft()));
        throw new Error(`expected createAgentInstance to reject invalid ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect((error as TypeError).message).toContain(field.split('.')[0]);
      }
    }
  });

  it('rejects self-management at construction', () => {
    const draft = { ...validDraft(), managerId: validDraft().id };
    expect(() => createAgentInstance(draft)).toThrow(/manage itself/);
  });
});

describe('validateAgentInstance — authority subset law', () => {
  it('accepts the canonical example', () => {
    const result = validateAgentInstance(exampleAgentInstance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags a possession mismatch', () => {
    const draft = { ...validDraft(), possessionId: 'other-possession' as AgentInstanceDraft['possessionId'] };
    const instance = createAgentInstance(draft);
    const result = validateAgentInstance(instance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toEqual(['possession-mismatch']);
  });

  it('flags runtime authority exceeding the body boundary (L16: narrow, never widen)', () => {
    const base = validDraft();
    const instance = createAgentInstance({
      ...base,
      authority: {
        ...base.authority,
        allowedActions: ['OBSERVE', 'EXECUTE'] as const, // EXECUTE is prohibited for this body
      },
    });
    const result = validateAgentInstance(instance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.valid).toBe(false);
    // EXECUTE is not granted by the body, and it collides with the instance's
    // own denied list — both violations are reported.
    expect(result.violations.map((v) => v.code)).toEqual([
      'authority-exceeds-body',
      'authority-contradiction',
    ]);
    expect(result.violations[0]?.message).toContain('EXECUTE');
  });

  it('flags allowed/denied contradictions', () => {
    const base = validDraft();
    const instance = createAgentInstance({
      ...base,
      authority: {
        ...base.authority,
        deniedActions: ['OBSERVE'] as const, // OBSERVE is also in allowedActions
      },
    });
    const result = validateAgentInstance(instance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.violations.map((v) => v.code)).toEqual(['authority-contradiction']);
  });

  it('flags delegation depth exceeding the body policy', () => {
    const base = validDraft();
    const instance = createAgentInstance({
      ...base,
      authority: { ...base.authority, maxDelegationDepth: 5 },
    });
    const result = validateAgentInstance(instance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.violations.map((v) => v.code)).toEqual(['delegation-depth-exceeds-body']);
  });

  it('flags a possession bound to a different body version', () => {
    const result = validateAgentInstance(
      exampleAgentInstance,
      { ...examplePossession, bodyVersionId: bodyVersionId('regime-researcher@9.9.9') },
      exampleCertifiedBodyVersion,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('possession-mismatch');
  });
});

describe('agent instance lifecycle', () => {
  it('declares the authoritative transition table', () => {
    expect(AGENT_INSTANCE_TRANSITIONS.spawning).toEqual(['ready', 'failed']);
    expect(AGENT_INSTANCE_TRANSITIONS.ready).toEqual(['running', 'terminated', 'failed']);
    expect(AGENT_INSTANCE_TRANSITIONS.running).toEqual(['paused', 'terminated', 'failed']);
    expect(AGENT_INSTANCE_TRANSITIONS.paused).toEqual(['running', 'terminated', 'failed']);
    expect(AGENT_INSTANCE_TRANSITIONS.failed).toEqual(['terminated']);
    expect(AGENT_INSTANCE_TRANSITIONS.terminated).toEqual([]);
  });

  it('walks spawning -> ready -> running -> paused -> running -> terminated', () => {
    let instance: AgentInstance = createAgentInstance(validDraft());
    for (const status of ['ready', 'running', 'paused', 'running', 'terminated'] as const) {
      instance = transitionAgentInstance(instance, status);
      expect(instance.status).toBe(status);
    }
  });

  it('supports the failure path spawning -> failed -> terminated', () => {
    let instance: AgentInstance = createAgentInstance(validDraft());
    instance = transitionAgentInstance(instance, 'failed');
    instance = transitionAgentInstance(instance, 'terminated');
    expect(instance.status).toBe('terminated');
    expect(() => transitionAgentInstance(instance, 'running')).toThrow(IllegalTransitionError);
  });

  it('rejects skipping states', () => {
    const instance = createAgentInstance(validDraft());
    expect(() => transitionAgentInstance(instance, 'running')).toThrow(IllegalTransitionError);
    expect(() => transitionAgentInstance(instance, 'terminated')).toThrow(IllegalTransitionError);
    expect(canTransitionAgentInstance('spawning', 'running')).toBe(false);
    expect(() => transitionAgentInstance(instance, 'bogus' as never)).toThrow(TypeError);
  });

  it('transitions are copy-on-write', () => {
    const spawning = createAgentInstance(validDraft());
    const ready = transitionAgentInstance(spawning, 'ready');
    expect(spawning.status).toBe('spawning');
    expect(ready.status).toBe('ready');
    expect(ready.id).toBe(spawning.id);
    expect(Object.isFrozen(ready)).toBe(true);
  });
});

describe('detectManagementCycle', () => {
  function instance(id: string, managerId: string | null): AgentInstance {
    return createAgentInstance({
      ...validDraft(),
      id: agentInstanceId(id),
      managerId: managerId === null ? null : agentInstanceId(managerId),
    });
  }

  it('returns null for acyclic management chains', () => {
    const a = instance('agent-a', null);
    const b = instance('agent-b', 'agent-a');
    const c = instance('agent-c', 'agent-b');
    expect(detectManagementCycle([a, b, c])).toBeNull();
  });

  it('detects a three-agent management cycle', () => {
    const a = instance('agent-a', 'agent-c');
    const b = instance('agent-b', 'agent-a');
    const c = instance('agent-c', 'agent-b');
    const cycle = detectManagementCycle([a, b, c]);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle).size).toBe(3);
  });

  it('detects self-management cycles', () => {
    // createAgentInstance refuses self-management at construction, so craft
    // the record directly — detection must still catch it.
    const a = {
      ...instance('agent-a', null),
      managerId: agentInstanceId('agent-a'),
    } as AgentInstance;
    expect(detectManagementCycle([a])).toEqual(['agent-a', 'agent-a']);
  });

  it('treats dangling manager references as non-cycles', () => {
    const b = instance('agent-b', 'agent-missing');
    expect(detectManagementCycle([b])).toBeNull();
  });
});

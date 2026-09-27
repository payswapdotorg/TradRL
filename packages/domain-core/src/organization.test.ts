import { describe, expect, it } from 'vitest';
import {
  Organization,
  OrganizationMembership,
  isOrganization,
  isOrganizationMembership,
  isDecisionCadence,
  isOrganizationStatus,
} from './organization';
import { Timestamp } from './primitives';
import {
  AgentInstanceId,
  BodyVersionId,
  OrganizationId,
  ProjectId,
  TenantId,
  TopologyId,
} from './ids';

const ts = (s: string) => s as Timestamp;

const org1 = 'org_1' as OrganizationId;
const tenant1 = 'tenant_1' as TenantId;
const prj1 = 'prj_1' as ProjectId;
const instDirector = 'inst_director_1' as AgentInstanceId;
const instResearch = 'inst_research_1' as AgentInstanceId;
const instX = 'inst_x' as AgentInstanceId;
const bodyDirector = 'body_director_v4' as BodyVersionId;
const bodyResearch = 'body_research_v2' as BodyVersionId;
const topoStar = 'topo_star_1' as TopologyId;

function validMembership(): OrganizationMembership {
  return {
    agentInstanceId: instDirector,
    role: 'trading-director',
    bodyVersionId: bodyDirector,
    managerId: undefined,
  };
}

function validOrganization(): Organization {
  return {
    id: org1,
    tenantId: tenant1,
    projectId: prj1,
    name: 'Crypto Majors desk',
    status: 'active',
    createdAt: ts('2027-01-03T10:00:00Z'),
    memberships: [
      validMembership(),
      {
        agentInstanceId: instResearch,
        role: 'regime-researcher',
        bodyVersionId: bodyResearch,
        managerId: instDirector,
      },
    ],
    communicationTopologyId: topoStar,
    decisionCadence: { mode: 'scheduled', intervalSeconds: 900 },
  };
}

describe('isOrganization — acceptance', () => {
  it('accepts a fully valid organization (structural only)', () => {
    expect(isOrganization(validOrganization())).toBe(true);
  });

  it('accepts memberships without body-version denormalization', () => {
    const org: Organization = {
      ...validOrganization(),
      memberships: [{ agentInstanceId: instX, role: 'execution' }],
    };
    expect(isOrganization(org)).toBe(true);
  });

  it('accepts event-driven and continuous cadences', () => {
    expect(
      isOrganization({ ...validOrganization(), decisionCadence: { mode: 'event-driven' } }),
    ).toBe(true);
    expect(
      isOrganization({ ...validOrganization(), decisionCadence: { mode: 'continuous' } }),
    ).toBe(true);
  });
});

describe('isOrganization — rejection', () => {
  it('rejects malformed organizations', () => {
    const invalid: unknown[] = [
      { ...validOrganization(), id: '' },
      { ...validOrganization(), tenantId: '' }, // tenant scope mandatory (L12)
      { ...validOrganization(), projectId: '' },
      { ...validOrganization(), name: '' },
      { ...validOrganization(), status: 'disbanded' },
      { ...validOrganization(), createdAt: '2027-01-03T10:00:00' },
      { ...validOrganization(), communicationTopologyId: '' },
      {
        ...validOrganization(),
        memberships: [validMembership(), validMembership()], // duplicate agent instance
      },
      { ...validOrganization(), decisionCadence: { mode: 'whenever' } },
      { ...validOrganization(), decisionCadence: { mode: 'scheduled' } }, // scheduled requires interval
      { ...validOrganization(), decisionCadence: { mode: 'scheduled', intervalSeconds: 0 } },
      { ...validOrganization(), decisionCadence: { mode: 'scheduled', intervalSeconds: -5 } },
      { ...validOrganization(), decisionCadence: { mode: 'scheduled', intervalSeconds: Number.NaN } },
      { ...validOrganization(), decisionCadence: { mode: 'continuous', intervalSeconds: 0 } },
      { ...validOrganization(), memberships: 'none' },
      null,
      42,
    ];
    for (const o of invalid) expect(isOrganization(o)).toBe(false);
  });

  it('an empty membership list is structurally valid (forming organization)', () => {
    expect(isOrganization({ ...validOrganization(), memberships: [] })).toBe(true);
  });
});

describe('component guards', () => {
  it('isOrganizationMembership validates opaque references and roles', () => {
    expect(isOrganizationMembership(validMembership())).toBe(true);
    expect(isOrganizationMembership({ agentInstanceId: 'i', role: 'analyst' })).toBe(true);
    expect(isOrganizationMembership({ agentInstanceId: '', role: 'analyst' })).toBe(false);
    expect(isOrganizationMembership({ agentInstanceId: 'i', role: '' })).toBe(false);
    expect(isOrganizationMembership({ agentInstanceId: 'i', role: 'r', bodyVersionId: 7 })).toBe(false);
    expect(isOrganizationMembership({ agentInstanceId: 'i', role: 'r', managerId: '' })).toBe(false);
    expect(isOrganizationMembership(null)).toBe(false);
  });

  it('isDecisionCadence: scheduled requires a positive interval; others optional', () => {
    expect(isDecisionCadence({ mode: 'scheduled', intervalSeconds: 60 })).toBe(true);
    expect(isDecisionCadence({ mode: 'scheduled', intervalSeconds: 0.5 })).toBe(true);
    expect(isDecisionCadence({ mode: 'event-driven' })).toBe(true);
    expect(isDecisionCadence({ mode: 'event-driven', intervalSeconds: 30 })).toBe(true); // minimum spacing
    expect(isDecisionCadence({ mode: 'scheduled' })).toBe(false);
    expect(isDecisionCadence({ mode: 'scheduled', intervalSeconds: 0 })).toBe(false);
    expect(isDecisionCadence({})).toBe(false);
  });

  it('organization statuses are the closed vocabulary', () => {
    for (const s of ['forming', 'active', 'paused', 'dissolved']) {
      expect(isOrganizationStatus(s)).toBe(true);
    }
    expect(isOrganizationStatus('compiling')).toBe(false); // that is a Project status
  });
});

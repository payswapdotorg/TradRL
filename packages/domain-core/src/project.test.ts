import { describe, expect, it } from 'vitest';
import { Project, isProject, isProjectStatus, isExecutionMode } from './project';
import { Timestamp } from './primitives';
import {
  ConstraintSetId,
  GoalId,
  InstrumentId,
  OrganizationId,
  ProjectId,
  TenantId,
  VenueId,
} from './ids';

const ts = (s: string) => s as Timestamp;

const prj1 = 'prj_1' as ProjectId;
const prj0 = 'prj_0' as ProjectId;
const tenant1 = 'tenant_1' as TenantId;
const goal1 = 'goal_1' as GoalId;
const csGoal1 = 'cs_goal_1' as ConstraintSetId;
const org1 = 'org_1' as OrganizationId;
const binance = 'venue_binance' as VenueId;
const btcUsdt = 'instr_btc_usdt' as InstrumentId;
const ethUsdt = 'instr_eth_usdt' as InstrumentId;

function validProject(): Project {
  return {
    id: prj1,
    tenantId: tenant1,
    name: 'Crypto Majors Alpha',
    description: 'Q1 crypto majors research and execution project.',
    status: 'active',
    createdAt: ts('2027-01-02T08:00:00Z'),
    updatedAt: ts('2027-01-10T08:00:00Z'),
    goalId: goal1,
    constraintSet: { id: csGoal1, version: 3 },
    marketScope: {
      venues: [binance],
      instruments: [btcUsdt, ethUsdt],
      assetClasses: [],
    },
    dataScope: { categories: ['market-data'] },
    organizationId: org1,
    executionMode: 'simulation',
    parentProjectId: prj0,
  };
}

describe('isProject — acceptance', () => {
  it('accepts a fully valid project', () => {
    expect(isProject(validProject())).toBe(true);
  });

  it('accepts a draft project without organization or lineage', () => {
    const draft: Project = {
      ...validProject(),
      status: 'draft',
      organizationId: undefined,
      parentProjectId: undefined,
      updatedAt: undefined,
    };
    expect(isProject(draft)).toBe(true);
  });
});

describe('isProject — rejection', () => {
  it('rejects malformed projects', () => {
    const invalid: unknown[] = [
      { ...validProject(), id: '' },
      { ...validProject(), tenantId: '' }, // tenant scope is mandatory (L12)
      { ...validProject(), name: '   ' },
      { ...validProject(), status: 'running' }, // not in the lifecycle vocabulary
      { ...validProject(), status: '' },
      { ...validProject(), createdAt: '2027-01-02T08:00:00' }, // no offset
      { ...validProject(), updatedAt: ts('2027-01-01T00:00:00Z') }, // before createdAt
      { ...validProject(), goalId: '' },
      { ...validProject(), constraintSet: { id: 'cs_goal_1', version: 0 } },
      { ...validProject(), marketScope: { venues: [], instruments: [], assetClasses: [] } },
      { ...validProject(), organizationId: 42 },
      { ...validProject(), executionMode: 'paper' }, // hard separation: simulation/shadow/live only
      { ...validProject(), executionMode: 'LIVE' },
      { ...validProject(), parentProjectId: '' },
      null,
      [],
    ];
    for (const p of invalid) expect(isProject(p)).toBe(false);
  });
});

describe('vocabularies', () => {
  it('project statuses are the closed lifecycle vocabulary', () => {
    for (const status of ['draft', 'compiling', 'active', 'paused', 'completed', 'terminated', 'archived']) {
      expect(isProjectStatus(status)).toBe(true);
    }
    expect(isProjectStatus('deleted')).toBe(false);
  });

  it('execution modes are simulation/shadow/live only', () => {
    expect(isExecutionMode('simulation')).toBe(true);
    expect(isExecutionMode('shadow')).toBe(true);
    expect(isExecutionMode('live')).toBe(true);
    expect(isExecutionMode('backtest')).toBe(false);
    expect(isExecutionMode(1)).toBe(false);
  });
});
